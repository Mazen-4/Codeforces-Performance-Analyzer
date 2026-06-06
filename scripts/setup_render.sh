#!/usr/bin/env bash
# Render build script — runs once at deploy time.
# 1. Install Python + ML dependencies
# 2. Build React frontend
# 3. Download latest dataset + models from GitHub Release

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
GH_REPO="${GH_REPO:-Mazen-4/Codeforces-Performance-Analyzer}"

echo "=== CF Analyzer — Render build ==="
echo "Project root: $PROJECT_ROOT"

# ── 1. Python dependencies ────────────────────────────────────────────────────
echo ""
echo "--- Installing Python dependencies ---"
pip3 install --quiet --no-cache-dir --break-system-packages \
    numpy pandas requests psutil \
    lightgbm scikit-learn

# ── 2. Node dependencies + React build ───────────────────────────────────────
echo ""
echo "--- Installing Node dependencies ---"
cd "$PROJECT_ROOT/website"
npm ci

echo "--- Building React frontend ---"
npm run build
# Output lands in website/dist/ — server.js will serve it as static files

cd "$PROJECT_ROOT"

# ── 3. Download latest dataset + models from GitHub Release ──────────────────
echo ""
echo "--- Fetching latest dataset and models from GitHub Release ---"
bash "$PROJECT_ROOT/scripts/fetch_latest_release.sh"

echo ""
echo "=== Build complete ==="
