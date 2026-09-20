# Postgres migration

The website used to read `04_filtered_submissions.csv` (~1.5 GB, growing ~2.3M
rows/week) on every request. It now reads Postgres instead, and the web
container no longer downloads the dataset at all.

| | Before | After |
|---|---|---|
| Deploy payload | 233 MB compressed → 1.5 GB on disk | ~6 MB models |
| Neighbour lookup | chunk-scan the whole CSV | indexed, ~1 ms |
| Container RAM | grows weekly | flat |

`07_enriched_user_profiles.csv` stays a file: it is training-only.

## Deploying on Railway

1. **Add Postgres.** In the Railway project: *New* → *Database* → *PostgreSQL*.
   Railway injects `DATABASE_URL` into services in the same project.

2. **Apply the schema.**
   ```bash
   psql "$DATABASE_URL" -f scripts/db/schema.sql
   ```

3. **Load the current data.** From a checkout with `ML/dataset/*.csv` present
   (run `scripts/fetch_latest_release.sh` first if needed):
   ```bash
   DATABASE_URL="..." python scripts/db/load.py
   ```

4. **Point the web service at it.** Railway sets `DATABASE_URL` automatically
   when the database is in the same project. Prefer the private URL
   (`DATABASE_URL_PRIVATE`) to avoid egress charges. Redeploy; the build now
   skips the dataset download and fetches models only.

5. **Let CI keep it fresh.** Add `DATABASE_URL` as a repository secret. The
   weekly workflow then loads Postgres after each retrain. Without the secret
   the load step is skipped and nothing changes.

## Rollback

Set `USE_POSTGRES=0` on the web service and redeploy. The code falls back to
the CSV path, and the GitHub Release still carries the full dataset. No data
is lost, because Postgres is a second destination, not a replacement.

## How loading works

`scripts/db/load.py` copies each CSV into a staging table, then swaps it in
inside one transaction:

```
COPY → staging → build index → rename live to _old → rename staging to live → COMMIT
```

A partially-loaded table is never visible, and a failed load rolls back with
the live tables untouched (verified: a malformed CSV left the table at its
previous row count). All three tables commit together, so the site never
serves a mix of old and new.

The loader also handles three quirks of the released CSVs:
- `strength.py` writes with `QUOTE_ALL`, so NaN arrives as `""`; the COPY
  declares that as NULL.
- `02_user_profiles.csv` has 51 columns but only 3 are needed, so rows are
  projected while streaming.
- Excel-corrupted `#NAME?` handles are dropped, matching what `strength.py`
  already does at read time.

## Local testing

```bash
brew install postgresql@16
initdb -D /tmp/pgdata -U cftest --auth=trust
pg_ctl -D /tmp/pgdata -o "-p 55432 -k /tmp/cfpg" start
createdb -h 127.0.0.1 -p 55432 -U cftest cfanalyzer
export DATABASE_URL="postgresql://cftest@127.0.0.1:55432/cfanalyzer"
psql "$DATABASE_URL" -f scripts/db/schema.sql
python scripts/db/load.py
```
