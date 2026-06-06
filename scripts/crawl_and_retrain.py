"""
Incremental crawler + retraining job.

Strategy:
  1. Fetch all recent contest handles via contestRatingChanges (~2 calls/contest, very fast)
  2. Split into NEW users (not in dataset) vs KNOWN users (already have submissions)
  3. New users  → fetch ALL their submissions (user.status, no time cap)
  4. Known users → fetch only submissions since SINCE_DAYS (user.status, stops early)
  5. Merge into 04_filtered_submissions.csv, deduplicate
  6. Rebuild preprocessing CSVs
  7. Retrain all three LightGBM models

Env vars:
  DATA_DIR      - project root (default: repo root, so ML/ is relative)
  SINCE_DAYS    - how far back to look for new contests + known-user submissions (default: 7)
  CF_MIN_RATING - minimum CF rating to include (default: 900)
  CF_MAX_RATING - maximum CF rating to include (default: 3500)
"""

import os
import sys
import time
import logging
import requests
import pandas as pd
from datetime import datetime, timezone, timedelta
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

DATA_DIR      = os.environ.get("DATA_DIR", str(Path(__file__).parent.parent))
DATASET_DIR   = os.path.join(DATA_DIR, "ML", "dataset")
MODELS_DIR    = os.path.join(DATA_DIR, "ML", "models")
SINCE_DAYS    = int(os.environ.get("SINCE_DAYS", 7))
CF_MIN_RATING = int(os.environ.get("CF_MIN_RATING", 900))
CF_MAX_RATING = int(os.environ.get("CF_MAX_RATING", 3500))
CF_API_BASE   = "https://codeforces.com/api"
CF_API_DELAY  = 0.5  # seconds between API calls

FILTERED_CSV  = os.path.join(DATASET_DIR, "04_filtered_submissions.csv")

TAGS = [
    "dp", "greedy", "graphs", "math", "strings", "implementation",
    "binary_search", "data_structures", "number_theory", "combinatorics",
    "geometry", "trees", "sortings", "two_pointers", "bitmasks",
    "flows", "fft", "games", "probabilities", "constructive",
]

os.makedirs(DATASET_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

# ── API helper ────────────────────────────────────────────────────────────────

def cf_get(endpoint: str, params: dict, retries: int = 4):
    url = f"{CF_API_BASE}/{endpoint}"
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=30)
            data = r.json()
            if data.get("status") == "OK":
                return data["result"]
            log.warning("CF API non-OK (%s): %s", endpoint, data.get("comment", ""))
        except Exception as exc:
            log.warning("Request failed (attempt %d/%d): %s", attempt + 1, retries, exc)
        time.sleep(CF_API_DELAY * (2 ** attempt))
    return None


# ── Stage 1: Collect participant handles from recent contests ─────────────────

def get_recent_contest_ids(since_ts: int) -> list[int]:
    """Return IDs of finished non-gym contests that ended after since_ts."""
    result = cf_get("contest.list", {"gym": "false"})
    if not result:
        raise RuntimeError("Failed to fetch contest list")

    ids = []
    for c in result:
        if c.get("phase") != "FINISHED":
            continue
        end_ts = c.get("startTimeSeconds", 0) + c.get("durationSeconds", 0)
        if end_ts < since_ts:
            break  # sorted newest-first; everything after is older
        ids.append(c["id"])

    log.info("Found %d finished contests in the last %d days", len(ids), SINCE_DAYS)
    return ids


def get_participants(contest_ids: list[int], rated_users: dict) -> set[str]:
    """
    Use contestRatingChanges to get every handle that participated in each contest.
    Returns handles that are within the rating window.
    Only 1 API call per contest — very fast.
    """
    handles = set()
    for i, cid in enumerate(contest_ids, 1):
        result = cf_get("contest.ratingChanges", {"contestId": cid})
        if not result:
            log.warning("No rating changes for contest %d (unrated or error)", cid)
            continue
        for entry in result:
            h = entry.get("handle", "")
            if h in rated_users:
                handles.add(h)
        log.info("[%d/%d] Contest %d → %d qualifying participants (total unique so far: %d)",
                 i, len(contest_ids), cid, len(result), len(handles))
        time.sleep(CF_API_DELAY)

    log.info("Total unique handles from recent contests: %d", len(handles))
    return handles


