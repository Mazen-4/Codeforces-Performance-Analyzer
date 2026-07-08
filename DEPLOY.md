# CF Analyzer — Deploy Guide

## GitHub Actions (Recommended — works while your PC is off)

### How it works

```
Every Sunday 02:00 UTC (GitHub's servers, always on)
  │
  ├─ 1. Download previous dataset from latest GitHub Release
  ├─ 2. Crawl Codeforces API (5,000 users, ~1.5 hrs)
  ├─ 3. Run preprocessing pipeline (rebuild CSVs)
  ├─ 4. Retrain all 3 LightGBM models
  └─ 5. Publish new GitHub Release with:
         dataset-YYYYMMDD.tar.gz  (all CSVs)
         models-YYYYMMDD.tar.gz   (all .pkl files)
```

No server required. GitHub provides free compute (~2,000 minutes/month on free tier; the weekly job takes ~2 hours = ~8 hrs/month).

### Step 1 — Seed the initial dataset (one-time, from your machine)

Install the GitHub CLI if you haven't:
```bash
brew install gh
gh auth login
```

Package your local dataset and models:
```bash
cd /path/to/cf-analyzer

tar -czf dataset-init.tar.gz -C ML/dataset .
tar -czf models-init.tar.gz  -C ML/models  .
```

Create the first release and upload:
```bash
gh release create data-init \
  --repo Mazen-4/Codeforces-Performance-Analyzer \
  --title "Initial dataset seed" \
  --notes "Manual seed from local machine" \
  --prerelease \
  dataset-init.tar.gz \
  models-init.tar.gz

rm dataset-init.tar.gz models-init.tar.gz
```

### Step 2 — Push the workflows to GitHub

```bash
git add .github/workflows/ scripts/
git commit -m "Add GitHub Actions weekly retrain workflow"
git push
```

### Step 3 — Verify the workflow runs

- Go to your repo → **Actions** tab → **Weekly Crawl & Retrain**
- Click **Run workflow** to trigger it manually for the first time
- Watch the logs — it should download your seeded data, crawl ~5,000 users, retrain, and publish a new release

After that, it runs automatically every Sunday at 02:00 UTC with no action needed from you.

### Manually trigger a run

```bash
gh workflow run weekly-retrain.yml \
  --repo Mazen-4/Codeforces-Performance-Analyzer \
  -f crawl_users=1000    # smaller crawl for testing
```

### Fetch the latest dataset onto a new machine

```bash
./scripts/fetch_latest_release.sh
```

This downloads and extracts the most recent release assets into `ML/dataset/` and `ML/models/`.

---

# Docker & Kubernetes Deploy Guide (local)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Kubernetes (Minikube / Docker Desktop)             │
│                                                     │
│  ┌───────────────────┐     ┌─────────────────────┐  │
│  │  cf-analyzer-web  │     │   cf-retrain CronJob │  │
│  │  (Node + Python)  │     │   (Every Sunday 2am) │  │
│  │  port 3000        │     │   Crawl → Preprocess │  │
│  └────────┬──────────┘     │   → Retrain models  │  │
│           │                └────────┬────────────┘  │
│           └────────────────────────┘                │
│                        │                            │
│              ┌──────────▼──────────┐                │
│              │   cf-data-pvc (2Gi) │                │
│              │   /data/dataset/    │                │
│              │   /data/models/     │                │
│              └─────────────────────┘                │
└─────────────────────────────────────────────────────┘
```

Two Docker images:
- **`cf-analyzer-web`** — Express server (port 3000) + React static files + Python venv for ML inference
- **`cf-analyzer-pipeline`** — Python-only image for the weekly crawl + retrain job

One PVC (`cf-data-pvc`) is shared by both: the web pod reads CSVs/models, the retrain job writes new ones.

---

## Prerequisites

```bash
# Install tools
brew install minikube kubectl docker

# Start Minikube with enough resources
minikube start --cpus=4 --memory=6g --disk-size=20g
```

---

## Quick Start (Docker Compose — local dev)

```bash
# 1. Set your Gemini API key
echo "GEMINI_API_KEY=your-key-here" > .env

# 2. Build images
docker compose build

# 3. Seed the volume with your existing local dataset + models
docker compose run --rm seed

# 4. Start the web server
docker compose up web

