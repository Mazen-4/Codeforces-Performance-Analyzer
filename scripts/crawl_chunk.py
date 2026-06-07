"""
Job 2 of 3 — Matrix crawl job.

Reads chunks/chunk_N.json, fetches submissions for each handle,
and writes the results to chunks/submissions_N.csv.

New users (not in known_handles.json) get full submission history.
Known users get only submissions since SINCE_DAYS.

Env vars:
  CHUNK_INDEX   - which chunk to process (required)
  SINCE_DAYS    - window for known users (default: 7)
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

DATA_DIR    = os.environ.get("DATA_DIR", str(Path(__file__).parent.parent))
SINCE_DAYS  = int(os.environ.get("SINCE_DAYS", 7))
CHUNK_INDEX = int(os.environ.get("CHUNK_INDEX", 0))
CF_API_BASE = "https://codeforces.com/api"
CF_API_DELAY = 0.5

CHUNKS_DIR  = os.path.join(DATA_DIR, "chunks")

TAGS = [
    "dp", "greedy", "graphs", "math", "strings", "implementation",
    "binary_search", "data_structures", "number_theory", "combinatorics",
    "geometry", "trees", "sortings", "two_pointers", "bitmasks",
    "flows", "fft", "games", "probabilities", "constructive",
]


def cf_get(endpoint, params, retries=4):
    url = f"{CF_API_BASE}/{endpoint}"
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=60)
            data = r.json()
            if data.get("status") == "OK":
                return data["result"]
            log.warning("CF API non-OK (%s): %s", endpoint, data.get("comment", ""))
        except Exception as exc:
            log.warning("Request failed (attempt %d/%d): %s", attempt + 1, retries, exc)
        time.sleep(CF_API_DELAY * (2 ** attempt))
    return None


def parse_submission(sub, since_ts):
    sub_time = sub.get("creationTimeSeconds", 0)
    if since_ts is not None and sub_time < since_ts:
        return "stop"

    problem = sub.get("problem", {})
    verdict  = sub.get("verdict", "")
    tag_set  = set(problem.get("tags", []))
    handle   = sub.get("author", {}).get("members", [{}])[0].get("handle", "")

    if not handle:
        return None

    row = {
        "handle":         handle,
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
    return row


def fetch_user_submissions(handle, since_ts=None):
    rows = []
    batch_size = 100
    for page in range(1, 10_000):
        result = cf_get("user.status", {
            "handle": handle,
            "from": (page - 1) * batch_size + 1,
            "count": batch_size,
        })
        if not result:
            break

        stop = False
        for sub in result:
            parsed = parse_submission(sub, since_ts)
            if parsed == "stop":
                stop = True
                break
            if parsed is not None:
                rows.append(parsed)

        if stop or len(result) < batch_size:
            break
        time.sleep(CF_API_DELAY)

    return rows


def main():
    since_ts = int((datetime.now(tz=timezone.utc) - timedelta(days=SINCE_DAYS)).timestamp())

    chunk_path = os.path.join(CHUNKS_DIR, f"chunk_{CHUNK_INDEX}.json")
    known_path = os.path.join(CHUNKS_DIR, "known_handles.json")

    with open(chunk_path) as f:
        handles = json.load(f)

    known_handles = set()
    if os.path.exists(known_path):
        with open(known_path) as f:
            known_handles = set(json.load(f))

    log.info("Chunk %d: %d handles to crawl", CHUNK_INDEX, len(handles))

    all_rows = []
    for i, handle in enumerate(handles, 1):
        if i % 100 == 0:
            log.info("Progress: %d / %d …", i, len(handles))

        # New users get full history, known users get recent only
        since = since_ts if handle in known_handles else None
        rows = fetch_user_submissions(handle, since_ts=since)
        all_rows.extend(rows)
        time.sleep(CF_API_DELAY)

    out_path = os.path.join(CHUNKS_DIR, f"submissions_{CHUNK_INDEX}.csv")
    if all_rows:
        pd.DataFrame(all_rows).to_csv(out_path, index=False)
        log.info("Chunk %d done: %d submissions → %s", CHUNK_INDEX, len(all_rows), out_path)
    else:
        # Write a header-only CSV so the artifact upload doesn't fail,
        # but include column names so pandas can read it without error
        pd.DataFrame(columns=[
            "handle", "problem_id", "problem_name", "problem_rating",
            "is_ac", "is_wa", "is_tle", "is_mle", "submitted_at",
        ] + [f"tag_{t}" for t in TAGS]).to_csv(out_path, index=False)
        log.info("Chunk %d: no submissions collected", CHUNK_INDEX)


if __name__ == "__main__":
    main()
