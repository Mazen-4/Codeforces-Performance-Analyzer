"""
Job 3 of 3 — Merge + retrain job.

- Reads all chunks/submissions_N.csv files
- Merges them into the existing 04_filtered_submissions.csv
- Runs preprocessing pipeline
- Retrains all three LightGBM models

Env vars:
  DATA_DIR   - project root (default: current dir)
  NUM_CHUNKS - how many chunk CSVs to expect (default: 10)
"""

import os
import sys
import time
import resource
import logging
import numpy as np
import pandas as pd
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)
_last_log = 0.0

DATA_DIR   = os.environ.get("DATA_DIR", str(Path(__file__).parent.parent))
NUM_CHUNKS = int(os.environ.get("NUM_CHUNKS", 10))

DATASET_DIR  = os.path.join(DATA_DIR, "ML", "dataset")
MODELS_DIR   = os.path.join(DATA_DIR, "ML", "models")
CHUNKS_DIR   = os.path.join(DATA_DIR, "chunks")
FILTERED_CSV = os.path.join(DATASET_DIR, "04_filtered_submissions.csv")

# Rows held in memory per read block. The merge used to load every input in
# full and concat: on a 14M-row dataset that is ~5 GB per copy, and the script
# held several copies at once, so the 7 GB GitHub runner SIGTERM-killed it
# (exit 143) every week. Streaming in blocks keeps peak RSS roughly flat.
CHUNK_ROWS = int(os.environ.get("MERGE_CHUNK_ROWS", 500_000))

# Narrow dtypes for the wide, low-cardinality columns. int8 flags instead of
# int64 cuts the per-row cost of ~23 numeric columns by ~8x.
FLAG_PREFIXES = ("is_", "tag_")

os.makedirs(DATASET_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)


def drop_unrated(df):
    """Drop unrated problems (problem_rating missing or <= 0).

    The crawler skips them at the source, but a previously-released dataset may
    still carry them, and they break preprocessing (idxmax over all-NA) and
    training (rating > 0 filter). Enforce it here so the dataset is always clean.
    """
    if "problem_rating" not in df.columns:
        return df
    before = len(df)
    df = df.copy()
    df["problem_rating"] = pd.to_numeric(df["problem_rating"], errors="coerce")
    df = df[df["problem_rating"] > 0]
    dropped = before - len(df)
    if dropped:
        log.info("Dropped %d unrated rows (problem_rating missing or <= 0)", dropped)
    return df


# Column-name aliases that have drifted across crawler versions. Without this,
# pandas.concat aligns by name and treats e.g. tag_impl vs tag_implementation as
# two different columns, each half-filled with NaN — which splits the tag signal
# AND breaks the strict-int read in strength.py ("Integer column has NA values").
COLUMN_ALIASES = {
    "tag_implementation": "tag_impl",
}


def normalize_schema(df):
    """Rename drifted columns to the canonical names so concat aligns cleanly.

    If both the alias and the canonical column exist in the same frame, coalesce
    them (canonical wins where present, else the alias) and drop the alias.
    """
    for alias, canonical in COLUMN_ALIASES.items():
        if alias not in df.columns:
            continue
        if canonical in df.columns:
            # Both present: coalesce alias into canonical (max treats the binary
            # tag flags as logical OR), then drop the alias column.
            df[canonical] = df[[canonical, alias]].max(axis=1)
            df = df.drop(columns=[alias])
        else:
            df = df.rename(columns={alias: canonical})
    return df


def _read_header(path):
    """Column names of a CSV without loading any rows."""
    return list(pd.read_csv(path, nrows=0).columns)


def _dtype_map(header):
    """Narrow dtypes for the flag columns; leave keys/text to pandas.

    Flags are read as float32 (not int8) because a schema-drifted input can
    leave them NA; they are filled and downcast just before writing.
    """
    dtypes = {}
    for col in header:
        canonical = COLUMN_ALIASES.get(col, col)
        if canonical.startswith(FLAG_PREFIXES):
            dtypes[col] = "float32"
        elif canonical in ("handle", "problem_id", "problem_name"):
            dtypes[col] = str
        elif canonical == "problem_rating":
            dtypes[col] = "float32"
    return dtypes