# App is live at http://localhost:3000
```

To manually trigger a retrain:
```bash
docker compose run --rm retrain
```

---

## Kubernetes Deploy (Minikube)

### 1. Build and load images into Minikube

```bash
# Build both images
docker build -f Dockerfile.web      -t cf-analyzer-web:latest      .
docker build -f Dockerfile.pipeline -t cf-analyzer-pipeline:latest  .

# Load into Minikube's local daemon (no registry needed)
minikube image load cf-analyzer-web:latest
minikube image load cf-analyzer-pipeline:latest
```

### 2. Apply manifests

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/secret.yaml        # edit GEMINI_API_KEY first (see below)
kubectl apply -f k8s/deployment-web.yaml
kubectl apply -f k8s/service-web.yaml
kubectl apply -f k8s/cronjob-retrain.yaml
```

### 3. Set the Gemini API key

```bash
# Option A — patch the secret directly (recommended, no file changes)
kubectl create secret generic cf-analyzer-secrets \
  --namespace cf-analyzer \
  --from-literal=GEMINI_API_KEY="your-key-here" \
  --dry-run=client -o yaml | kubectl apply -f -

# Option B — edit k8s/secret.yaml, fill in base64 value, then apply
echo -n "your-key-here" | base64
# paste result into k8s/secret.yaml under GEMINI_API_KEY
kubectl apply -f k8s/secret.yaml
```

### 4. Seed the PVC with your dataset and models

```bash
# Create the /data/dataset and /data/models directories on the PVC
kubectl apply -f k8s/job-seed.yaml
kubectl wait --for=condition=complete job/cf-data-seed -n cf-analyzer --timeout=60s

# Copy your local files into the PVC via a temporary pod
kubectl run seed-shell --rm -it \
  --image=busybox --restart=Never \
  --overrides='{"spec":{"volumes":[{"name":"d","persistentVolumeClaim":{"claimName":"cf-data-pvc"}}],"containers":[{"name":"seed-shell","image":"busybox","volumeMounts":[{"name":"d","mountPath":"/data"}],"command":["sh"]}]}}' \
  -n cf-analyzer

# In a separate terminal while seed-shell is running:
kubectl cp ML/dataset/ cf-analyzer/seed-shell:/data/dataset/
kubectl cp ML/models/  cf-analyzer/seed-shell:/data/models/
# Then exit the shell
```

### 5. Access the app

```bash
# Get the URL
minikube service cf-analyzer-web -n cf-analyzer --url

# Or use port-forward
kubectl port-forward svc/cf-analyzer-web 3000:3000 -n cf-analyzer
# App at http://localhost:3000
```

### 6. Verify the CronJob

```bash
# List the CronJob
kubectl get cronjob -n cf-analyzer

# Manually trigger a run to test
kubectl create job --from=cronjob/cf-retrain cf-retrain-test -n cf-analyzer

# Watch logs
kubectl logs -n cf-analyzer job/cf-retrain-test -f
```

---

## Useful Commands

```bash
# Check pod status
kubectl get pods -n cf-analyzer

# Web server logs
kubectl logs -n cf-analyzer -l app=cf-analyzer-web -f

# Retrain job history
kubectl get jobs -n cf-analyzer

# Describe a failing pod
kubectl describe pod -n cf-analyzer <pod-name>

# Shell into the web pod
kubectl exec -it -n cf-analyzer deployment/cf-analyzer-web -- bash

# Delete everything and start fresh
kubectl delete namespace cf-analyzer
```

---

## Environment Variables Reference

| Variable | Service | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | web | — | Required for AI Coach tab |
| `ML_DATA_PATH` | web | `/data` | Path to PVC mount inside container |
| `DATA_DIR` | retrain | `/data` | Path to PVC mount inside container |
| `CF_CRAWL_USERS` | retrain | `5000` | Max users to crawl |
| `CF_MIN_RATING` | retrain | `900` | Min Codeforces rating to include |
| `CF_MAX_RATING` | retrain | `3500` | Max Codeforces rating to include |

---

## CronJob Schedule

Default: `0 2 * * 0` — every Sunday at 02:00 UTC.

To change, edit `schedule` in [k8s/cronjob-retrain.yaml](k8s/cronjob-retrain.yaml):
```yaml
schedule: "0 2 * * 0"   # Sun 02:00 UTC
# schedule: "0 3 * * 1"   # Mon 03:00 UTC
```

The job has a 6-hour deadline (`activeDeadlineSeconds: 21600`). A full crawl of 5,000 users
at ~1 req/sec takes ~1.5 hours; preprocessing and retraining add ~30 minutes.
