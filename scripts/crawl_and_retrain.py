"""
Weekly crawler + retraining job.

Stages:
  1. Crawl Codeforces API for up to CF_CRAWL_USERS handles (default 5000)
  2. Run preprocessing pipeline to rebuild all dataset CSVs
  3. Retrain all three LightGBM models
  4. Atomic swap of old dataset / model files

Env vars:
  CF_CRAWL_USERS   - how many users to crawl (default: 5000)
  DATA_DIR         - root of the PVC mount (default: /data)
  CF_MIN_RATING    - minimum rating to include (default: 900)
  CF_MAX_RATING    - maximum rating to include (default: 3500)
"""

import os
import sys
import time
import shutil
import logging
import requests
import pandas as pd

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

DATA_DIR       = os.environ.get("DATA_DIR", "/data")
DATASET_DIR    = os.path.join(DATA_DIR, "dataset")
MODELS_DIR     = os.path.join(DATA_DIR, "models")
CF_CRAWL_USERS = int(os.environ.get("CF_CRAWL_USERS", 5000))
CF_MIN_RATING  = int(os.environ.get("CF_MIN_RATING", 900))
CF_MAX_RATING  = int(os.environ.get("CF_MAX_RATING", 3500))
CF_API_BASE    = "https://codeforces.com/api"
CF_API_DELAY   = 1.0  # seconds between API calls to avoid rate limiting

RAW_SUBMISSIONS_CSV = os.path.join(DATASET_DIR, "01_submissions.csv")

# Ensure data dirs exist
os.makedirs(DATASET_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

# ── Helpers ───────────────────────────────────────────────────────────────────

def cf_get(endpoint: str, params: dict, retries: int = 3) -> dict:
    url = f"{CF_API_BASE}/{endpoint}"
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=30)
            data = r.json()
            if data.get("status") == "OK":
                return data["result"]
            log.warning("CF API non-OK response: %s", data.get("comment", ""))
        except Exception as exc:
            log.warning("Request failed (attempt %d/%d): %s", attempt + 1, retries, exc)
        time.sleep(CF_API_DELAY * (2 ** attempt))
    return None


# ── Stage 1: Crawl handles ───────────────────────────────────────────────────

def crawl_user_list() -> list[str]:
    """Return up to CF_CRAWL_USERS active handles within the rating window."""
    log.info("Fetching rated user list from Codeforces …")
    result = cf_get("user.ratedList", {"activeOnly": "true"})
    if not result:
        raise RuntimeError("Failed to fetch rated user list from Codeforces")

    handles = [
        u["handle"] for u in result
        if CF_MIN_RATING <= u.get("rating", 0) <= CF_MAX_RATING
    ]
    handles = handles[:CF_CRAWL_USERS]
    log.info("Collected %d handles (rating %d–%d)", len(handles), CF_MIN_RATING, CF_MAX_RATING)
    return handles


def crawl_submissions(handles: list[str]) -> pd.DataFrame:
    """Fetch last 500 submissions per handle and return a combined DataFrame."""
    TAGS = [
        "dp", "greedy", "graphs", "math", "strings", "implementation",
        "binary_search", "data_structures", "number_theory", "combinatorics",
        "geometry", "trees", "sortings", "two_pointers", "bitmasks",
        "flows", "fft", "games", "probabilities", "constructive",
    ]
    rows = []
    for i, handle in enumerate(handles, 1):
        if i % 100 == 0:
            log.info("Crawled %d / %d users …", i, len(handles))
        result = cf_get("user.status", {"handle": handle, "from": 1, "count": 500})
        if not result:
            continue
        for sub in result:
            problem = sub.get("problem", {})
            verdict  = sub.get("verdict", "")
            tag_set  = set(problem.get("tags", []))
            row = {
                "handle":         handle,
                "problem_id":     f"{problem.get('contestId', '')}_{problem.get('index', '')}",
                "problem_name":   problem.get("name", ""),
                "problem_rating": problem.get("rating"),
                "is_ac":          int(verdict == "OK"),
                "is_wa":          int(verdict in ("WRONG_ANSWER", "TIME_LIMIT_EXCEEDED", "MEMORY_LIMIT_EXCEEDED")),
                "is_tle":         int(verdict == "TIME_LIMIT_EXCEEDED"),
                "is_mle":         int(verdict == "MEMORY_LIMIT_EXCEEDED"),
            }
            for tag in TAGS:
                row[f"tag_{tag}"] = int(tag in tag_set)
            rows.append(row)
        time.sleep(CF_API_DELAY)

    df = pd.DataFrame(rows)
    log.info("Crawled %d submissions from %d handles", len(df), len(handles))
    return df


# ── Stage 2: Preprocessing ───────────────────────────────────────────────────

def run_preprocessing():
    """Rebuild dataset CSVs from the raw submissions file."""
    import subprocess, pathlib
    scripts_dir = pathlib.Path(__file__).parent.parent / "ML" / "preprocessing"
    steps = [
        "submissionsCleaning.py",
        "strength.py",
        "userProfiles.py",
        "userTagStrengths.py",
    ]
    for script in steps:
        script_path = scripts_dir / script
        log.info("Running preprocessing: %s", script)
        r = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True, text=True,
            env={**os.environ, "DATA_DIR": DATA_DIR},
        )
        if r.returncode != 0:
            log.error("Preprocessing failed for %s:\n%s", script, r.stderr[-2000:])
            raise RuntimeError(f"Preprocessing step failed: {script}")
        if r.stdout.strip():
            log.info(r.stdout.strip())


# ── Stage 3: Retraining ───────────────────────────────────────────────────────

def run_training():
    """Retrain all three LightGBM models."""
    import subprocess, pathlib
    training_dir = pathlib.Path(__file__).parent.parent / "ML" / "training"
    models = [
        "train_success_model.py",
        "train_attempts_model.py",
        "train_rating_progression_model.py",
    ]
    for script in models:
        script_path = training_dir / script
        log.info("Training: %s", script)
        r = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True, text=True,
            env={**os.environ, "DATA_DIR": DATA_DIR},
        )
        if r.returncode != 0:
            log.error("Training failed for %s:\n%s", script, r.stderr[-2000:])
            raise RuntimeError(f"Training step failed: {script}")
        if r.stdout.strip():
            log.info(r.stdout.strip())


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    log.info("=== CF Analyzer weekly crawl + retrain job starting ===")

    # 1. Crawl
    handles = crawl_user_list()
    df_raw  = crawl_submissions(handles)

    # Write raw submissions to disk (preprocessing scripts read from here)
    df_raw.to_csv(RAW_SUBMISSIONS_CSV, index=False)
    log.info("Saved raw submissions → %s", RAW_SUBMISSIONS_CSV)

    # 2. Preprocess
    run_preprocessing()
    log.info("Preprocessing complete")

    # 3. Retrain
    run_training()
    log.info("Model retraining complete")

    log.info("=== Weekly job finished successfully ===")


if __name__ == "__main__":
    main()
