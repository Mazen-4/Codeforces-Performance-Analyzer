"""Load the merged CSVs into Postgres.

Runs after scripts/merge_and_retrain.py. The CSV stays the intermediate
artifact (and the release asset), so the merge logic and its regression tests
are untouched — this only adds a publish step.

Loading goes into a staging table and then swaps it in inside one transaction.
A partially-loaded 14M-row table must never be visible to the website, and the
old table survives until the swap commits, so a failed load changes nothing.

Usage:
  DATABASE_URL=... python scripts/db/load.py
  DATABASE_URL=... python scripts/db/load.py --table submissions

Env:
  DATA_DIR  - project root (default: repo root)
"""

import os
import sys
import csv
import time
import logging
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.db.connection import raw_connection  # noqa: E402

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

DATA_DIR = os.environ.get("DATA_DIR", str(Path(__file__).resolve().parents[2]))
DATASET_DIR = os.path.join(DATA_DIR, "ML", "dataset")

# table -> (csv file, columns to load). Columns are resolved against the CSV
# header at run time so a schema-drifted file loads what it has and defaults
# the rest, rather than failing the whole load.
TABLES = {
    "submissions": "04_filtered_submissions.csv",
    "user_tag_strengths": "06_user_tag_strengths.csv",
    "user_profiles": "02_user_profiles.csv",
}


def _apply_schema(cur):
    """Run scripts/db/schema.sql. Idempotent — safe on every load."""
    path = Path(__file__).with_name("schema.sql")
    if not path.is_file():
        raise RuntimeError(f"schema.sql not found at {path}")
    cur.execute(path.read_text())


def _csv_rows(rows) -> str:
    """Serialize rows back to CSV text for COPY, quoting everything so empty
    fields stay distinguishable and embedded commas survive."""
    import io
    out = io.StringIO()
    w = csv.writer(out, quoting=csv.QUOTE_ALL)
    w.writerows(rows)
    return out.getvalue()


