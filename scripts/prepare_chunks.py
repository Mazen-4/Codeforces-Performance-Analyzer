"""
Job 1 of 3 — Setup job.

- Fetches rated user list
- Gets all participant handles from recent contests via contestRatingChanges
- Splits handles into N chunks
- Writes chunks/chunk_N.json for the matrix crawl jobs to consume
- Writes chunks/known_handles.txt (handles already in dataset) for routing

Env vars:
  SINCE_DAYS    - contest window (default: 7)
  CF_MIN_RATING - min rating (default: 900)
  CF_MAX_RATING - max rating (default: 3500)
  NUM_CHUNKS    - number of parallel chunks (default: 10)
  DATA_DIR      - project root (default: current dir)
"""

import os
import json
import time
import logging
import requests
import pandas as pd
from datetime import datetime, timezone, timedelta
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

DATA_DIR      = os.environ.get("DATA_DIR", str(Path(__file__).parent.parent))
SINCE_DAYS    = int(os.environ.get("SINCE_DAYS", 7))
CF_MIN_RATING = int(os.environ.get("CF_MIN_RATING", 900))
CF_MAX_RATING = int(os.environ.get("CF_MAX_RATING", 3500))
NUM_CHUNKS    = int(os.environ.get("NUM_CHUNKS", 10))
CF_API_BASE   = "https://codeforces.com/api"
CF_API_DELAY  = 0.5

FILTERED_CSV  = os.path.join(DATA_DIR, "ML", "dataset", "04_filtered_submissions.csv")
CHUNKS_DIR    = os.path.join(DATA_DIR, "chunks")

os.makedirs(CHUNKS_DIR, exist_ok=True)


def cf_get(endpoint, params, retries=4):
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


def get_recent_contest_ids(since_ts):
    result = cf_get("contest.list", {"gym": "false"})
    if not result:
        raise RuntimeError("Failed to fetch contest list")
    ids = []
    for c in result:
        if c.get("phase") != "FINISHED":
            continue
        end_ts = c.get("startTimeSeconds", 0) + c.get("durationSeconds", 0)
        if end_ts < since_ts:
            break
        ids.append(c["id"])
    log.info("Found %d contests in the last %d days", len(ids), SINCE_DAYS)
    return ids


def main():
    since_ts = int((datetime.now(tz=timezone.utc) - timedelta(days=SINCE_DAYS)).timestamp())

    log.info("Fetching rated user list …")
    rated = cf_get("user.ratedList", {"activeOnly": "false"}) or []
    rated_users = {
        u["handle"]: u.get("rating", 0)
        for u in rated
        if CF_MIN_RATING <= u.get("rating", 0) <= CF_MAX_RATING
    }
    log.info("Rated users in range: %d", len(rated_users))

    # Get participant handles from recent contests
    contest_ids = get_recent_contest_ids(since_ts)
    handles = set()
    for i, cid in enumerate(contest_ids, 1):
        result = cf_get("contest.ratingChanges", {"contestId": cid})
        if not result:
            continue
        for entry in result:
            h = entry.get("handle", "")
            if h in rated_users:
                handles.add(h)
        log.info("[%d/%d] Contest %d → %d total unique handles", i, len(contest_ids), cid, len(handles))
        time.sleep(CF_API_DELAY)

    log.info("Total unique handles: %d", len(handles))

    # Determine which are new vs known
    known_in_dataset = set()
    if os.path.exists(FILTERED_CSV):
        known_in_dataset = set(pd.read_csv(FILTERED_CSV, usecols=["handle"])["handle"].unique())

    handles = list(handles)
    new_handles   = [h for h in handles if h not in known_in_dataset]
    known_handles = [h for h in handles if h in known_in_dataset]

    log.info("New users: %d | Known users: %d", len(new_handles), len(known_handles))

    # Write known handles list so crawl jobs can decide fetch strategy
    with open(os.path.join(CHUNKS_DIR, "known_handles.json"), "w") as f:
        json.dump(known_handles, f)

    # Split all handles into N chunks
    all_handles = new_handles + known_handles  # new first so they get full fetch
    chunk_size = max(1, len(all_handles) // NUM_CHUNKS + 1)
    chunks = [all_handles[i:i+chunk_size] for i in range(0, len(all_handles), chunk_size)]

    # Pad to exactly NUM_CHUNKS (some may be empty)
    while len(chunks) < NUM_CHUNKS:
        chunks.append([])

    for i, chunk in enumerate(chunks):
        path = os.path.join(CHUNKS_DIR, f"chunk_{i}.json")
        with open(path, "w") as f:
            json.dump(chunk, f)
        log.info("Chunk %d: %d handles → %s", i, len(chunk), path)

    # Output the matrix config for GitHub Actions
    matrix = {"chunk": list(range(len(chunks)))}
    print(f"MATRIX={json.dumps(matrix)}")
    log.info("Done — %d chunks written to %s", len(chunks), CHUNKS_DIR)


if __name__ == "__main__":
    main()
