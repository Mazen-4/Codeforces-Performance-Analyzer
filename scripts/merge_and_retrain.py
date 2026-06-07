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


def merge_chunks():
    chunk_dfs = []
    for i in range(NUM_CHUNKS):
        path = os.path.join(CHUNKS_DIR, f"submissions_{i}.csv")
        if not os.path.exists(path):
            log.warning("Chunk %d missing: %s", i, path)
            continue
        df = pd.read_csv(path)
        if not df.empty:
            chunk_dfs.append(df)
            log.info("Chunk %d: %d rows", i, len(df))

    if not chunk_dfs:
        log.warning("No chunk data found — nothing to merge")
        return

    new_df = pd.concat(chunk_dfs, ignore_index=True)
    log.info("Total new submissions from all chunks: %d", len(new_df))

    if os.path.exists(FILTERED_CSV):
        log.info("Loading existing dataset …")
        existing = pd.read_csv(FILTERED_CSV)
        combined = pd.concat([existing, new_df], ignore_index=True)
        if "submitted_at" in combined.columns:
            combined = combined.sort_values("submitted_at", ascending=False)
        combined = combined.drop_duplicates(subset=["handle", "problem_id"], keep="first")
        log.info("Merged: %d existing + %d new = %d unique rows",
                 len(existing), len(new_df), len(combined))
    else:
        log.info("No existing dataset — creating fresh.")
        combined = new_df

    combined.to_csv(FILTERED_CSV, index=False)
    log.info("Saved → %s (%.1f MB)", FILTERED_CSV, os.path.getsize(FILTERED_CSV) / 1e6)


def _run_script(script_path: Path, cwd: Path, label: str):
    import subprocess
    if not cwd.is_dir():
        raise RuntimeError(f"Directory not found: {cwd}")
    if not script_path.is_file():
        raise RuntimeError(f"Script not found: {script_path}")
    r = subprocess.run(
        [sys.executable, str(script_path)],
        capture_output=True, text=True,
        cwd=str(cwd),
    )
    if r.returncode != 0:
        log.error("Failed %s:\n%s", label, r.stderr[-2000:])
        raise RuntimeError(f"Step failed: {label}")
    if r.stdout.strip():
        log.info(r.stdout.strip())


def run_preprocessing():
    scripts_dir = Path(DATA_DIR) / "ML" / "preprocessing"
    log.info("Preprocessing dir: %s", scripts_dir)
    for script in ["submissionsCleaning.py", "strength.py", "userProfiles.py", "userTagStrengths.py"]:
        log.info("Preprocessing: %s", script)
        _run_script(scripts_dir / script, scripts_dir, script)


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