def _table_columns(cur, table):
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = %s AND table_schema = 'public'
    """, (table,))
    return {r[0] for r in cur.fetchall()}


def _csv_header(path):
    with open(path, newline="") as f:
        return next(csv.reader(f))


def load_table(conn, table, csv_name):
    path = os.path.join(DATASET_DIR, csv_name)
    if not os.path.exists(path):
        log.warning("%s: %s not found — skipping", table, path)
        return False

    with conn.cursor() as cur:
        db_cols = _table_columns(cur, table)
        if not db_cols:
            # Bootstrap a fresh database rather than failing the weekly run.
            # schema.sql is idempotent (CREATE TABLE IF NOT EXISTS).
            log.info("%s missing — applying schema.sql", table)
            _apply_schema(cur)
            db_cols = _table_columns(cur, table)
        if not db_cols:
            raise RuntimeError(
                f"Table {table} does not exist and schema.sql did not create it.")

        header = _csv_header(path)
        # Intersection, in CSV order: tolerate a CSV that has extra columns
        # (older/newer crawler) or is missing optional ones.
        cols = [c for c in header if c in db_cols]
        missing = db_cols - set(cols)
        if not cols:
            raise RuntimeError(f"{table}: no overlapping columns with {csv_name}")
        if missing:
            log.info("%s: CSV has no %s — those keep their column defaults",
                     table, ", ".join(sorted(missing)))

        staging = f"{table}_staging"
        cur.execute(f"DROP TABLE IF EXISTS {staging}")
        # INCLUDING ALL carries defaults/NOT NULL but not indexes we build later.
        cur.execute(f"CREATE TABLE {staging} (LIKE {table} INCLUDING DEFAULTS "
                    f"INCLUDING CONSTRAINTS)")

        collist = ", ".join(f'"{c}"' for c in cols)
        t0 = time.time()
        log.info("%s: COPY from %s (%.0f MB) …",
                 table, csv_name, os.path.getsize(path) / 1e6)

        # strength.py writes with csv.QUOTE_ALL, so a NaN lands as a quoted
        # empty string. Postgres rejects "" for real/int columns, so declare it
        # as the NULL marker; FORCE_NULL applies that to quoted empties too.
        numeric_cols = [c for c in cols if c not in ("handle", "tag",
                                                     "problem_id", "problem_name")]
        force_null = ""
        if numeric_cols:
            force_null = (", FORCE_NULL (" +
                          ", ".join(f'"{c}"' for c in numeric_cols) + ")")
        copy_sql = (f"COPY {staging} ({collist}) FROM STDIN "
                    f"WITH (FORMAT csv, HEADER true, NULL ''{force_null})")

        if len(cols) == len(header):
            # Same columns in the same order: stream the file straight through.
            with open(path, "rb") as f, cur.copy(copy_sql) as cp:
                while chunk := f.read(1 << 20):
                    cp.write(chunk)
        else:
            # The CSV carries columns this table does not want (e.g.
            # 02_user_profiles.csv has 51 columns, user_profiles keeps 3).
            # Project to the wanted columns while streaming, so the whole file
            # is never held in memory.
            idx = [header.index(c) for c in cols]
            with open(path, newline="") as f, cur.copy(copy_sql) as cp:
                reader = csv.reader(f)
                next(reader, None)          # drop the source header
                # COPY was told HEADER true, so feed it one header line that
                # matches the projected column list.
                cp.write(_csv_rows([cols]))
                buf = []
                for row in reader:
                    if len(row) <= idx[-1]:
                        continue            # short/ragged line
                    buf.append([row[i] for i in idx])
                    if len(buf) >= 50_000:
                        cp.write(_csv_rows(buf))
                        buf = []
                if buf:
                    cp.write(_csv_rows(buf))

        cur.execute(f"SELECT count(*) FROM {staging}")
        n = cur.fetchone()[0]
        log.info("%s: %d rows copied in %.0fs", table, n, time.time() - t0)

        if n == 0:
            raise RuntimeError(f"{table}: staging table is empty — refusing to swap")

        # The released CSVs carry Excel-corrupted handles ("#NAME?") that
        # strength.py drops at read time; they collide on the primary key here.
        # Remove them, then collapse any remaining duplicate keys.
        if table in ("user_profiles", "user_tag_strengths"):
            cur.execute(f"DELETE FROM {staging} WHERE handle = '#NAME?' "
                        f"OR handle IS NULL OR btrim(handle) = ''")
            removed = cur.rowcount
            if removed:
                log.info("%s: dropped %d corrupted handle rows", table, removed)

        if table == "user_profiles":
            cur.execute(f"""
                DELETE FROM {staging} a USING {staging} b
                WHERE a.ctid < b.ctid AND a.handle = b.handle
            """)
            if cur.rowcount:
                log.info("%s: collapsed %d duplicate handles", table, cur.rowcount)
        elif table == "user_tag_strengths":
            cur.execute(f"""
                DELETE FROM {staging} a USING {staging} b
                WHERE a.ctid < b.ctid AND a.handle = b.handle AND a.tag = b.tag
            """)
            if cur.rowcount:
                log.info("%s: collapsed %d duplicate (handle, tag) rows",
                         table, cur.rowcount)

        # Rebuild whatever the real table has on it.
        if table == "submissions":
            log.info("%s: building handle index …", table)
            cur.execute(f"CREATE INDEX {staging}_handle_idx ON {staging} (handle)")
        elif table == "user_tag_strengths":
            cur.execute(f"ALTER TABLE {staging} ADD PRIMARY KEY (handle, tag)")
        elif table == "user_profiles":
            cur.execute(f"ALTER TABLE {staging} ADD PRIMARY KEY (handle)")

        cur.execute(f"DROP TABLE IF EXISTS {table}_old")
        cur.execute(f"ALTER TABLE {table} RENAME TO {table}_old")
        # Free the canonical index name before the staging index claims it:
        # the old table still owns it until it is renamed or dropped.
        if table == "submissions":
            cur.execute(f"ALTER INDEX IF EXISTS {table}_handle_idx "
                        f"RENAME TO {table}_old_handle_idx")
        cur.execute(f"ALTER TABLE {staging} RENAME TO {table}")
        if table == "submissions":
            cur.execute(f"ALTER INDEX IF EXISTS {staging}_handle_idx "
                        f"RENAME TO {table}_handle_idx")
        log.info("%s: swapped in (previous kept as %s_old)", table, table)

    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--table", choices=sorted(TABLES), help="load just this table")
    ap.add_argument("--keep-old", action="store_true",
                    help="keep the *_old tables instead of dropping them")
    args = ap.parse_args()

    targets = {args.table: TABLES[args.table]} if args.table else TABLES

    conn = raw_connection()
    try:
        loaded = []
        for table, csv_name in targets.items():
            if load_table(conn, table, csv_name):
                loaded.append(table)
        # One transaction for every table: either the whole dataset flips or
        # none of it does, so the site never mixes old and new tables.
        conn.commit()
        log.info("Committed: %s", ", ".join(loaded) or "(nothing)")

        if not args.keep_old:
            with conn.cursor() as cur:
                for table in loaded:
                    cur.execute(f"DROP TABLE IF EXISTS {table}_old")
            conn.commit()
            log.info("Dropped previous *_old tables")

        with conn.cursor() as cur:
            cur.execute("ANALYZE")
        conn.commit()
        log.info("ANALYZE done")
    except Exception:
        conn.rollback()
        log.error("Load failed — rolled back, existing tables untouched")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
