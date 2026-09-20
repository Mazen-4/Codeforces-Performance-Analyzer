"""Verify Postgres matches the freshly-merged CSVs.

Runs in CI between the load and the Railway redeploy. The point is to catch a
database that silently did not update: without this, the workflow would still
go green and redeploy, and the website would keep serving stale data while
every step reported success — the same class of false-success bug that let the
dataset sit frozen for months.

Exit codes: 0 = verified, 1 = mismatch or unreachable.
"""

import os
import sys
import csv
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.db.connection import raw_connection, database_url  # noqa: E402

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

DATA_DIR = os.environ.get("DATA_DIR", str(Path(__file__).resolve().parents[2]))
DATASET_DIR = os.path.join(DATA_DIR, "ML", "dataset")

# table -> (csv, tolerance). Tolerance covers rows the loader legitimately
# drops: corrupted "#NAME?" handles and duplicate primary keys.
CHECKS = {
    "submissions":        ("04_filtered_submissions.csv", 0),
    "user_tag_strengths": ("06_user_tag_strengths.csv", 100),
    "user_profiles":      ("02_user_profiles.csv", 100),
}


def csv_rows(path):
    """Count data rows without loading the file."""
    with open(path, "rb") as f:
        return max(sum(1 for _ in f) - 1, 0)


def main():
    if not database_url():
        log.info("DATABASE_URL not set — nothing to verify")
        return 0

    conn = raw_connection()
    failures = []
    try:
        with conn.cursor() as cur:
            for table, (csv_name, tol) in CHECKS.items():
                path = os.path.join(DATASET_DIR, csv_name)
                if not os.path.exists(path):
                    log.warning("%s: %s not present — skipping", table, csv_name)
                    continue

                expected = csv_rows(path)
                cur.execute(f"SELECT count(*) FROM {table}")
                actual = cur.fetchone()[0]
                delta = expected - actual

                if actual == 0:
                    failures.append(f"{table}: table is EMPTY (csv has {expected})")
                elif delta > tol or delta < -tol:
                    failures.append(
                        f"{table}: csv={expected} db={actual} (delta {delta}, "
                        f"tolerance {tol})")
                else:
                    log.info("%s: csv=%d db=%d (delta %d) OK",
                             table, expected, actual, delta)

            # The index is what makes the website fast; a load that lost it
            # would still return correct rows but crawl.
            cur.execute("""
                SELECT count(*) FROM pg_indexes
                WHERE tablename = 'submissions' AND indexname = 'submissions_handle_idx'
            """)
            if cur.fetchone()[0] != 1:
                failures.append("submissions_handle_idx is missing")
            else:
                log.info("submissions_handle_idx present OK")

            # Prove an actual website-shaped read works end to end.
            cur.execute("SELECT handle FROM submissions LIMIT 1")
            row = cur.fetchone()
            if row:
                cur.execute("SELECT count(*) FROM submissions WHERE handle = ANY(%s)",
                            ([row[0]],))
                log.info("sample lookup for %r returned %d rows", row[0], cur.fetchone()[0])
    finally:
        conn.close()

    if failures:
        for f in failures:
            log.error("MISMATCH: %s", f)
        log.error("Postgres does NOT match the merged dataset — "
                  "not safe to redeploy the website")
        return 1

    log.info("Postgres matches the merged dataset")
    return 0


if __name__ == "__main__":
    sys.exit(main())
