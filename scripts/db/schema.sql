-- CF Analyzer — Postgres schema.
--
-- Replaces the CSV files the website reads at request time. Only the tables the
-- web path actually needs live here; 07_enriched_user_profiles.csv stays a file
-- because it is training-only (ML/training/train_rating_progression_model.py).
--
-- Apply with:  psql "$DATABASE_URL" -f scripts/db/schema.sql

-- ── submissions ─────────────────────────────────────────────────────────────
-- One row per SUBMISSION attempt, not per problem. There is deliberately no
-- primary key on (handle, problem_id): repeat attempts carry the WA/TLE counts
-- that the attempts and strength models aggregate, so collapsing them would
-- zero out real signal.
CREATE TABLE IF NOT EXISTS submissions (
    handle          TEXT     NOT NULL,
    problem_id      TEXT     NOT NULL,
    problem_name    TEXT,
    problem_rating  REAL     NOT NULL,
    is_ac           SMALLINT NOT NULL DEFAULT 0,
    is_wa           SMALLINT NOT NULL DEFAULT 0,
    is_tle          SMALLINT NOT NULL DEFAULT 0,
    is_mle          SMALLINT NOT NULL DEFAULT 0,
    submitted_at    BIGINT,

    tag_dp               SMALLINT NOT NULL DEFAULT 0,
    tag_greedy           SMALLINT NOT NULL DEFAULT 0,
    tag_graphs           SMALLINT NOT NULL DEFAULT 0,
    tag_math             SMALLINT NOT NULL DEFAULT 0,
    tag_strings          SMALLINT NOT NULL DEFAULT 0,
    tag_impl             SMALLINT NOT NULL DEFAULT 0,
    tag_binary_search    SMALLINT NOT NULL DEFAULT 0,
    tag_data_structures  SMALLINT NOT NULL DEFAULT 0,
    tag_number_theory    SMALLINT NOT NULL DEFAULT 0,
    tag_combinatorics    SMALLINT NOT NULL DEFAULT 0,
    tag_geometry         SMALLINT NOT NULL DEFAULT 0,
    tag_trees            SMALLINT NOT NULL DEFAULT 0,
    tag_sortings         SMALLINT NOT NULL DEFAULT 0,
    tag_two_pointers     SMALLINT NOT NULL DEFAULT 0,
    tag_bitmasks         SMALLINT NOT NULL DEFAULT 0,
    tag_flows            SMALLINT NOT NULL DEFAULT 0,
    tag_fft              SMALLINT NOT NULL DEFAULT 0,
    tag_games            SMALLINT NOT NULL DEFAULT 0,
    tag_probabilities    SMALLINT NOT NULL DEFAULT 0,
    tag_constructive     SMALLINT NOT NULL DEFAULT 0
);

-- The only index that matters: every website read filters by handle.
CREATE INDEX IF NOT EXISTS submissions_handle_idx ON submissions (handle);

-- ── user_tag_strengths ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_tag_strengths (
    handle                TEXT NOT NULL,
    tag                   TEXT NOT NULL,
    total_attempts        INTEGER,
    ac_count              INTEGER,
    wa_count              INTEGER,
    avg_rating_attempted  REAL,
    max_rating_solved     REAL,
    avg_rating_solved     REAL,
    cf_rating             REAL,
    cf_max_rating         REAL,
    first_try_rate        REAL,
    avg_attempts_to_ac    REAL,
    tag_coverage_pct      REAL,
    acceptance_rate       REAL,
    difficulty_score      REAL,
    rating_boost          REAL,
    efficiency_score      REAL,
    volume_score          REAL,
    total_ac              REAL,
    specialization_score  REAL,
    tag_strength          REAL,
    PRIMARY KEY (handle, tag)
);

-- ── user_profiles ───────────────────────────────────────────────────────────
-- Narrow on purpose: the website only needs rating context by handle.
CREATE TABLE IF NOT EXISTS user_profiles (
    handle         TEXT PRIMARY KEY,
    cf_rating      REAL,
    cf_max_rating  REAL
);