# ── Stage 2: Split into new vs known users ────────────────────────────────────

def split_new_and_known(handles: set[str]) -> tuple[list[str], list[str]]:
    """
    Compare handles against existing dataset.
    Returns (new_handles, known_handles).
    """
    if not os.path.exists(FILTERED_CSV):
        log.info("No existing dataset — all %d handles are new", len(handles))
        return list(handles), []

    existing_handles = set(pd.read_csv(FILTERED_CSV, usecols=["handle"])["handle"].unique())
    new_handles   = [h for h in handles if h not in existing_handles]
    known_handles = [h for h in handles if h in existing_handles]

    log.info(
        "Split: %d new users (fetch all submissions) | %d known users (fetch since %d days ago)",
        len(new_handles), len(known_handles), SINCE_DAYS,
    )
    return new_handles, known_handles


# ── Stage 3: Fetch submissions ────────────────────────────────────────────────

def _parse_submission(sub: dict, since_ts: int | None) -> dict | None | str:
    """
    Parse one submission dict into a row.
    Returns 'stop' if older than since_ts (only when since_ts is set).
    Returns None to skip. Returns a dict row if valid.
    """
    sub_time = sub.get("creationTimeSeconds", 0)
    if since_ts is not None and sub_time < since_ts:
        return "stop"

    problem = sub.get("problem", {})
    verdict  = sub.get("verdict", "")
    tag_set  = set(problem.get("tags", []))

    row = {
        "handle":         sub.get("author", {}).get("members", [{}])[0].get("handle", ""),
        "problem_id":     f"{problem.get('contestId', '')}_{problem.get('index', '')}",
        "problem_name":   problem.get("name", ""),
        "problem_rating": problem.get("rating"),
        "is_ac":          int(verdict == "OK"),
        "is_wa":          int(verdict in ("WRONG_ANSWER", "TIME_LIMIT_EXCEEDED", "MEMORY_LIMIT_EXCEEDED")),
        "is_tle":         int(verdict == "TIME_LIMIT_EXCEEDED"),
        "is_mle":         int(verdict == "MEMORY_LIMIT_EXCEEDED"),
        "submitted_at":   sub_time,
    }
    for tag in TAGS:
        row[f"tag_{tag}"] = int(tag in tag_set)
    return row if row["handle"] else None


def fetch_user_submissions(handle: str, since_ts: int | None = None) -> list[dict]:
    """
    Fetch submissions for one user.
    since_ts=None  → fetch ALL submissions (for new users).
    since_ts=<ts>  → fetch only recent ones, stopping early once past the window.
    """
    rows = []
    batch_size = 100
    page = 1

    while True:
        result = cf_get("user.status", {
            "handle": handle,
            "from": (page - 1) * batch_size + 1,
            "count": batch_size,
        })
        if not result:
            break

        stop = False
        for sub in result:
            parsed = _parse_submission(sub, since_ts)
            if parsed == "stop":
                stop = True
                break
            if parsed is not None:
                rows.append(parsed)

        if stop or len(result) < batch_size:
            break
        page += 1
        time.sleep(CF_API_DELAY)

    return rows


def crawl_all(new_handles: list[str], known_handles: list[str], since_ts: int) -> pd.DataFrame:
    all_rows = []
    total = len(new_handles) + len(known_handles)
    done = 0

    # New users — fetch everything
    for handle in new_handles:
        done += 1
        if done % 100 == 0:
            log.info("Progress: %d / %d users …", done, total)
        rows = fetch_user_submissions(handle, since_ts=None)
        all_rows.extend(rows)
        time.sleep(CF_API_DELAY)

    log.info("New users done: %d submissions collected", len(all_rows))
    checkpoint = len(all_rows)

    # Known users — fetch only within the window
    for handle in known_handles:
        done += 1
        if done % 200 == 0:
            log.info("Progress: %d / %d users …", done, total)
        rows = fetch_user_submissions(handle, since_ts=since_ts)
        all_rows.extend(rows)
        time.sleep(CF_API_DELAY)

    log.info(
        "Known users done: %d additional submissions collected",
        len(all_rows) - checkpoint,
    )
    return pd.DataFrame(all_rows) if all_rows else pd.DataFrame()


# ── Stage 4: Merge into existing dataset ─────────────────────────────────────