def _canonical_header(paths):
    """Union of every input's columns, in first-seen order, after aliasing.

    The released base dataset and the freshly-crawled chunks have drifted
    apart (the base carries no submitted_at/is_tle/is_mle), so the output
    header must be the union or per-block writes would misalign.
    """
    header = []
    for path in paths:
        for col in _read_header(path):
            col = COLUMN_ALIASES.get(col, col)
            if col not in header:
                header.append(col)
    return header


def _iter_blocks(path, header):
    """Yield row-blocks of a CSV, conformed to `header`, at bounded memory."""
    reader = pd.read_csv(path, chunksize=CHUNK_ROWS,
                         dtype=_dtype_map(_read_header(path)), low_memory=False)
    for block in reader:
        block = normalize_schema(block)
        for col in header:
            if col not in block.columns:
                block[col] = pd.NA
        yield block[header]


def _finalize_block(block, flag_cols):
    """Fill NA flags, downcast, and drop unrated rows before writing."""
    if flag_cols:
        block[flag_cols] = block[flag_cols].fillna(0).astype("int8")
    return drop_unrated(block)


def _log_progress(label, rows_here, written, seen_n):
    """Per-block heartbeat with RSS, so a runner-side OOM kill is pinpointed
    to an exact row offset instead of vanishing with no traceback."""
    global _last_log
    now = time.time()
    if now - _last_log < 10:
        return
    _last_log = now
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # Linux reports KB, macOS bytes.
    rss_gb = rss / (1e6 if sys.platform.startswith("linux") else 1e9)
    log.info("  [%s] read %d rows | written %d | keys %d | RSS %.2f GB",
             label, rows_here, written, seen_n, rss_gb)


