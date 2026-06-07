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
import logging
import pandas as pd
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

DATA_DIR   = os.environ.get("DATA_DIR", str(Path(__file__).parent.parent))
NUM_CHUNKS = int(os.environ.get("NUM_CHUNKS", 10))

DATASET_DIR  = os.path.join(DATA_DIR, "ML", "dataset")
MODELS_DIR   = os.path.join(DATA_DIR, "ML", "models")
CHUNKS_DIR   = os.path.join(DATA_DIR, "chunks")
FILTERED_CSV = os.path.join(DATASET_DIR, "04_filtered_submissions.csv")

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


def merge_chunks():
    chunk_dfs = []
    for i in range(NUM_CHUNKS):
        path = os.path.join(CHUNKS_DIR, f"submissions_{i}.csv")
        if not os.path.exists(path):
            log.warning("Chunk %d missing: %s", i, path)
            continue
        try:
            df = pd.read_csv(path)
        except Exception as e:
            log.warning("Chunk %d unreadable (%s): %s", i, path, e)
            continue
        if not df.empty:
            chunk_dfs.append(normalize_schema(df))
            log.info("Chunk %d: %d rows", i, len(df))
        else:
            log.warning("Chunk %d: empty file, skipping", i)

    if not chunk_dfs:
        log.warning("No chunk data found — nothing to merge")
        return

    new_df = pd.concat(chunk_dfs, ignore_index=True)
    log.info("Total new submissions from all chunks: %d", len(new_df))

    if os.path.exists(FILTERED_CSV):
        log.info("Loading existing dataset …")
        existing = normalize_schema(pd.read_csv(FILTERED_CSV))
        combined = pd.concat([existing, new_df], ignore_index=True)
        if "submitted_at" in combined.columns:
            combined = combined.sort_values("submitted_at", ascending=False)
        # Dedup on the unique SUBMISSION, not the problem. Keying on
        # (handle, problem_id) alone collapses every attempt of a problem into a
        # single row, zeroing the per-problem WA counts that the attempts and
        # strength models depend on (they aggregate is_wa with .sum()). Including
        # submitted_at keeps each distinct attempt while still removing genuine
        # duplicates re-crawled across weekly runs.
        dedup_keys = ["handle", "problem_id"]
        if "submitted_at" in combined.columns:
            dedup_keys.append("submitted_at")
        combined = combined.drop_duplicates(subset=dedup_keys, keep="first")
        log.info("Merged: %d existing + %d new = %d unique rows",
                 len(existing), len(new_df), len(combined))
    else:
        log.info("No existing dataset — creating fresh.")
        combined = new_df

    combined = drop_unrated(combined)

    combined.to_csv(FILTERED_CSV, index=False)
    log.info("Saved → %s (%.1f MB)", FILTERED_CSV, os.path.getsize(FILTERED_CSV) / 1e6)


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
