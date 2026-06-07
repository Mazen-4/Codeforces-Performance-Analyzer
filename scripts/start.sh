#!/usr/bin/env bash
# Runtime start command for Railway/Render.
#
# Fetches the latest dataset + models from the newest GitHub Release on EVERY
# deploy (not cached like the build step), then launches the web server. This
# guarantees the server always serves the most recently retrained models —
# the build-step download can be silently skipped by build-layer caching.
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"

echo "=== Refreshing latest models before start (dataset already in image) ==="
if MODELS_ONLY=1 bash "$PROJECT_ROOT/scripts/fetch_latest_release.sh"; then
  echo "Latest models in place."
else
  echo "WARNING: model fetch failed — starting with whatever models are present."
fi

echo "=== Starting web server ==="
exec node "$PROJECT_ROOT/website/server/server.js"