def merge_chunks():
    """Merge chunk CSVs into the base dataset without ever holding it all.

    Streams every input through a single pass, dropping duplicate submissions
    via a seen-key set, and appends each block straight to disk. Peak memory
    is one block plus the key set, instead of ~4 full copies of a 14M-row
    frame, which is what OOM-killed this job (exit 143) every week.
    """
    chunk_paths = []
    for i in range(NUM_CHUNKS):
        path = os.path.join(CHUNKS_DIR, f"submissions_{i}.csv")
        if not os.path.exists(path):
            log.warning("Chunk %d missing: %s", i, path)
            continue
        if os.path.getsize(path) == 0:
            log.warning("Chunk %d: empty file, skipping", i)
            continue
        try:
            if not _read_header(path):
                log.warning("Chunk %d: no header, skipping", i)
                continue
        except Exception as e:
            log.warning("Chunk %d unreadable (%s): %s", i, path, e)
            continue
        chunk_paths.append(path)

    if not chunk_paths:
        # Previously this returned quietly and the job went on to retrain on the
        # stale dataset and publish a release — a green run that silently shipped
        # no new data. Fail unless explicitly allowed.
        msg = (f"No chunk data found in {CHUNKS_DIR} "
               f"(expected submissions_0..{NUM_CHUNKS - 1}.csv)")
        if os.environ.get("ALLOW_EMPTY_MERGE") == "1":
            log.warning("%s — continuing because ALLOW_EMPTY_MERGE=1", msg)
            return
        raise RuntimeError(msg)

    have_existing = os.path.exists(FILTERED_CSV)
    # Existing rows are written FIRST and win ties, preserving the previous
    # keep="first" dedup semantics.
    sources = ([FILTERED_CSV] if have_existing else []) + chunk_paths
    header = _canonical_header(sources)
    flag_cols = [c for c in header if c.startswith(FLAG_PREFIXES)]
    dedup_keys = [c for c in ("handle", "problem_id") if c in header]
    if "submitted_at" in header:
        # Dedup on the unique SUBMISSION, not the problem: keying on
        # (handle, problem_id) alone collapses every attempt into one row and
        # zeroes the per-problem WA counts the models aggregate with .sum().
        dedup_keys.append("submitted_at")
    log.info("Canonical header: %d columns | dedup keys: %s",
             len(header), dedup_keys)

    # Coarse key = the identity columns minus submitted_at, used to reconcile
    # schema-drifted rows that have no timestamp against ones that do.
    coarse_keys = [c for c in dedup_keys if c != "submitted_at"]
    # True when the base dataset predates submitted_at: its rows cannot be
    # matched to re-crawled ones on the exact key, so fall back to the coarse
    # key for base rows only.
    timeless_base = (have_existing and coarse_keys
                     and "submitted_at" not in _read_header(FILTERED_CSV))

    tmp_path = FILTERED_CSV + ".tmp"
    seen = set()
    # (handle, problem_id) of rows that came from a base dataset with no
    # submitted_at column. Used to suppress re-crawled copies of them.
    seen_timeless = set()
    written = existing_rows = new_rows = dropped_dupes = 0

    with open(tmp_path, "w", newline="") as out:
        wrote_header = False
        for path in sources:
            is_existing = have_existing and path == FILTERED_CSV
            label = "existing dataset" if is_existing else os.path.basename(path)
            rows_here = 0
            for block in _iter_blocks(path, header):
                rows_here += len(block)
                _log_progress(label, rows_here, written, len(seen))
                if dedup_keys:
                    # Vectorized dedup. Keys are hashed to ints: storing 14M
                    # (str, str, int) tuples costs ~3.7 GB, the hashes ~1.6 GB,
                    # and pandas does the hashing in C rather than per row.
                    kh = pd.util.hash_pandas_object(
                        block[dedup_keys], index=False).to_numpy()
                    if timeless_base:
                        ch = pd.util.hash_pandas_object(
                            block[coarse_keys], index=False).to_numpy()
                    else:
                        ch = None

                    keep = np.fromiter(
                        (k not in seen for k in kh), dtype=bool, count=len(kh))
                    if ch is not None:
                        # A row whose (handle, problem_id) came from a base that
                        # had no submitted_at is the same submission re-crawled,
                        # not a new attempt.
                        keep &= np.fromiter(
                            (c not in seen_timeless for c in ch),
                            dtype=bool, count=len(ch))

                    seen.update(kh[keep].tolist())
                    if is_existing and ch is not None:
                        seen_timeless.update(ch[keep].tolist())

                    dropped_dupes += int((~keep).sum())
                    block = block[keep]
                if block.empty:
                    continue
                block = _finalize_block(block, flag_cols)
                if block.empty:
                    continue
                block.to_csv(out, index=False, header=not wrote_header)
                wrote_header = True
                written += len(block)
            if is_existing:
                existing_rows += rows_here
            else:
                new_rows += rows_here
            log.info("Read %s: %d rows (running output: %d)",
                     label, rows_here, written)

    if not written:
        log.warning("Merge produced no rows — keeping previous dataset")
        os.remove(tmp_path)
        return

    os.replace(tmp_path, FILTERED_CSV)
    log.info("Merged: %d existing + %d new -> %d unique rows (%d duplicates dropped)",
             existing_rows, new_rows, written, dropped_dupes)
    log.info("Saved → %s (%.1f MB)", FILTERED_CSV,
             os.path.getsize(FILTERED_CSV) / 1e6)


def _run_script(script_path: Path, cwd: Path, label: str):
    import subprocess
    if not cwd.is_dir():
        raise RuntimeError(f"Directory not found: {cwd}")
    if not script_path.is_file():
        raise RuntimeError(f"Script not found: {script_path}")
    # Stream output directly — capture_output=True can deadlock if the
    # subprocess produces enough output to fill the OS pipe buffer.
    r = subprocess.run(
        [sys.executable, str(script_path)],
        cwd=str(cwd),
    )
    if r.returncode != 0:
        raise RuntimeError(f"Step failed: {label} (exit {r.returncode})")


def run_preprocessing():
    # Only strength.py produces real output (06_user_tag_strengths.csv,
    # 07_enriched_user_profiles.csv). The other scripts are exploratory only.
    scripts_dir = Path(DATA_DIR) / "ML" / "preprocessing"
    log.info("Preprocessing dir: %s", scripts_dir)
    _run_script(scripts_dir / "strength.py", scripts_dir, "strength.py")


def run_training():
    training_dir = Path(DATA_DIR) / "ML" / "training"
    log.info("Training dir: %s", training_dir)
    for script in ["train_success_model.py", "train_attempts_model.py", "train_rating_progression_model.py"]:
        log.info("Training: %s", script)
        _run_script(training_dir / script, training_dir, script)


def main():
    log.info("=== Merge + retrain ===")
    merge_chunks()
    run_preprocessing()
    run_training()
    log.info("=== Done ===")


if __name__ == "__main__":
    main()
