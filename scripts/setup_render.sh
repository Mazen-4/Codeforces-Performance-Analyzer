#!/usr/bin/env bash
# Render build script — runs once at deploy time.
# 1. Install Python + ML dependencies
# 2. Build React frontend
# 3. Download latest dataset + models from GitHub Release

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
GH_REPO="${GH_REPO:-okhalifa-official/Codeforces-Performance-Analyzer}"

echo "=== CF Analyzer — Render build ==="
echo "Project root: $PROJECT_ROOT"

# ── 1. Python dependencies ────────────────────────────────────────────────────
echo ""
echo "--- Installing Python dependencies ---"
pip3 install --quiet --no-cache-dir --break-system-packages \
    "numpy~=2.1" "pandas~=2.3" "requests~=2.32" "psutil~=7.2" \
    "lightgbm~=4.6" "scikit-learn~=1.8" \
    "psycopg[binary]~=3.2" "SQLAlchemy~=2.0"

# ── 2. Node dependencies + React build ───────────────────────────────────────
echo ""
echo "--- Installing server Node dependencies ---"
cd "$PROJECT_ROOT/website/server"
npm install

echo "--- Installing frontend Node dependencies ---"
cd "$PROJECT_ROOT/website"
# --include=dev is required: vite lives in devDependencies, and hosts commonly set
# NODE_ENV=production, which makes npm skip devDependencies entirely — the build
# then dies with "vite: not found". The build tools are needed to *produce* dist/,
# even though they're not needed to serve it.
npm ci --include=dev

echo "--- Building React frontend ---"
npm run build
# Output lands in website/dist/ — server.js will serve it as static files

cd "$PROJECT_ROOT"

# ── 3. Download models (and the dataset only when not using Postgres) ────────
echo ""
if [ -n "${DATABASE_URL:-}" ] && [ "${USE_POSTGRES:-1}" != "0" ]; then
  # The submissions dataset is ~1.5 GB uncompressed and grows weekly. With
  # Postgres serving it, the web container only needs the ~6 MB models, so
  # skip the dataset download entirely.
  echo "--- DATABASE_URL set — fetching models only (dataset served from Postgres) ---"
  MODELS_ONLY=1 bash "$PROJECT_ROOT/scripts/fetch_latest_release.sh"
else
  echo "--- Fetching latest dataset and models from GitHub Release ---"
  bash "$PROJECT_ROOT/scripts/fetch_latest_release.sh"
fi

echo ""
echo "=== Build complete ==="
