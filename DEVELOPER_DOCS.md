# CF Analyzer — Developer Documentation

> **Complete technical reference for contributors and developers.**  
> Covers the entire system from raw data collection to the React UI — every formula, API, model, and file explained.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Structure](#2-repository-structure)
3. [System Architecture](#3-system-architecture)
4. [External APIs Used](#4-external-apis-used)
5. [Dataset Pipeline](#5-dataset-pipeline)
   - 5.1 [Raw Data Collection (Dataset)](#51-raw-data-collection-dataset)
   - 5.2 [Submission Cleaning](#52-submission-cleaning)
   - 5.3 [User Profiles](#53-user-profiles)
   - 5.4 [Tag Strength Formula](#54-tag-strength-formula)
   - 5.5 [Dataset Files Reference](#55-dataset-files-reference)
6. [Runtime Pipeline (Per-User Analysis)](#6-runtime-pipeline-per-user-analysis)
   - 6.1 [Stage 1 — Data Collection](#61-stage-1--data-collection)
   - 6.2 [Stage 2 — Feature Engineering (82-dim Vector)](#62-stage-2--feature-engineering-82-dim-vector)
   - 6.3 [Stage 3 — KNN Inference](#63-stage-3--knn-inference)
   - 6.4 [Stage 4 — Tag Analysis (Peer-Benchmarked)](#64-stage-4--tag-analysis-peer-benchmarked)
   - 6.5 [Stage 5 — Problem Pool Builder](#65-stage-5--problem-pool-builder)
   - 6.6 [Stage 6 — Problem Prioritization](#66-stage-6--problem-prioritization)
   - 6.7 [Counterfactual Tag Impact](#67-counterfactual-tag-impact)
   - 6.8 [Attempts Estimator](#68-attempts-estimator)
7. [ML Models](#7-ml-models)
   - 7.1 [Model 1 — Success Model (solve_score)](#71-model-1--success-model-solve_score)
   - 7.2 [Model 2 — Attempts Estimator](#72-model-2--attempts-estimator)
   - 7.3 [Shared Feature Vector (29 dims)](#73-shared-feature-vector-29-dims)
   - 7.4 [Model Hyperparameters](#74-model-hyperparameters)
8. [KNN Evaluation](#8-knn-evaluation)
9. [Model Comparisons](#9-model-comparisons)
10. [Web Application](#10-web-application)
    - 10.1 [Frontend (React + Vite)](#101-frontend-react--vite)
    - 10.2 [Backend (Express Server)](#102-backend-express-server)
    - 10.3 [API Endpoints](#103-api-endpoints)
11. [Tag Set Reference](#11-tag-set-reference)
12. [Configuration Reference](#12-configuration-reference)
13. [Performance Profiling](#13-performance-profiling)
14. [Installation & Running](#14-installation--running)
15. [Data Flow Diagram](#15-data-flow-diagram)

---

## 1. Project Overview

CF Analyzer is a machine-learning-powered competitive programming coach. It takes a Codeforces user handle, analyzes their submission history, finds the 50 most similar users in a dataset of 2,877 active competitors, and recommends unsolved problems that are most likely to improve their weakest skills.

**What it does, end-to-end:**

1. Fetches the target user's last 500 submissions from the Codeforces API
2. Builds an 82-dimensional feature vector describing their skill profile across 20 algorithmic topics
3. Runs KNN (K=50, Euclidean distance) against 2,877 pre-computed user vectors stored in a CSV
4. Benchmarks the user's tag strengths against their 50 nearest peers
5. Finds problems solved by neighbors but not by the target user
6. Ranks those problems using a LightGBM model that predicts how well-suited each problem is for the user
7. Estimates how many attempts each problem will require
8. Simulates boosting each tag by +20% and counts how many more problems become solvable (counterfactual impact)
9. Returns everything to a React frontend that renders radar charts, progress bars, and problem cards

---

## 2. Repository Structure

```
cf-analyzer/
│
├── main.py                          # Entry point — full pipeline orchestration
│
├── src/
│   ├── pipeline/
│   │   ├── config.py                # All constants, paths, API settings
│   │   ├── data_collection.py       # Codeforces API fetcher (target user only)
│   │   ├── feature_engineering.py   # 82-dim KNN feature vector builder
│   │   ├── model_inference.py       # KNN distance calculation & neighbor ranking
│   │   ├── preprocessing.py         # (stub)
│   │   └── recommendation.py        # JSON output writer
│   └── profiling/
│       ├── profiler.py              # Stage timing & memory profiler
│       └── logger.py                # JSON performance log writer
│
├── ML/
│   ├── dataset/                     # Pre-built CSV files (not in git if large)
│   │   ├── 01_submissions.csv       # Raw submissions from all 2,877 users
│   │   ├── 02_user_profiles.csv     # User-level statistics
│   │   ├── 04_filtered_submissions.csv  # Cleaned, filtered submissions
│   │   ├── 06_user_tag_strengths.csv    # Per-(user, tag) strength scores
│   │   └── 07_enriched_user_profiles.csv
│   │
│   ├── models/                      # Trained model pickle files
│   │   ├── success_model.pkl        # LightGBM solve_score regressor
│   │   └── attempts_model.pkl       # LightGBM attempts regressor
│   │
│   ├── preprocessing/               # Offline dataset preprocessing scripts
│   │   ├── strength.py              # Computes tag_strength for every (user, tag)
│   │   ├── submissionsCleaning.py   # Cleans raw submissions CSV
│   │   ├── userProfiles.py          # (stub — profile aggregation)
│   │   └── userTagStrengths.py      # (stub — strength cleaning)
│   │
│   ├── training/                    # Model training scripts
│   │   ├── train_success_model.py   # Trains LightGBM on solve_score
│   │   └── train_attempts_model.py  # Trains LightGBM on attempts
│   │
│   ├── inference/                   # Runtime inference modules
│   │   ├── TagAnalyzer.py           # Peer-benchmarked tag strength scorer
│   │   ├── find_unsolved_problems.py # Problem pool builder
│   │   ├── prioritize_problems.py   # Problem ranker using success model
│   │   ├── predict_attempts.py      # Attempts estimator inference
│   │   └── counterfactual_tag_impact.py  # Per-tag rating gain simulation
│   │
│   └── evaluation/
│       ├── evaluate_knn.py          # Leave-one-out KNN quality metrics
│       ├── compare_attempts_models.py    # LightGBM vs LR vs LogReg (attempts)
│       └── compare_rating_progression_models.py  # Same comparison for progression
│
├── visualization/
│   ├── visualize_knn.py
│   ├── visualize_ml_results.py
│   └── export_report.py
│
└── website/
    ├── src/
    │   ├── App.jsx                  # Entire React application (single component)
    │   └── main.jsx                 # React entry point
    ├── server/
    │   └── server.js                # Express backend (3 API endpoints)
    ├── package.json                 # React + Vite + Recharts
    └── vite.config.js
```

---

## 3. System Architecture

The system has two separate layers that run in parallel when a user is analyzed:

```
Browser
  │
  ├──► GET /api/cf/:handle          (Node.js server)
  │         │
  │         └──► Codeforces API (user.status + problemset.problems)
  │
  └──► GET /api/ml/analyze/:handle  (Node.js server)
            │
            └──► spawns Python subprocess
                      │
                      └──► main.py
                                │
                    ┌───────────┴────────────┐
                    │                        │
              Codeforces API          ML/dataset/*.csv
              (target user only)      (2,877 users, prebuilt)
                    │                        │
                    └───────────┬────────────┘
                                │
                    ┌───────────▼────────────┐
                    │   KNN (K=50, 82-dim)   │
                    └───────────┬────────────┘
                                │
                    ┌───────────▼────────────┐
                    │   Tag Analysis         │ ← peer-benchmarked (TagAnalyzer)
                    └───────────┬────────────┘
                                │
                    ┌───────────▼────────────┐
                    │   Problem Pool         │ ← neighbor-solved, target-unsolved
                    └───────────┬────────────┘
                                │
                    ┌───────────▼────────────┐
                    │   LightGBM Models      │
                    │   · success model      │ ← prioritize_problems.py
                    │   · attempts model     │ ← predict_attempts.py
                    │   · counterfactual     │ ← counterfactual_tag_impact.py
                    └───────────┬────────────┘
                                │
                           JSON response
```

---

## 4. External APIs Used

### 4.1 Codeforces API

**Base URL:** `https://codeforces.com/api`  
**Auth:** None required for public endpoints  
**Rate limit:** ~5 requests/second (unofficial; no documented limit for read-only)  
**Timeout configured:** 30 seconds (`CODEFORCES_API_TIMEOUT` in `config.py`)

#### Endpoints Used

---

**`GET /user.info`**

Returns profile information for one or more users.

```
https://codeforces.com/api/user.info?handles={handle}
```

| Parameter | Type   | Description                       |
|-----------|--------|-----------------------------------|
| `handles` | string | Semicolon-separated user handles  |

Response fields used by the system:

| Field        | Type | Description                                  |
|--------------|------|----------------------------------------------|
| `handle`     | str  | User's Codeforces handle                     |
| `rating`     | int  | Current rating (can be missing if unrated)   |
| `maxRating`  | int  | All-time maximum rating                      |

Example response (truncated):
```json
{
  "status": "OK",
  "result": [
    {
      "handle": "tourist",
      "rating": 3979,
      "maxRating": 3979,
      "rank": "legendary grandmaster"
    }
  ]
}
```

Used in: `DataCollector.fetch_user_info()` → `src/pipeline/data_collection.py`

---

**`GET /user.status`**

Returns the last N submissions for a user.

```
https://codeforces.com/api/user.status?handle={handle}&count={count}
```

| Parameter | Type   | Default | Description                        |
|-----------|--------|---------|------------------------------------|
| `handle`  | string | —       | The user's Codeforces handle       |
| `count`   | int    | 10      | Number of submissions to return    |

The system fetches `count=500` (`MAX_SUBMISSIONS_PER_USER` in `config.py`).

Each submission object contains:

| Field              | Type   | Description                              |
|--------------------|--------|------------------------------------------|
| `verdict`          | string | `"OK"` = accepted, else wrong/TLE/etc.   |
| `problem.contestId`| int    | Contest ID (used to build problem ID)    |
| `problem.index`    | string | Problem letter (`"A"`, `"B"`, `"C"` …)  |
| `problem.name`     | string | Problem display name                     |
| `problem.rating`   | int    | Problem difficulty rating                |
| `problem.tags`     | list   | List of tag strings (e.g. `"dp"`, `"graphs"`) |

The system converts `(contestId, index)` into a flat `problem_id` string: `"1234_A"`.

Each submission is converted into a flat row by `_submission_to_row()` in `data_collection.py`:

```python
{
    "handle":         "tourist",
    "problem_id":     "1234_A",
    "problem_name":   "Beautiful Matrix",
    "problem_rating": 2100,
    "is_ac":          1,          # 1 if verdict == "OK", else 0
    "tag_dp":         0,
    "tag_greedy":     1,
    "tag_graphs":     0,
    # ... 17 more binary tag columns
}
```

Tag mapping from Codeforces raw strings to internal column names:

| Codeforces tag               | Internal column          |
|------------------------------|--------------------------|
| `dp`                         | `tag_dp`                 |
| `greedy`                     | `tag_greedy`             |
| `graphs`                     | `tag_graphs`             |
| `graph matchings`            | `tag_graphs`             |
| `math`                       | `tag_math`               |
| `strings`                    | `tag_strings`            |
| `implementation`             | `tag_impl`               |
| `binary search`              | `tag_binary_search`      |
| `data structures`            | `tag_data_structures`    |
| `number theory`              | `tag_number_theory`      |
| `combinatorics`              | `tag_combinatorics`      |
| `geometry`                   | `tag_geometry`           |
| `trees`                      | `tag_trees`              |
| `sortings`                   | `tag_sortings`           |
| `two pointers`               | `tag_two_pointers`       |
| `bitmasks`                   | `tag_bitmasks`           |
| `flows`                      | `tag_flows`              |
| `fft`                        | `tag_fft`                |
| `games`                      | `tag_games`              |
| `probabilities`              | `tag_probabilities`      |
| `constructive algorithms`    | `tag_constructive`       |

Used in: `DataCollector.fetch_user_submissions()` → `src/pipeline/data_collection.py`

---

**`GET /problemset.problems`**

Returns all problems in the Codeforces problemset. Used by the **Node.js server** (not the Python pipeline) to provide the frontend with problem metadata for display.

```
https://codeforces.com/api/problemset.problems
```

No parameters required.

Used in: `website/server/server.js` — `/api/cf/:handle` endpoint

---

### 4.2 Google Gemini API

Used by the AI Coach feature to generate a personalized 7-day training plan.

**Library:** `@google/generative-ai` (Node.js)  
**Model:** `gemini-2.5-flash`  
**Auth:** API key from environment variable `GEMINI_API_KEY` (`.env` file)

The server sends a structured prompt containing:
- User handle, estimated rating, total problems solved
- Weak tags with strength scores and solve counts
- Strong tags (to skip)
- Recommended problems from the ML pipeline

The model returns an HTML string with one `<div class="day">` block per day. The frontend renders it via `dangerouslySetInnerHTML`.

Used in: `website/server/server.js` — `/api/coach` endpoint

---

## 5. Dataset Pipeline

The dataset is **built once offline** and stored as CSV files. It covers 2,877 Codeforces users who each have at least 30 accepted submissions.

### 5.1 Raw Data Collection (Dataset)

The initial dataset was collected by fetching submissions for thousands of users via the Codeforces API. The raw data is stored in:

- `ML/dataset/01_submissions.csv` — one row per submission
- `ML/dataset/02_user_profiles.csv` — one row per user, with aggregate statistics

Each row in `01_submissions.csv` contains:

| Column           | Type    | Description                                    |
|------------------|---------|------------------------------------------------|
| `handle`         | string  | Codeforces handle                              |
| `problem_id`     | string  | `"{contestId}_{index}"` e.g. `"1234_A"`       |
| `problem_name`   | string  | Problem title                                  |
| `problem_rating` | int     | Difficulty (0 if unrated)                      |
| `is_ac`          | 0 or 1  | 1 = Accepted                                   |
| `is_wa`          | 0 or 1  | 1 = Wrong Answer (includes TLE, MLE)           |
| `is_tle`         | 0 or 1  | 1 = Time Limit Exceeded                        |
| `is_mle`         | 0 or 1  | 1 = Memory Limit Exceeded                      |
| `tag_dp`         | 0 or 1  | Binary flag — problem has this tag             |
| …                | …       | 19 more tag columns                            |

Each row in `02_user_profiles.csv` contains aggregate user-level statistics:

| Column                    | Description                                         |
|---------------------------|-----------------------------------------------------|
| `handle`                  | Codeforces handle                                   |
| `cf_rating`               | Current rating                                      |
| `cf_max_rating`           | All-time highest rating                             |
| `total_ac`                | Total distinct problems accepted                    |
| `first_try_rate`          | Fraction of problems solved on the first submission |
| `avg_attempts_to_ac`      | Average submissions before AC                       |
| `tag_coverage_pct`        | Fraction of the 20 tags attempted                   |
| `total_contests`          | Number of rounds participated in                    |
| `unique_problems_solved`  | Distinct problems with AC                           |
| `unique_problems_tried`   | Distinct problems attempted                         |
| `solved_lte_1000`         | Problems solved rated ≤ 1000                        |
| `solved_1001_1500`        | Problems solved rated 1001–1500                     |
| `solved_1501_2000`        | … and so on for each rating band                    |

### 5.2 Submission Cleaning

**Script:** `ML/preprocessing/submissionsCleaning.py`

Applied to `04_filtered_submissions.csv` before training. Steps:

1. Merge `is_tle` and `is_mle` into `is_wa` — both are treated as wrong answers:
   ```python
   df['is_wa'] = (df['is_wa'] | df['is_tle'] | df['is_mle']).astype(int)
   ```

2. Drop rows with no verdict (`is_ac=0` AND `is_wa=0`) — these are pending or incomplete submissions.

3. Drop rows with null `problem_name`.

4. Drop users with fewer than 30 accepted submissions — too sparse to be useful for KNN.

5. Drop problems with no rating AND no tags — these cannot contribute signal to the model.

6. Keep only columns: `handle`, `problem_id`, `problem_name`, `problem_rating`, `is_ac`, `is_wa`, and all `tag_*` columns.

### 5.3 User Profiles

**File:** `ML/dataset/02_user_profiles.csv`

Profiles are pre-built (exact script not committed) and contain the aggregate statistics listed in section 5.1. They are used in two places:
- As training data for the attempts model (to provide `cf_rating` lookups)
- Merged into `06_user_tag_strengths.csv` for the KNN feature matrix

### 5.4 Tag Strength Formula

**Script:** `ML/preprocessing/strength.py`  
**Output:** `ML/dataset/06_user_tag_strengths.csv`

This is the most important preprocessing step. For every `(user, tag)` pair, it computes a scalar `tag_strength ∈ [0, 1]` by combining six component scores with fixed weights.

#### Component Scores

**1. Acceptance Rate** — How reliably the user solves this tag

```
acceptance_rate = (ac_count + 1) / (total_attempts + 2)
```

The `+1` in the numerator and `+2` in the denominator is Laplace smoothing (`SMOOTHING = 2`). This prevents division by zero and avoids extreme values for users who have only tried a tag once.

- `ac_count` = number of distinct problems with this tag that the user accepted
- `total_attempts` = number of distinct problems with this tag that the user attempted

**2. Difficulty Score** — How hard the problems solved in this tag were

```
difficulty_score = avg_rating_solved / MAX_RATING
```

- `avg_rating_solved` = mean rating of accepted problems in this tag (0 if none)
- `MAX_RATING = 3500` (Codeforces maximum)
- Clipped to `[0, 1]`

**3. Rating Boost** — The user's overall competitive standing

```
rating_boost = (cf_rating + cf_max_rating) / (2 × MAX_RATING)
```

- `cf_rating` = current Codeforces rating
- `cf_max_rating` = all-time peak rating
- Uses the average of current and max to balance current performance with historical best
- Clipped to `[0, 1]`
- This is a **user-level constant** — it is the same for all tags of a given user

**4. Specialization Score** — How focused the user is on this tag

```
specialization_score = ac_count / total_ac
```

- `total_ac` = total number of distinct problems the user has accepted across all tags
- Measures the fraction of all solved problems that belong to this tag
- Rewards users who have practiced a topic deeply rather than spread thin

**5. Efficiency Score** — How often the user solves on the first try

```
efficiency_score = first_try_rate
```

- `first_try_rate` = fraction of distinct problems where the user's first submission was AC
- User-level constant (same for all tags)
- Clipped to `[0, 1]`

**6. Volume Score** — How many problems the user has solved in this tag (with diminishing returns)

```
volume_score = log(1 + ac_count) / log(1 + 50)
```

- Uses natural log to apply diminishing returns: solving 5 problems is very different from 0, but solving 100 vs 110 is marginal
- Normalised to `[0, 1]` where 50 accepted problems = 1.0

#### Final Weighted Combination

```
tag_strength = 0.30 × acceptance_rate
             + 0.30 × difficulty_score
             + 0.20 × rating_boost
             + 0.10 × specialization_score
             + 0.075 × efficiency_score
             + 0.075 × volume_score
```

Weights sum to exactly 1.0. The result is clipped to `[0, 1]`.

#### Why These Weights?

| Component            | Weight | Rationale                                                        |
|----------------------|--------|------------------------------------------------------------------|
| `acceptance_rate`    | 0.30   | Primary signal — can you actually solve problems in this tag?    |
| `difficulty_score`   | 0.30   | Distinguishes someone who solves 1000-rated dp from 2500-rated  |
| `rating_boost`       | 0.20   | Users with higher ratings are generally stronger everywhere      |
| `specialization`     | 0.10   | Depth signal — is this a focus area or just dabbled?             |
| `efficiency_score`   | 0.075  | Clean solves indicate genuine mastery                            |
| `volume_score`       | 0.075  | Breadth of practice matters but has diminishing returns          |

### 5.5 Dataset Files Reference

| File                              | Rows        | Columns | Description                               |
|-----------------------------------|-------------|---------|-------------------------------------------|
| `01_submissions.csv`              | ~2M         | 27      | All raw submissions for 2,877 users       |
| `02_user_profiles.csv`            | 2,877       | ~25     | User-level aggregate statistics           |
| `04_filtered_submissions.csv`     | ~900K       | 26      | Cleaned submissions (30+ AC filter)       |
| `06_user_tag_strengths.csv`       | ~57,540     | 15      | Per-(user,tag) strength + component scores|
| `07_enriched_user_profiles.csv`   | 2,877       | ~45     | Profiles + strongest/weakest tag columns  |

`06_user_tag_strengths.csv` has one row per `(handle, tag)` pair. Columns:

| Column                 | Description                                       |
|------------------------|---------------------------------------------------|
| `handle`               | User handle                                       |
| `tag`                  | Tag name (e.g. `tag_dp`)                         |
| `total_attempts`       | Problems with this tag attempted                  |
| `ac_count`             | Problems with this tag accepted                   |
| `wa_count`             | WA submissions for this tag                       |
| `avg_rating_solved`    | Mean rating of accepted problems in this tag      |
| `acceptance_rate`      | Component score                                   |
| `difficulty_score`     | Component score                                   |
| `rating_boost`         | Component score (user-level)                      |
| `efficiency_score`     | Component score (user-level)                      |
| `volume_score`         | Component score                                   |
| `specialization_score` | Component score                                   |
| `tag_strength`         | Final weighted score ∈ [0, 1]                    |
| `cf_rating`            | User's current rating (from profiles)             |
| `cf_max_rating`        | User's max rating (from profiles)                 |

---

## 6. Runtime Pipeline (Per-User Analysis)

When `main(handle)` is called, it runs 6 sequential stages plus 2 ML model calls.

### 6.1 Stage 1 — Data Collection

**File:** `src/pipeline/data_collection.py`  
**Class:** `DataCollector`

Calls two Codeforces API endpoints:
1. `user.info` → gets `cf_rating` and `cf_max_rating`
2. `user.status?count=500` → gets last 500 submissions, converts each to a flat row

The dataset users are **not fetched from the API** — they are already in the CSV files. Only the target user is fetched live.

Each submission is turned into a flat dict with one `is_ac` column and 20 binary `tag_*` columns (using the mapping table in section 4.1).

**Returns:**
```python
{
    "target_user": "handle",
    "target_user_info": {"rating": 1500, "maxRating": 1700, ...},
    "target_user_submissions": [{"handle": ..., "problem_id": ..., "is_ac": ..., "tag_dp": ..., ...}, ...]
}
```

---

### 6.2 Stage 2 — Feature Engineering (82-dim Vector)

**File:** `src/pipeline/feature_engineering.py`  
**Functions:** `compute_target_features()`, `FeatureEngineer.engineer_features()`

The KNN operates in an 82-dimensional space. The feature vector is structured as:

```
[acceptance_rate__tag_dp, acceptance_rate__tag_greedy, ..., acceptance_rate__tag_constructive,   ← 20 dims
 difficulty_score__tag_dp, ..., difficulty_score__tag_constructive,                               ← 20 dims
 specialization_score__tag_dp, ..., specialization_score__tag_constructive,                       ← 20 dims
 volume_score__tag_dp, ..., volume_score__tag_constructive,                                        ← 20 dims
 rating_boost,                                                                                     ← 1 dim
 efficiency_score]                                                                                 ← 1 dim
```

**Total: 4 × 20 + 2 = 82 dimensions**

Note: `tag_strength` itself is **not** used in the KNN vector. The 4 component scores are used directly so that the distance metric can respond to specific weaknesses (e.g. low `acceptance_rate` on `tag_dp` but high `difficulty_score`).

`rating_boost` and `efficiency_score` are user-level constants. Repeating them 20 times per tag would inflate their contribution to distances by 20×, so they appear once at the end.

For **dataset users**, the feature vectors are read directly from `06_user_tag_strengths.csv` using a pivot. For the **target user**, the vector is computed live from their API submissions using the same formula as `strength.py`.

---

### 6.3 Stage 3 — KNN Inference

**File:** `src/pipeline/model_inference.py`  
**Classes:** `KNNModel`, `ModelInference`

#### Distance Metric

Euclidean distance (`KNN_METRIC = "euclidean"` in `config.py`):

```
distance(target, user_i) = √Σ(target_j - user_i_j)²
```

where the sum runs over all 82 feature dimensions.

Other metrics are supported (`manhattan`, `cosine`) but Euclidean is used in production.

#### Finding Neighbors

1. Compute distance from target to every dataset user (numpy vectorized)
2. Sort ascending by distance
3. Take top K=50

#### Similarity Score Calculation

Two similarity scores are computed for each neighbor:

**Internal similarity** (used for weighted tag analysis):
```
similarity = (1 - (distance - d_nearest) / (d_furthest - d_nearest)) × 100
```
This maps the K neighbors' distances to [0%, 100%] relative to each other.

**Display similarity** (shown in the UI):
```
display_similarity = max(0, (1 - distance / d_global_max)) × 100
```
This maps against the furthest user in the entire dataset, so 100% means identical profile.

**Returns:**
```python
{
    "neighbors": [
        {"rank": 1, "user_handle": "abc", "distance": 0.123,
         "similarity": 100.0, "display_similarity": 94.2},
        ...
    ],
    "num_neighbors_found": 50
}
```

---

### 6.4 Stage 4 — Tag Analysis (Peer-Benchmarked)

**File:** `ML/inference/TagAnalyzer.py`  
**Function:** `analyze(target_handle, all_submissions, neighbor_handles)`

This produces a **different** tag strength score than `strength.py`. The difference is that these scores are **benchmarked against the 50 actual neighbors**, making them more meaningful for display:

- A user who is weak in DP relative to their peer group scores low in DP
- A user who is strong in DP relative to their peers scores high, even if their absolute level is low

#### Four Sub-Scores (TagAnalyzer)

**1. Acceptance Rate Score** (weight 0.35)
```
acc_score = min(user_acceptance_rate / peer_median_acceptance_rate, 1.0)
```

**2. Difficulty Score** (weight 0.35)
```
diff_score = min(user_avg_difficulty / peer_median_avg_difficulty, 1.0)
```

**3. Specialization Score** (weight 0.10)
```
spec_score = min((solved_in_tag / total_solved) / peer_median_specialization, 1.0)
```

**4. Volume Score** (weight 0.20)
```
vol_score = 1 - exp(-solved_in_tag / peer_median_solved)
```

The exponential ensures diminishing returns: doubling from 5 to 10 matters more than 50 to 100.

**Final strength (0–100):**
```
strength = (0.35 × acc_score + 0.35 × diff_score + 0.10 × spec_score + 0.20 × vol_score) × 100
```

This is shown in the UI (Radar chart, Tag Analysis table, Weakness Snapshot).

---

### 6.5 Stage 5 — Problem Pool Builder

**File:** `ML/inference/find_unsolved_problems.py`  
**Function:** `find_unsolved_problems(target_solved, neighbors, problem_metadata, limit=200)`

Builds a ranked list of problems to consider recommending.

**Algorithm:**
1. For each neighbor (50 total), iterate over their solved problems
2. Skip any problem already solved by the target user
3. For each unsolved problem, add the neighbor's similarity weight to a running score:
   ```
   problem_scores[problem_id] += neighbor_similarity_weight
   ```
4. A problem solved by many similar neighbors gets a high score
5. Sort by score descending, keep top 200

The neighbor weight is `display_similarity / 100` (0–1 range). This means a problem solved by 3 highly similar neighbors scores higher than one solved by 10 distant neighbors.

---

### 6.6 Stage 6 — Problem Prioritization

**File:** `ML/inference/prioritize_problems.py`  
**Function:** `prioritize_problems(problems, cf_rating, user_tag_strength, neighbor_tag_strength, num_solved, alpha=0.6, beta=0.4)`

This is where the LightGBM success model is applied. Each problem gets a `final_score` combining difficulty fit and weakness relevance.

#### Step 1 — Predict solve_score

For each problem, run the success model (see section 7.1) to get `solve_score ∈ [-1, 1]`.

#### Step 2 — Sweet-Spot Filter

Only keep problems where:
```
-0.2 ≤ solve_score ≤ 0.8
```

- `solve_score < -0.2`: the user is unlikely to solve this (too hard, skip it)
- `solve_score > 0.8`: the user will breeze through this (too easy, no growth)
- The sweet spot maps to `difficulty_match ∈ [40%, 90%]` — challenging enough to grow, reachable enough to not frustrate

#### Step 3 — Difficulty Match

```
difficulty_match = (solve_score + 1) / 2
```

Normalizes `solve_score` from `[-1, 1]` to `[0, 1]`.

#### Step 4 — Weakness Boost

```
weakness_boost = mean((1 - user_strength[tag]) × neighbor_strength[tag])
                 for each tag in problem.tags
```

- `user_strength[tag]` = user's `tag_strength` from `strength.py` formula (0–1 scale)
- `neighbor_strength[tag]` = similarity-weighted average of neighbor `tag_strength` values
- `(1 - user_strength)` = how weak the user is in this tag
- `× neighbor_strength` = how strong the neighbors are in this tag

High `weakness_boost` means: the user is weak in this tag AND their successful peers are strong in it. These are the highest-value learning opportunities.

#### Step 5 — Final Score

```
final_score = 0.6 × difficulty_match + 0.4 × weakness_boost
```

Results are sorted by `weakness_boost` first, then `final_score` as a tiebreaker. This prioritizes skill-gap problems over just "easy wins."

---

### 6.7 Counterfactual Tag Impact

**File:** `ML/inference/counterfactual_tag_impact.py`  
**Function:** `compute_tag_impact(problems, cf_rating, user_tag_strength, num_solved)`

Answers: *"If I improve my skill in tag X by 20%, how many more problems become solvable?"*

**Algorithm:**
1. Compute baseline: run the success model on all 200 candidate problems, count how many fall in the sweet spot `[-0.2, 0.8]` → `baseline_count`
2. For each of the 20 tags:
   a. Create a copy of `user_tag_strength` with that tag boosted by `+0.2` (capped at 1.0)
   b. Re-run the success model on all 200 problems with the boosted strength
   c. Count sweet-spot problems → `boosted_count`
   d. `delta_problems = max(0, boosted_count - baseline_count)`
3. Estimate rating gain from delta:
   ```
   estimated_rating_gain = (delta_problems / 10) × 50
   ```
   This is an empirical constant: approximately 10 extra solvable problems ≈ +50 rating points.
4. Sort by `delta_problems` descending

The constant `BOOST = 0.2` represents a realistic improvement from focused practice over a few weeks.

**Returns (per tag):**
```python
{
    "tag":                   "tag_dp",
    "label":                 "dp",
    "strength":              0.34,
    "delta_problems":        7,
    "estimated_rating_gain": 35
}
```

This requires 20 × (model.predict on 200 problems) = 4000 total predictions. Each prediction is extremely fast (LightGBM vectorized), so this adds negligible latency.

---

### 6.8 Attempts Estimator

**File:** `ML/inference/predict_attempts.py`  
**Function:** `estimate_attempts(problems, cf_rating, user_tag_strength, num_solved)`

Predicts how many submissions the user will need before getting AC.

Runs the attempts model on each recommended problem and returns a label:

| `estimated_attempts` | `difficulty_label` |
|----------------------|--------------------|
| < 1.5                | `"easy"`           |
| 1.5 – 2.5            | `"moderate"`       |
| > 2.5                | `"hard"`           |

The prediction is clipped to `[1, max_attempts_clip]` where `max_attempts_clip = 10`.

---

## 7. ML Models

### 7.1 Model 1 — Success Model (solve_score)

**Training script:** `ML/training/train_success_model.py`  
**Model file:** `ML/models/success_model.pkl`  
**Algorithm:** LightGBM Regressor  

#### Target Variable

`solve_score` is a continuous score in `[-1, 1]` computed from submission history:

```
solve_score = ever_ac - wa_count × WA_PENALTY
```
clipped to `[-1, 1]`, where `WA_PENALTY = 0.2`.

| Scenario                     | ever_ac | wa_count | solve_score |
|------------------------------|---------|----------|-------------|
| Solved on first try          | 1       | 0        | **1.0**     |
| Solved after 2 WAs           | 1       | 2        | **0.6**     |
| Solved after 5 WAs           | 1       | 5        | **0.0**     |
| Solved after 7 WAs           | 1       | 7        | **-0.4**    |
| Not solved, 3 WAs            | 0       | 3        | **-0.6**    |
| Not solved, 0 submissions    | 0       | 0        | **0.0**     |

This design means:
- The model predicts not just "will they solve it" but "how cleanly"
- Many wrong answers before solving is treated similarly to not solving at all

Training data: all `(handle, problem_id)` pairs from `04_filtered_submissions.csv` with `problem_rating > 0`, across all 2,877 users. Approximately 500,000 total training rows.

#### Evaluation Metrics

| Metric                    | Value  | Interpretation                      |
|---------------------------|--------|-------------------------------------|
| MAE                       | ~0.23  | Average prediction error ±0.23      |
| R²                        | ~0.35  | 35% variance explained              |
| AUC-ROC (threshold = 0.5) | ~0.78  | 78% — good separation of clean vs. messy solves |
| F1 Score (threshold = 0.5)| ~0.72  |                                     |

---

### 7.2 Model 2 — Attempts Estimator

**Training script:** `ML/training/train_attempts_model.py`  
**Model file:** `ML/models/attempts_model.pkl`  
**Algorithm:** LightGBM Regressor

#### Target Variable

```
attempts = wa_count + 1    (clipped to [1, 10])
```

- `attempts = 1`: solved on first submission (clean solve)
- `attempts = 3`: submitted twice before AC
- Clipped at 10 to reduce noise from extreme outliers (maximum in data was 108)

Training data: **solved problems only** (`ever_ac == 1`). Unsolved problems have undefined attempts-to-solve. Approximately 384,000 training rows.

#### Evaluation Metrics

| Metric | Value  | Interpretation                                    |
|--------|--------|---------------------------------------------------|
| MAE    | ~0.88  | On average, off by ±0.88 attempts                 |
| RMSE   | ~1.12  |                                                   |
| R²     | ~0.18  | 18% variance explained (attempts are noisy)       |

The low R² is expected — the number of attempts a person takes has high variance even for the same user-problem combination due to factors not in the training data (time of day, mood, looking at hints, etc.).

---

### 7.3 Shared Feature Vector (29 dims)

Both models use the **identical** 29-dimensional feature vector:

| # | Feature              | Description                                                          |
|---|----------------------|----------------------------------------------------------------------|
| 1 | `rating_diff`        | `problem_rating - cf_rating` (negative = easier than user's rating) |
| 2 | `rating_diff_sq`     | `rating_diff²` (captures nonlinear difficulty scaling)              |
| 3 | `cf_rating`          | User's current Codeforces rating                                     |
| 4 | `mean_tag_strength`  | Mean `tag_strength` across all tags present in the problem          |
| 5 | `tag_strength_min`   | Minimum `tag_strength` across problem tags (weakest required skill) |
| 6 | `tag_strength_max`   | Maximum `tag_strength` across problem tags (strongest required skill)|
| 7 | `tag_coverage`       | `num_problem_tags / 20` — fraction of tag space covered             |
| 8 | `num_solved`         | Total distinct problems the user has solved (experience proxy)       |
| 9 | `problem_tag_count`  | Number of tags on this problem                                       |
|10–29| `tag_dp` … `tag_constructive` | Binary flags: 1 if this problem has the tag, else 0  |

For a problem with tags `{dp, greedy}`:
- `mean_tag_strength` = mean of `user_strength["tag_dp"]` and `user_strength["tag_greedy"]`
- `tag_strength_min` = min of the two
- `tag_strength_max` = max of the two
- `tag_dp = 1`, `tag_greedy = 1`, all others = 0

The `tag_strength` values used here come from `strength.py` (not `TagAnalyzer.py`) — they are in the `[0, 1]` range matching training time.

---

### 7.4 Model Hyperparameters

Both LightGBM models use identical hyperparameters:

| Parameter           | Value | Description                                              |
|---------------------|-------|----------------------------------------------------------|
| `n_estimators`      | 500   | Maximum trees (early stopping may reduce this)           |
| `learning_rate`     | 0.05  | Shrinkage rate per tree                                  |
| `num_leaves`        | 63    | Maximum leaves per tree (controls complexity)            |
| `max_depth`         | -1    | No depth limit (controlled via `num_leaves`)             |
| `min_child_samples` | 50    | Minimum samples per leaf (prevents overfitting on rare cases) |
| `subsample`         | 0.8   | 80% of rows per tree (row subsampling)                   |
| `colsample_bytree`  | 0.8   | 80% of features per tree (column subsampling)            |
| `random_state`      | 42    | For reproducibility                                      |
| `n_jobs`            | -1    | Use all CPU cores                                        |
| Early stopping      | 50    | Stop if validation loss doesn't improve for 50 rounds   |

Model pickle payloads:

`success_model.pkl`:
```python
{
    "model":      lgb.LGBMRegressor,
    "scaler":     None,
    "wa_penalty": 0.2,
    "type":       "regressor"
}
```

`attempts_model.pkl`:
```python
{
    "model":             lgb.LGBMRegressor,
    "feature_names":     [...],  # 29 feature names
    "tag_cols":          [...],  # 20 tag column names
    "max_attempts_clip": 10,
    "type":              "attempts_regressor"
}
```

---

## 8. KNN Evaluation

**Script:** `ML/evaluation/evaluate_knn.py`

Uses **Leave-One-Out (LOO) cross-validation** to measure how well KNN finds similar users.

For each user in the dataset:
1. Remove them from the 82-dim feature matrix
2. Run KNN (K=50) to find their nearest neighbors using the reduced matrix
3. Compare the user's tag strength profile to the neighbor centroid (mean of K neighbors)

#### Metrics

**Weakness Jaccard** — Set overlap of weak tags

```
Jaccard = |target_weak ∩ neighbor_weak| / |target_weak ∪ neighbor_weak|
```

A tag is "weak" if `tag_strength < WEAK_THRESHOLD` (default 0.7). This measures whether the user and their neighbors share the same set of weaker topics.

- 1.0 = identical weak-tag sets
- 0.0 = completely different weak tags

**Weakness Recall** — Coverage of the user's weak tags by neighbors

```
Recall = |target_weak ∩ neighbor_weak| / |target_weak|
```

Measures: of all the user's weak tags, what fraction are also weak in the neighbors? High recall means the neighbors reliably share the user's weaknesses.

**Tag MSE** — Numerical similarity of strength profiles

```
Tag MSE = mean((target_strengths - neighbor_centroid)²)
```

Lower is better (0 = perfect match). Measures whether the actual strength values are close, not just the weak/strong classification.

**Spearman Correlation** — Rank ordering similarity

```
Spearman = correlation(rank(target_strengths), rank(neighbor_centroid))
```

Measures whether the neighbors rank tags in the same order (e.g., both weakest in dp, strongest in greedy). 1.0 = identical ranking.

#### Results (full dataset, K=50, weak_threshold=0.7)

| Metric              | Value  | Target  | Interpretation                                      |
|---------------------|--------|---------|-----------------------------------------------------|
| Weakness Jaccard    | 0.6434 | > 0.5   | Neighbors share 64% of the user's weak-tag set      |
| Weakness Recall     | 0.8578 | > 0.7   | 86% of user's weak tags are also weak in neighbors  |
| Tag MSE             | 0.0075 | < 0.05  | Very close numerical profiles                       |
| Spearman Corr.      | 0.6342 | > 0.7   | Good but not perfect tag ranking match              |

---

## 9. Model Comparisons

Two comparison scripts evaluate alternative algorithms for both ML models.

### Success Model / Attempts Model — Algorithm Comparison

**Scripts:** `ML/evaluation/compare_attempts_models.py`, `compare_rating_progression_models.py`

All three algorithms are trained and evaluated on the same 80/20 train/test split:

| Algorithm                      | Notes                                                         |
|--------------------------------|---------------------------------------------------------------|
| LightGBM Regressor             | Gradient boosted trees, used in production                    |
| Linear Regression              | Features scaled with `StandardScaler` before fitting          |
| Logistic Regression*           | Ordinal-proxy: bins target into 5 equal-frequency classes, predicts class probabilities, final output = weighted average of bin midpoints |

**Logistic Regression Ordinal Proxy explained:**

Logistic Regression is a classifier, not a regressor. To use it for a continuous target:
1. Cut the target (`attempts`) into `N_BINS=5` equal-frequency bins using `np.percentile`
2. Each bin gets a midpoint value
3. Train multi-class logistic regression on the bin labels
4. At inference: `prediction = predict_proba(x) @ bin_midpoints`

This gives a continuous prediction while leveraging the classifier's probabilistic outputs.

**Attempts Estimator Results:**

| Model                | MAE    | RMSE   | R²     |
|----------------------|--------|--------|--------|
| LightGBM             | 0.8847 | 1.12   | 0.1778 |
| Linear Regression    | ~1.1   | ~1.4   | ~0.07  |
| Logistic Regression* | ~1.0   | ~1.3   | ~0.10  |

LightGBM outperforms both linear models significantly because it can capture nonlinear interactions (e.g., high `rating_diff` + low `tag_strength` is much worse than either alone).

---

## 10. Web Application

### 10.1 Frontend (React + Vite)

**File:** `website/src/App.jsx`  
**Framework:** React 19 (single `App.jsx` component, ~700 lines)  
**Charts:** Recharts (RadarChart, BarChart)  
**Build tool:** Vite 7

The entire application is one component with the following state:

| State variable    | Type    | Description                                        |
|-------------------|---------|----------------------------------------------------|
| `phase`           | string  | `"idle"` → `"loading"` → `"done"` / `"error"`    |
| `stats`           | object  | CF-derived stats (totalSolved, maxRating, etc.)   |
| `tagData`         | array   | CF accuracy per tag (from raw submissions)         |
| `ratingData`      | array   | Solved/failed count per rating bucket              |
| `mlData`          | object  | Full ML pipeline result (neighbors, problems, etc.)|
| `mlLoading`       | bool    | Whether ML pipeline is still running               |
| `aiPlan`          | string  | HTML string from Gemini coaching plan              |

When a handle is submitted, CF data and ML analysis are fetched in **parallel** using `Promise.allSettled`. CF data is required; ML is optional (the UI degrades gracefully if the Python pipeline fails).

#### Tabs

| Tab       | Shows                                                                  |
|-----------|------------------------------------------------------------------------|
| Overview  | Radar chart, weakest tags, tag impact card, solved-by-rating bar chart |
| Tag Analysis | Table: tag, solved, failed, ML strength bar                         |
| Ratings   | Grouped bar chart: solved vs failed per rating bucket                  |
| Recs      | ML-ranked problem cards with difficulty match, weakness boost, attempts badge |
| Peers     | KNN nearest neighbors table with similarity bars                       |
| AI Coach  | Gemini-generated 7-day study plan                                      |

#### Derived Values

The component derives several values from `mlData`:

```javascript
const mlTagStrengths   = mlData?.tag_strengths || {};
const mlProblems       = mlData?.recommended_problems || [];
const mlNeighbors      = [...].sort by display_similarity;
const mlTagsSorted     = Object.entries(mlTagStrengths)
                           .filter(attempted > 0)
                           .sort by strength ascending;  // weakest first
const tagImpact        = (mlData?.tag_impact || [])
                           .filter(delta_problems > 0)
                           .slice(0, 8);
```

`mlTagsSorted` uses TagAnalyzer scores (0–100, peer-benchmarked). The weakness threshold for "WEAK" badge is strength < 70.

### 10.2 Backend (Express Server)

**File:** `website/server/server.js`  
**Framework:** Express 5  
**Port:** 3000

The server bridges the React frontend to both the Codeforces API (to avoid CORS) and the Python ML pipeline (to run it as a subprocess).

**Environment variables required (`.env` file in `website/server/`):**

```
GEMINI_API_KEY=your_api_key_here
```

### 10.3 API Endpoints

#### `GET /api/cf/:handle`

Fetches the user's last 500 submissions and the full Codeforces problemset in parallel.

**Request:**
```
GET http://localhost:3000/api/cf/tourist
```

**Response:**
```json
{
  "status": "OK",
  "submissions": [...],     // Codeforces user.status result
  "problems":    [...]      // Codeforces problemset.problems result
}
```

**Error response:**
```json
{ "status": "FAILED", "submissions": [], "problems": [] }
```

---

#### `GET /api/ml/analyze/:handle`

Runs the full Python ML pipeline for the given handle. Spawns a Python subprocess using the `.venv` interpreter.

**Request:**
```
GET http://localhost:3000/api/ml/analyze/tourist
```

**Implementation detail:** The server spawns the Python virtual environment interpreter directly:
```
{project_root}/.venv/bin/python -c "from main import main; print(json.dumps(main('handle')))"
```

NumPy types (`np.int64`, `np.float32`, etc.) are converted to native Python types via a custom `convert()` function before JSON serialization.

**Response (success):**
```json
{
  "success": true,
  "target_user": "tourist",
  "recommendation": { "neighbors": [...] },
  "tag_strengths": {
    "tag_dp": {
      "strength": 82.3,
      "solved": 45,
      "attempted": 52,
      "acceptance_rate": 0.865,
      "avg_difficulty": 2150.0,
      "peer_median_solved": 38.0,
      "peer_median_acceptance": 0.71,
      "peer_median_difficulty": 1980.0
    }
  },
  "recommended_problems": [
    {
      "id": "1234_C",
      "rating": 1900,
      "tags": ["tag_dp", "tag_greedy"],
      "difficulty_match": 0.72,
      "solve_score": 0.44,
      "weakness_boost": 0.38,
      "final_score": 0.585,
      "estimated_attempts": 2.1,
      "difficulty_label": "moderate"
    }
  ],
  "tag_impact": [
    {
      "tag": "tag_dp",
      "label": "dp",
      "strength": 0.34,
      "delta_problems": 7,
      "estimated_rating_gain": 35
    }
  ],
  "problem_attempts": [...]
}
```

**Response (failure):**
```json
{
  "success": false,
  "error": "Target user handle not found or invalid: no_such_user"
}
```

---

#### `POST /api/coach`

Generates a 7-day AI coaching plan using Google Gemini.

**Request body:**
```json
{
  "handle":               "tourist",
  "estimatedRating":      1900,
  "weakTags":             [{"tag": "dp", "strength": 42, "solved": 12, "attempted": 18}],
  "strongTags":           [{"tag": "greedy", "strength": 87}],
  "recommendedProblems":  [{"id": "1234_C", "rating": 1900, "tags": ["dp"]}],
  "totalSolved":          350
}
```

**Response:**
```json
{
  "plan": "<div class=\"day\"><span class=\"day-label\">Day 1</span>...</div>"
}
```

The plan is HTML-formatted, rendered with `dangerouslySetInnerHTML` in the frontend.

---

## 11. Tag Set Reference

The system uses exactly 20 tags. All tag columns follow the `tag_` prefix convention.

| Column Name          | Display Label       | Codeforces Tag(s)              |
|----------------------|---------------------|-------------------------------|
| `tag_dp`             | dp                  | `dp`                          |
| `tag_greedy`         | greedy              | `greedy`                      |
| `tag_graphs`         | graphs              | `graphs`, `graph matchings`   |
| `tag_math`           | math                | `math`                        |
| `tag_strings`        | strings             | `strings`                     |
| `tag_impl`           | impl                | `implementation`              |
| `tag_binary_search`  | binary search       | `binary search`               |
| `tag_data_structures`| data structures     | `data structures`             |
| `tag_number_theory`  | number theory       | `number theory`               |
| `tag_combinatorics`  | combinatorics       | `combinatorics`               |
| `tag_geometry`       | geometry            | `geometry`                    |
| `tag_trees`          | trees               | `trees`                       |
| `tag_sortings`       | sortings            | `sortings`                    |
| `tag_two_pointers`   | two pointers        | `two pointers`                |
| `tag_bitmasks`       | bitmasks            | `bitmasks`                    |
| `tag_flows`          | flows               | `flows`                       |
| `tag_fft`            | fft                 | `fft`                         |
| `tag_games`          | games               | `games`                       |
| `tag_probabilities`  | probabilities       | `probabilities`               |
| `tag_constructive`   | constructive        | `constructive algorithms`     |

Any Codeforces tag not in this list is silently ignored during data collection. Problem tags like `*special`, `brute force`, `meet-in-the-middle`, etc. are dropped.

---

## 12. Configuration Reference

**File:** `src/pipeline/config.py`

| Constant                  | Value                            | Description                                   |
|---------------------------|----------------------------------|-----------------------------------------------|
| `CODEFORCES_API_BASE_URL` | `https://codeforces.com/api`     | Base URL for all CF API calls                 |
| `CODEFORCES_API_TIMEOUT`  | `30`                             | Seconds before API call times out             |
| `MAX_SUBMISSIONS_PER_USER`| `500`                            | Submissions fetched per user                  |
| `K_NEIGHBORS`             | `50`                             | Number of nearest neighbors                   |
| `KNN_METRIC`              | `"euclidean"`                    | Distance metric                               |
| `KNN_ALGORITHM`           | `"auto"`                         | sklearn KNN algorithm (not used — pure numpy) |
| `PERFORMANCE_LOG_FILE`    | `logs/performance_logs.json`     | Profiling output                              |
| `RECOMMENDATION_OUTPUT_FILE` | `logs/recommendations.json`  | Recommendation output                         |
| `RECOMMENDATION_OUTPUT_FORMAT` | `"json"`                   | Output format                                 |
| `ENABLE_API_CACHE`        | `True`                           | (Not yet implemented)                         |
| `CACHE_EXPIRY_HOURS`      | `24`                             | (Not yet implemented)                         |
| `DEBUG_MODE`              | `True`                           |                                               |
| `MIN_SUBMISSIONS_REQUIRED`| `5`                              | Minimum submissions for analysis              |

**ML constants (not in config.py — defined in each module):**

| Constant          | Value  | Location                        | Description                          |
|-------------------|--------|---------------------------------|--------------------------------------|
| `WA_PENALTY`      | 0.2    | `train_success_model.py`        | Per-WA penalty on solve_score        |
| `MAX_ATTEMPTS_CLIP` | 10   | `train_attempts_model.py`       | Max attempts target value            |
| `BOOST`           | 0.2    | `counterfactual_tag_impact.py`  | Tag strength boost in simulation     |
| `SWEET_LO`        | -0.2   | `prioritize_problems.py`        | Lower bound of difficulty sweet spot |
| `SWEET_HI`        | 0.8    | `prioritize_problems.py`        | Upper bound of difficulty sweet spot |
| `MAX_RATING`      | 3500   | `strength.py`, `feature_engineering.py` | Normalizer for ratings        |
| `SMOOTHING`       | 2      | `strength.py`, `feature_engineering.py` | Laplace smoothing constant    |
| `K` (eval)        | 50     | `evaluate_knn.py`               | K for leave-one-out evaluation       |
| `WEAK_THRESHOLD`  | 0.7    | `evaluate_knn.py`               | tag_strength below this = "weak"     |

---

## 13. Performance Profiling

**Files:** `src/profiling/profiler.py`, `src/profiling/logger.py`

Every run of the pipeline is timed and logged to `logs/performance_logs.json`.

The `StageProfiler` class wraps each pipeline stage in a context manager:

```python
with profiler.profile_data_collection(metadata={"target_user": handle}):
    # API calls happen here
    collected = collector.collect_data(user_handle)
```

Each stage records:
- `execution_time_seconds` — wall clock time
- `memory_usage_mb` — RSS memory delta (using `psutil`)
- `metadata` — arbitrary dict (e.g., feature dimensions, number of neighbors)

At the end of a run, a summary is appended to the JSON log:

```json
{
  "run_id": "...",
  "target_user": "tourist",
  "stages": [
    {"stage": "data_collection", "execution_time_seconds": 1.23, "memory_usage_mb": 2.1},
    {"stage": "feature_engineering", "execution_time_seconds": 0.45, ...},
    {"stage": "model_inference", "execution_time_seconds": 0.08, ...},
    {"stage": "recommendation_generation", "execution_time_seconds": 3.12, ...}
  ],
  "summary": {
    "total_execution_time_seconds": 5.4,
    "total_memory_used_mb": 18.3
  }
}
```

The JSON log is cleared at the start of each run (`os.remove()` if it exists) so it always contains only the latest run's data.

---

## 14. Installation & Running

### Prerequisites

- Python 3.11+ (3.13 tested)
- Node.js 18+
- A `.venv` virtual environment at project root

### Python Setup

```bash
cd cf-analyzer
python -m venv .venv
source .venv/bin/activate
pip install pandas numpy scikit-learn lightgbm scipy psutil requests
```

### Node.js Setup

```bash
# Frontend
cd website
npm install

# Backend
cd server
npm install
```

### Environment Variables

Create `website/server/.env`:
```
GEMINI_API_KEY=your_gemini_api_key
```

### Running

**Start the backend (required):**
```bash
cd website/server
node server.js
# Server running on port 3000
```

**Start the frontend:**
```bash
cd website
npm run dev
# → http://localhost:5173
```

**Run the pipeline directly (CLI):**
```bash
source .venv/bin/activate
python main.py tourist
```

### Training Models (if re-training)

**Success model:**
```bash
source .venv/bin/activate
python ML/training/train_success_model.py
```

**Attempts model:**
```bash
python ML/training/train_attempts_model.py
```

### Running Evaluations

**KNN Leave-One-Out evaluation:**
```bash
python ML/evaluation/evaluate_knn.py
```

**Model comparison (attempts):**
```bash
python ML/evaluation/compare_attempts_models.py
```

**Rebuild tag strengths from scratch (after new data):**
```bash
cd ML/preprocessing
python strength.py
```

---

## 15. Data Flow Diagram

Below is the complete data flow from a user typing a handle to results appearing in the browser:

```
User types "tourist" → clicks Analyze
         │
         ▼
Browser fires two parallel requests:
┌─────────────────────────────────┐  ┌───────────────────────────────┐
│ GET /api/cf/tourist             │  │ GET /api/ml/analyze/tourist    │
│                                 │  │                               │
│ Node.js fetches:                │  │ Node.js spawns Python:        │
│  · CF user.status (500 subs)    │  │  python -c "from main import  │
│  · CF problemset.problems       │  │   main; print(main('tourist'))│
│                                 │  │                               │
│ Returns: submissions + problems │  │ Python runs:                  │
└─────────────┬───────────────────┘  │  1. CF API: user.info         │
              │                      │     CF API: user.status       │
              ▼                      │  2. Build 82-dim vector       │
       analyzeData()                 │  3. KNN vs 2,877 users        │
       ·  tag accuracy               │  4. TagAnalyzer (peer bench)  │
       ·  rating bucket stats        │  5. find_unsolved_problems    │
       ·  estimated rating           │  6. prioritize_problems       │
                                     │     (LightGBM solve_score)    │
                                     │  7. counterfactual_tag_impact │
                                     │  8. estimate_attempts         │
                                     │                               │
                                     │ Returns: JSON result          │
                                     └───────────────┬───────────────┘
                                                     │
                                     ▼               ▼
                               setStats()        setMlData()
                                                     │
                                                     ▼
                               React renders:
                               ┌─────────────────────────────┐
                               │  StatCards                  │
                               │  Tabs (Overview / Tags / …) │
                               │  Radar chart (peer-bench)   │
                               │  Tag Impact bars            │
                               │  Problem cards (with badge) │
                               │  Neighbors table            │
                               └─────────────────────────────┘
```

---

*Last updated: 2026-05-16*
