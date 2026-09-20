-- Application schema: accounts, sessions, and search history.
--
-- Separate from the ML tables (scripts/db/schema.sql) but lives in the same
-- database. The weekly pipeline only ever touches submissions /
-- user_tag_strengths / user_profiles, so a retrain can never disturb accounts.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── accounts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL,
    -- Case-insensitive uniqueness without CITEXT: store the normalized form.
    email_lower     TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    cf_handle       TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user', 'admin')),
    plan            TEXT NOT NULL DEFAULT 'free'
                    CHECK (plan IN ('free', 'pro')),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended')),

    -- Optional profile, fillable later.
    full_name       TEXT,
    phone           TEXT,
    country         TEXT,
    institution     TEXT,
    bio             TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS accounts_cf_handle_idx ON accounts (lower(cf_handle));
CREATE INDEX IF NOT EXISTS accounts_created_idx   ON accounts (created_at DESC);

-- ── sessions ────────────────────────────────────────────────────────────────
-- Opaque server-side sessions rather than stateless JWTs: logging a user out
-- (or an admin suspending an account) must take effect immediately, which a
-- self-contained token cannot do before it expires.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash   TEXT PRIMARY KEY,          -- sha256 of the cookie value
    account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    user_agent   TEXT,
    ip           TEXT
);

CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions (account_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx  ON sessions (expires_at);

-- ── searches ────────────────────────────────────────────────────────────────
-- One row per analysis a user runs. Admins review these; users see their own
-- history. Kept deliberately small — the full result is recomputed on demand,
-- only the headline numbers are stored.
CREATE TABLE IF NOT EXISTS searches (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id    UUID REFERENCES accounts(id) ON DELETE CASCADE,
    cf_handle     TEXT NOT NULL,
    searched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    ok            BOOLEAN NOT NULL DEFAULT true,
    duration_ms   INTEGER,
    cf_rating     INTEGER,
    weakest_tag   TEXT,
    error         TEXT
);

CREATE INDEX IF NOT EXISTS searches_account_idx ON searches (account_id, searched_at DESC);
CREATE INDEX IF NOT EXISTS searches_time_idx    ON searches (searched_at DESC);

-- ── login throttling ────────────────────────────────────────────────────────
-- Credential stuffing protection: count recent failures per email and per IP.
CREATE TABLE IF NOT EXISTS login_attempts (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email_lower TEXT,
    ip          TEXT,
    ok          BOOLEAN NOT NULL,
    at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_email_idx ON login_attempts (email_lower, at DESC);
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx    ON login_attempts (ip, at DESC);
