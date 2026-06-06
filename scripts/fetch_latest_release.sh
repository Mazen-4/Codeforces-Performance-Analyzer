#!/usr/bin/env bash
# Downloads the latest dataset + model release assets from GitHub Releases.
# Run this before starting the server when deploying on a new machine.
#
# Usage:
#   ./scripts/fetch_latest_release.sh
#
# Env vars:
#   GH_REPO     - GitHub repo (default: Mazen-4/Codeforces-Performance-Analyzer)
#   DATA_DIR    - where to extract files (default: current dir, so ML/dataset & ML/models)
#   GH_TOKEN    - optional, for private repos

set -euo pipefail

GH_REPO="${GH_REPO:-Mazen-4/Codeforces-Performance-Analyzer}"
DATA_DIR="${DATA_DIR:-$(pwd)}"
DATASET_DIR="$DATA_DIR/ML/dataset"
MODELS_DIR="$DATA_DIR/ML/models"
TMP_DIR=$(mktemp -d)

echo "=== CF Analyzer — fetching latest release assets ==="
echo "Repo:       $GH_REPO"
echo "Target dir: $DATA_DIR"

mkdir -p "$DATASET_DIR" "$MODELS_DIR"

# Find the latest release tag
API_URL="https://api.github.com/repos/$GH_REPO/releases"
AUTH_HEADER=""
if [ -n "${GH_TOKEN:-}" ]; then
  AUTH_HEADER="Authorization: Bearer $GH_TOKEN"
fi

LATEST_TAG=$(curl -sf \
  ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
  "$API_URL" | python3 -c "
import sys, json
releases = json.load(sys.stdin)
# Pick the most recent release that has dataset and model assets
for r in releases:
    assets = [a['name'] for a in r.get('assets', [])]
    has_dataset = any('dataset' in a for a in assets)
    has_models  = any('models'  in a for a in assets)
    if has_dataset and has_models:
        print(r['tag_name'])
        break
")

if [ -z "$LATEST_TAG" ]; then
  echo "ERROR: No release with dataset + model assets found in $GH_REPO"
  echo "Run the seed workflow first (see DEPLOY.md)."
  exit 1
fi

echo "Latest release with data: $LATEST_TAG"

# Get asset download URLs
ASSETS=$(curl -sf \
  ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
  "$API_URL/tags/$LATEST_TAG" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for a in data.get('assets', []):
    if 'dataset' in a['name'] or 'models' in a['name']:
        print(a['browser_download_url'], a['name'])
")

if [ -z "$ASSETS" ]; then
  echo "ERROR: No matching assets in release $LATEST_TAG"
  exit 1
fi

# Download and extract
while IFS=' ' read -r url name; do
  echo "Downloading $name …"
  curl -sfL ${AUTH_HEADER:+-H "$AUTH_HEADER"} -o "$TMP_DIR/$name" "$url"

  if [[ "$name" == dataset-* ]]; then
    echo "Extracting dataset → $DATASET_DIR"
    tar -xzf "$TMP_DIR/$name" -C "$DATASET_DIR"
  elif [[ "$name" == models-* ]]; then
    echo "Extracting models → $MODELS_DIR"
    tar -xzf "$TMP_DIR/$name" -C "$MODELS_DIR"
  fi
done <<< "$ASSETS"

rm -rf "$TMP_DIR"

echo ""
echo "Done! Files in place:"
echo "  Dataset: $(ls "$DATASET_DIR"/*.csv 2>/dev/null | wc -l | tr -d ' ') CSV files"
echo "  Models:  $(ls "$MODELS_DIR"/*.pkl  2>/dev/null | wc -l | tr -d ' ') .pkl files"