def merge_into_dataset(new_df: pd.DataFrame):
    if new_df.empty:
        log.info("No new submissions to merge.")
        return

    if os.path.exists(FILTERED_CSV):
        log.info("Loading existing dataset …")
        existing = pd.read_csv(FILTERED_CSV)
        combined = pd.concat([existing, new_df], ignore_index=True)
        if "submitted_at" in combined.columns:
            combined = combined.sort_values("submitted_at", ascending=False)
        combined = combined.drop_duplicates(subset=["handle", "problem_id"], keep="first")
        log.info(
            "Merged: %d existing + %d new = %d unique rows",
            len(existing), len(new_df), len(combined),
        )
    else:
        log.info("No existing dataset — creating fresh.")
        combined = new_df

    combined.to_csv(FILTERED_CSV, index=False)
    log.info("Saved → %s (%.1f MB)", FILTERED_CSV, os.path.getsize(FILTERED_CSV) / 1e6)


# ── Stage 5: Preprocessing ───────────────────────────────────────────────────

def run_preprocessing():
    import subprocess
    scripts_dir = Path(__file__).parent.parent / "ML" / "preprocessing"
    for script in ["submissionsCleaning.py", "strength.py", "userProfiles.py", "userTagStrengths.py"]:
        log.info("Preprocessing: %s", script)
        r = subprocess.run(
            [sys.executable, script],
            capture_output=True, text=True,
            # Run from the preprocessing dir so '../dataset/' relative paths resolve correctly
            cwd=str(scripts_dir),
            env={**os.environ, "DATA_DIR": DATA_DIR},
        )
        if r.returncode != 0:
            log.error("Failed:\n%s", r.stderr[-2000:])
            raise RuntimeError(f"Preprocessing step failed: {script}")
        if r.stdout.strip():
            log.info(r.stdout.strip())


# ── Stage 6: Retraining ──────────────────────────────────────────────────────

def run_training():
    import subprocess
    training_dir = Path(__file__).parent.parent / "ML" / "training"
    for script in ["train_success_model.py", "train_attempts_model.py", "train_rating_progression_model.py"]:
        log.info("Training: %s", script)
        r = subprocess.run(
            [sys.executable, script],
            capture_output=True, text=True,
            # Run from the training dir so '../dataset/' and '../models/' paths resolve correctly
            cwd=str(training_dir),
            env={**os.environ, "DATA_DIR": DATA_DIR},
        )
        if r.returncode != 0:
            log.error("Failed:\n%s", r.stderr[-2000:])
            raise RuntimeError(f"Training step failed: {script}")
        if r.stdout.strip():
            log.info(r.stdout.strip())


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    since_ts = int((datetime.now(tz=timezone.utc) - timedelta(days=SINCE_DAYS)).timestamp())

    log.info("=== CF Analyzer incremental crawl + retrain ===")
    log.info("Window: last %d days (since %s) | Rating: %d–%d",
             SINCE_DAYS,
             datetime.fromtimestamp(since_ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
             CF_MIN_RATING, CF_MAX_RATING)

    # Fetch full rated list once — used for rating filtering and as a lookup
    log.info("Fetching rated user list …")
    rated = cf_get("user.ratedList", {"activeOnly": "false"}) or []
    rated_users = {
        u["handle"]: u.get("rating", 0)
        for u in rated
        if CF_MIN_RATING <= u.get("rating", 0) <= CF_MAX_RATING
    }
    log.info("Rated users in range %d–%d: %d", CF_MIN_RATING, CF_MAX_RATING, len(rated_users))

    # Get handles of everyone who participated in a recent contest
    contest_ids = get_recent_contest_ids(since_ts)
    if not contest_ids:
        log.info("No finished contests in the last %d days — nothing to do.", SINCE_DAYS)
        return

    handles = get_participants(contest_ids, rated_users)
    if not handles:
        log.info("No qualifying participants found.")
        return

    # Split and crawl
    new_handles, known_handles = split_new_and_known(handles)
    new_df = crawl_all(new_handles, known_handles, since_ts)
    log.info("Total submissions collected: %d", len(new_df))

    merge_into_dataset(new_df)
    run_preprocessing()
    run_training()

    log.info("=== Done ===")


if __name__ == "__main__":
    main()
