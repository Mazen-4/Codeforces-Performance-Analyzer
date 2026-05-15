# CF Analyzer — Codeforces Performance Analyzer

A machine learning system that analyzes a Codeforces user's submission history, finds the 50 most similar competitive programmers from a dataset of 2,877 users, diagnoses tag-level weaknesses, and recommends problems most likely to drive rating growth.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Structure](#2-repository-structure)
3. [Dataset](#3-dataset)
4. [Full Pipeline](#4-full-pipeline)
   - 4.1 [Data Collection](#41-data-collection)
   - 4.2 [Preprocessing & Feature Engineering](#42-preprocessing--feature-engineering)
   - 4.3 [KNN — Finding Similar Users](#43-knn--finding-similar-users)
   - 4.4 [Tag Strength Analysis](#44-tag-strength-analysis)
   - 4.5 [Problem Discovery](#45-problem-discovery)
   - 4.6 [Problem Prioritization — Success Model](#46-problem-prioritization--success-model)
   - 4.7 [Rating Progression Prediction](#47-rating-progression-prediction)
   - 4.8 [Attempts Estimation](#48-attempts-estimation)
5. [Models](#5-models)
   - 5.1 [Success Model (LightGBM Regressor)](#51-success-model-lightgbm-regressor)
   - 5.2 [Rating Progression Model](#52-rating-progression-model)
   - 5.3 [Attempts Estimator](#53-attempts-estimator)
6. [Model Comparisons](#6-model-comparisons)
   - 6.1 [Rating Progression — LightGBM vs Linear vs Logistic](#61-rating-progression--lightgbm-vs-linear-vs-logistic)
   - 6.2 [Attempts Estimator — LightGBM vs Linear vs Logistic](#62-attempts-estimator--lightgbm-vs-linear-vs-logistic)
7. [KNN Evaluation](#7-knn-evaluation)
8. [Web Application](#8-web-application)
9. [Installation & Usage](#9-installation--usage)
10. [Configuration](#10-configuration)

---

## 1. Project Overview

CF Analyzer answers one question: **"What should I practice next to improve my Codeforces rating?"**

It does this in six stages:

```
User Handle
    │
    ▼
[1] Codeforces API  ──→  500 latest submissions + user info
    │
    ▼
[2] Feature Engineering  ──→  82-dim tag-strength vector
    │
    ▼
[3] KNN Search  ──────────→  50 nearest neighbors from 2,877-user dataset
    │
    ▼
[4] Tag Analysis  ────────→  Peer-benchmarked strength per topic (0–100)
    │
    ▼
[5] Problem Pool  ────────→  Unsolved problems solved by neighbors
    │
    ▼
[6] Three ML Models  ─────→  Difficulty match · Rating potential · Solve difficulty
```

---

## 2. Repository Structure

```
cf-analyzer/
│
├── main.py                          # Pipeline entry point
├── requirements.txt
│
├── src/
│   ├── pipeline/
│   │   ├── config.py                # KNN settings, API config, paths
│   │   ├── data_collection.py       # Codeforces API fetcher
│   │   ├── feature_engineering.py   # 82-dim feature vector builder
│   │   ├── model_inference.py       # KNN distance computation
│   │   └── recommendation.py        # Output formatter
│   └── profiling/
│       ├── profiler.py              # Per-stage timing
│       └── logger.py                # JSON performance logs
│
├── ML/
│   ├── dataset/                     # Pre-built CSVs (5,000 users, 819K submissions)
│   │   ├── 02_user_profiles.csv
│   │   ├── 04_filtered_submissions.csv
│   │   ├── 06_user_tag_strengths.csv
│   │   └── 07_enriched_user_profiles.csv
│   │
│   ├── models/                      # Trained model binaries
│   │   ├── success_model.pkl        # Predicts solve_score ∈ [−1, 1]
│   │   ├── attempts_model.pkl       # Predicts attempts before AC
│   │   └── rating_progression_model.pkl  # Predicts rating growth potential
│   │
│   ├── inference/                   # Inference modules (used by main.py)
│   │   ├── TagAnalyzer.py           # Peer-benchmarked tag scoring
│   │   ├── find_unsolved_problems.py
│   │   ├── prioritize_problems.py   # Success model inference
│   │   ├── predict_attempts.py      # Attempts model inference
│   │   └── predict_rating_progression.py
│   │
│   ├── training/                    # Scripts that produce .pkl files
│   │   ├── train_success_model.py
│   │   ├── train_attempts_model.py
│   │   └── train_rating_progression_model.py
│   │
│   ├── evaluation/                  # Evaluation and comparison scripts
│   │   ├── evaluate_knn.py          # Leave-one-out KNN evaluation
│   │   ├── compare_attempts_models.py
│   │   └── compare_rating_progression_models.py
│   │
│   └── preprocessing/               # Dataset construction scripts
│       ├── submissionsCleaning.py
│       ├── userProfiles.py
│       ├── userTagStrengths.py
│       └── strength.py              # Tag strength formula implementation
│
├── visualization/
│   ├── visualize_knn.py
│   ├── visualize_ml_results.py
│   └── export_report.py
│
└── website/
    ├── src/App.jsx                  # React frontend
    └── server/server.js             # Express API server
```

---

## 3. Dataset

The dataset was built by scraping Codeforces profiles and submissions for 5,000 users rated between 900 and 2,598.

| File | Rows | Columns | Description |
|------|------|---------|-------------|
| `02_user_profiles.csv` | 5,000 | 51 | Contest history, rating, activity metrics |
| `04_filtered_submissions.csv` | 819,242 | 26 | One row per submission, binary tag flags |
| `06_user_tag_strengths.csv` | 50,362 | 21 | One row per (user, tag) — all strength component scores |
| `07_enriched_user_profiles.csv` | 4,997 | 75 | Profiles + pre-pivoted tag strength columns |

### Rating Distribution

| Band | Users |
|------|-------|
| 900 – 1,200 | 700 |
| 1,200 – 1,600 | 1,700 |
| 1,600 – 2,000 | 1,355 |
| 2,000 – 2,598 | 1,245 |

### 20 Problem Tags Tracked

```
dp · greedy · graphs · math · strings · implementation · binary_search
data_structures · number_theory · combinatorics · geometry · trees
sortings · two_pointers · bitmasks · flows · fft · games · probabilities · constructive
```

---

## 4. Full Pipeline

### 4.1 Data Collection

**File:** `src/pipeline/data_collection.py`

Only the **target user** is fetched live from the Codeforces API. The 2,877-user dataset is pre-built and loaded from CSV — no API calls for dataset users.

```python
# Two API calls per analysis run
GET /api/user.status?handle={handle}&from=1&count=500   # latest 500 submissions
GET /api/user.info?handles={handle}                      # cf_rating, maxRating
```

Each submission is flattened into a row with binary tag flags:

```python
{
  "handle":         "o.khalifa",
  "problem_id":     "1234_A",
  "problem_rating": 1400,
  "is_ac":          1,       # 1 if verdict == "OK", else 0
  "tag_dp":         0,
  "tag_greedy":     1,
  "tag_math":       0,
  ...                        # 20 binary tag columns
}
```

Codeforces tag names are normalized to the canonical 20-tag set via a mapping:

```python
_CF_TAG_MAP = {
    "constructive algorithms": "tag_constructive",
    "implementation":          "tag_impl",
    "graph matchings":         "tag_graphs",
    "binary search":           "tag_binary_search",
    ...
}
```

---

### 4.2 Preprocessing & Feature Engineering

**Files:** `ML/preprocessing/strength.py`, `src/pipeline/feature_engineering.py`

#### Dataset Preprocessing (offline, run once)

`submissionsCleaning.py` deduplicates submissions, removes corrupted handles (`#NAME?` from Excel), and filters unrated problems.

`strength.py` computes a `tag_strength` ∈ [0, 1] score for every (user, tag) pair using six weighted components:

```
tag_strength = Σ weight_i × score_i

  acceptance_rate       (weight 0.30) = (AC_count + 1) / (attempts + 2)   [Laplace smoothed]
  difficulty_score      (weight 0.30) = avg_solved_rating / 3500
  rating_boost          (weight 0.20) = (cf_rating + cf_max_rating) / (2 × 3500)
  specialization_score  (weight 0.10) = tag_solved / total_solved
  efficiency_score      (weight 0.075)= first_try_rate
  volume_score          (weight 0.075)= log(1 + ac_count) / log(1 + 50)
```

#### Live Feature Vector (82 dims, computed per request)

`feature_engineering.py` builds the same 82-dim vector live from the target user's API submissions, mirroring the `strength.py` formula exactly:

```
Feature vector layout (82 dims total):

  Indices 00–19   acceptance_rate      per tag  (20 floats)
  Indices 20–39   difficulty_score     per tag  (20 floats)
  Indices 40–59   specialization_score per tag  (20 floats)
  Indices 60–79   volume_score         per tag  (20 floats)
  Index   80      rating_boost         (user-level scalar, appears once)
  Index   81      efficiency_score     (user-level scalar, appears once)
```

The two user-level features appear once at the end rather than repeated 20× — repeating them would inflate Euclidean distances without adding information.

---

### 4.3 KNN — Finding Similar Users

**File:** `src/pipeline/model_inference.py`

Pure NumPy — no scikit-learn dependency. Distance metric: **Euclidean**.

```python
distances = np.linalg.norm(feature_matrix - target_vector, axis=1)
nn_indices = np.argsort(distances)[:50]
```

Two similarity scores are computed per neighbor:

| Score | Formula | Purpose |
|-------|---------|---------|
| `similarity` (internal) | Rank 1 → 100%, rank 50 → 0% (linear) | Weight for tag analysis and problem scoring |
| `display_similarity` | Maps full-dataset min–max distance range to [0%, 100%] | Shown in UI peers table |

The dataset feature matrix (2,877 × 82) is loaded once from `06_user_tag_strengths.csv` and kept in memory for fast distance computation.

---

### 4.4 Tag Strength Analysis

**File:** `ML/inference/TagAnalyzer.py`

After finding the 50 neighbors, tag strengths are **re-computed relative to the peer group** — not the whole dataset. This gives a benchmarked score: 100% means the user outperforms their peers in that tag, not that they're a global expert.

Four sub-scores normalized against the **peer median**:

```
1. Acceptance Rate   (weight 0.35)
   = user_AC_rate / peer_median_AC_rate       (capped at 1.0)

2. Difficulty Level  (weight 0.35)
   = user_avg_difficulty / peer_median_difficulty

3. Volume            (weight 0.20)
   = 1 − exp(−user_solved / peer_median_solved)   [soft saturation curve]

4. Specialization    (weight 0.10)
   = (tag_solved / total_solved) / peer_median_specialization
```

> **Important:** The TagAnalyzer output (0–100 relative score) is used only for display. The KNN feature vector and ML model inputs use the absolute `tag_strength` (0–1) from `strength.py`, ensuring training and inference are on the same scale.

---

### 4.5 Problem Discovery

**File:** `ML/inference/find_unsolved_problems.py`

Builds a candidate pool from the 50 neighbors' solved problems:

1. Load all 819K submissions, filter to the 50 neighbor handles
2. For each problem a neighbor solved: check if target user has **not** solved it
3. Score each candidate by how many (and how similar) neighbors solved it:

```python
problem_score = Σ (neighbor_similarity_weight × solved_by_neighbor)
```

A higher score means the problem is solved by more similar neighbors — a stronger signal that it's within reach.

---

### 4.6 Problem Prioritization — Success Model

**File:** `ML/inference/prioritize_problems.py`  
**Model:** `ML/models/success_model.pkl`

The success model predicts `solve_score` — how cleanly a user would solve a problem if they attempted it.

#### solve_score Definition

```
solve_score = (ever_ac − wa_count × 0.2).clip(−1, 1)

Examples:
  Solved, 0 WA  →  1.0   (clean solve)
  Solved, 2 WA  →  0.6   (minor struggle)
  Solved, 5 WA  →  0.0   (borderline)
  Solved, 7 WA  → −0.4   (effectively failed)
  Not solved, 3 WA → −0.6 (failure)
```

#### Sweet Spot Filter

Only problems in `solve_score ∈ [−0.2, 0.8]` are recommended.  
This maps to `difficulty_match ∈ [40%, 90%]` — challenging but reachable.

```
difficulty_match = (solve_score + 1) / 2
```

| solve_score | difficulty_match | Verdict |
|-------------|-----------------|---------|
| > 0.8 | > 90% | Too easy — skip |
| 0.8 → −0.2 | 90% → 40% | **Recommended ✓** |
| < −0.2 | < 40% | Too hard — skip |

#### Final Ranking Score

```python
weakness_boost = mean(
    (1 − user_tag_strength[tag]) × neighbor_tag_strength[tag]
    for tag in problem.tags
)

final_score = 0.6 × difficulty_match + 0.4 × weakness_boost
```

Problems are sorted by `weakness_boost` first, `final_score` as tiebreaker — ensuring the top results target the user's weakest topics where neighbors are strong.

---

### 4.7 Rating Progression Prediction

**File:** `ML/inference/predict_rating_progression.py`  
**Model:** `ML/models/rating_progression_model.pkl`

Predicts `cf_max_rating − cf_rating` — how many additional rating points the user could realistically gain.

```
Features (38 total):
  Profile signals (18):
    cf_rating, total_contests, contests_per_year,
    first_try_rate, avg_attempts_to_ac,
    unique_problems_solved, unique_problems_tried,
    solved_lte_1000 … solved_gt_3000,
    practice_sub_ratio, contest_sub_ratio,
    subs_per_active_day, tag_coverage_pct, unique_tags_solved

  Tag strengths (20):
    strength_tag_dp … strength_tag_constructive
```

Output:

```json
{
  "predicted_potential": 85,
  "predicted_peak": 1305,
  "top_growth_tags": [
    { "label": "sortings",        "strength": 0.21, "importance": 225 },
    { "label": "two pointers",    "strength": 0.18, "importance": 205 },
    { "label": "data structures", "strength": 0.30, "importance": 192 }
  ]
}
```

`top_growth_tags` lists the user's weak tags (strength < 0.5) sorted by their feature importance in the model — the tags where improvement would most impact the predicted ceiling.

---

### 4.8 Attempts Estimation

**File:** `ML/inference/predict_attempts.py`  
**Model:** `ML/models/attempts_model.pkl`

Complements the success model: while the success model predicts **whether** a user will solve a problem, the attempts model predicts **how hard** it will be if they do.

```
target = wa_count + 1   (clipped to [1, 10])
```

Uses the **same 29-dim feature vector** as the success model so both models share one inference path with no extra computation.

Output annotated onto each recommended problem:

```json
{
  "estimated_attempts": 1.8,
  "difficulty_label":   "moderate"
}
```

| Label | Range | Color in UI |
|-------|-------|-------------|
| `easy` | < 1.5 | Green |
| `moderate` | 1.5 – 2.5 | Yellow |
| `hard` | > 2.5 | Red |

---

## 5. Models

### 5.1 Success Model (LightGBM Regressor)

**Training script:** `ML/training/train_success_model.py`

| Parameter | Value |
|-----------|-------|
| Algorithm | `LGBMRegressor` |
| Target | `solve_score ∈ [−1, 1]` |
| WA penalty | 0.2 per wrong answer |
| Training rows | ~335,000 (one per (user, problem)) |
| Features | 29 |
| Best iteration | 464 (early stopping patience = 50) |
| n_estimators | 500 |
| learning_rate | 0.05 |
| num_leaves | 63 |

**Feature set (29 dims):**

| Feature | Description |
|---------|-------------|
| `rating_diff` | `problem_rating − cf_rating` |
| `rating_diff_sq` | `rating_diff²` |
| `cf_rating` | User's current rating |
| `mean_tag_strength` | Mean of user's strength for the problem's tags |
| `tag_strength_min` | Minimum strength across the problem's tags |
| `tag_strength_max` | Maximum strength across the problem's tags |
| `tag_coverage` | `matched_tags / 20` |
| `num_solved` | Total problems solved by user |
| `problem_tag_count` | Number of tags on this problem |
| `tag_dp … tag_constructive` | 20 binary tag flags |

**Evaluation results:**

| Metric | Value |
|--------|-------|
| MAE | 0.2599 |
| MSE | 0.1546 |
| R² | 0.2679 |
| AUC-ROC (threshold 0.5) | 0.8094 |
| F1 Score (threshold 0.5) | 0.9079 |

**Solve score distribution in training data:**

| Range | Count | % |
|-------|-------|---|
| `[1.0, 1.0]` — clean solve | 252,151 | 59.9% |
| `[0.5, 1.0)` | 99,125 | 23.5% |
| `[0.0, 0.5)` | 28,797 | 6.8% |
| `[−0.5, 0.0)` | 25,186 | 6.0% |
| `[−1.0, −0.5)` | 15,806 | 3.8% |

---

### 5.2 Rating Progression Model

**Training script:** `ML/training/train_rating_progression_model.py`

| Parameter | Value |
|-----------|-------|
| Algorithm | `LGBMRegressor` |
| Target | `cf_max_rating − cf_rating` (clipped ≥ 0) |
| Training rows | 2,295 users |
| Features | 38 |
| Best iteration | 261 |
| learning_rate | 0.03 |
| reg_alpha / reg_lambda | 0.1 / 0.1 |

**Evaluation results:**

| Metric | Value |
|--------|-------|
| MAE | 53.96 rating points |
| RMSE | 74.54 rating points |
| R² | 0.4259 |

**MAE by rating band:**

| Band | MAE (pts) | n |
|------|-----------|---|
| 900 – 1,200 | 81.6 | 69 |
| 1,200 – 1,600 | 46.9 | 143 |
| 1,600 – 2,000 | 58.1 | 176 |
| 2,000 – 2,600 | 45.2 | 186 |

**Top 5 most important features:**

| Feature | Importance |
|---------|-----------|
| `cf_rating` | 856 |
| `total_contests` | 664 |
| `contests_per_year` | 507 |
| `contest_sub_ratio` | 372 |
| `practice_sub_ratio` | 357 |

---

### 5.3 Attempts Estimator

**Training script:** `ML/training/train_attempts_model.py`

| Parameter | Value |
|-----------|-------|
| Algorithm | `LGBMRegressor` |
| Target | `wa_count + 1`, clipped to [1, 10] |
| Training rows | 307,295 (solved problems only) |
| Features | 29 (identical to success model) |
| Best iteration | 378 |

**Evaluation results:**

| Metric | Value |
|--------|-------|
| MAE | 0.8847 attempts |
| RMSE | 1.3698 attempts |
| R² | 0.1778 |

**Calibration — mean predicted vs actual:**

| Actual attempts | LightGBM | Linear Regression |
|----------------|----------|-----------------|
| 1 | 1.64 | 1.69 |
| 2 | 1.89 | 1.88 |
| 3 | 2.06 | 1.97 |
| 4 | 2.19 | 2.06 |
| 5 | 2.35 | 2.14 |

> R² = 0.18 is low because 65% of training examples have `attempts = 1` (solved first try). The extreme right-skew makes the distribution inherently hard to predict. The model is still useful for **relative ranking** of problems by expected difficulty within a recommendation set.

---

## 6. Model Comparisons

All comparisons use an identical 80/20 train/test split (`random_state=42`). Linear and Logistic Regression inputs are `StandardScaler`-normalized. Logistic Regression is adapted as an **ordinal-proxy regressor**: the continuous target is binned into 5 equal-frequency classes, a multi-class classifier is trained, then the numeric prediction is recovered as the weighted average of bin midpoints via `predict_proba`.

### 6.1 Rating Progression — LightGBM vs Linear vs Logistic

**Run:** `python ML/evaluation/compare_rating_progression_models.py`

| Model | MAE (pts) | RMSE (pts) | R² |
|-------|-----------|-----------|-----|
| **LightGBM** | **53.96** | **74.54** | **0.4259** ✓ |
| Linear Regression | 58.19 | 80.33 | 0.3333 |
| Logistic Regression* | 75.26 | 92.47 | 0.1166 |

**MAE by rating band:**

| Band | LightGBM | Linear | Logistic* |
|------|----------|--------|-----------|
| 900 – 1,200 | 81.6 | 99.6 | 112.0 |
| 1,200 – 1,600 | 46.9 | 53.1 | 67.9 |
| 1,600 – 2,000 | 58.1 | 64.8 | 81.6 |
| 2,000 – 2,600 | 45.2 | **40.5** | 61.2 |

**Key observations:**
- LightGBM wins on every metric except MAE in the 2,000–2,600 band where Linear Regression is marginally better (40.5 vs 45.2)
- The 900–1,200 band has the highest error across all models — users at lower ratings have the most unpredictable growth trajectories
- Logistic Regression performs significantly worse: the heavily skewed, continuous target (75% of users have potential ≤ 50 pts) loses too much signal when binned

---

### 6.2 Attempts Estimator — LightGBM vs Linear vs Logistic

**Run:** `python ML/evaluation/compare_attempts_models.py`

| Model | MAE | RMSE | R² |
|-------|-----|------|-----|
| **LightGBM** | **0.8847** | **1.3698** | **0.1778** ✓ |
| Linear Regression | 0.9263 | 1.4303 | 0.1035 |
| Logistic Regression* | 1.6944 | 1.9232 | −0.6208 |

**MAE by rating band:**

| Band | LightGBM | Linear | Logistic* |
|------|----------|--------|-----------|
| 900 – 1,200 | 0.903 | 0.969 | 1.716 |
| 1,200 – 1,600 | 0.911 | 0.955 | 1.741 |
| 1,600 – 2,000 | 0.884 | 0.919 | 1.702 |
| 2,000 – 2,600 | 0.857 | 0.896 | 1.640 |

**Key observations:**
- Logistic Regression achieves **negative R² (−0.62)** — worse than predicting the mean for every sample. The combination of a heavily right-skewed target and binning quantization makes it completely unsuitable
- LightGBM and Linear Regression are competitive; LightGBM's advantage comes from capturing the non-linear interaction between `rating_diff` and `mean_tag_strength`
- MAE is consistent across rating bands for both tree and linear models — the model is not systematically biased toward any skill level

---

## 7. KNN Evaluation

**Run:** `python ML/evaluation/evaluate_knn.py`

Uses **leave-one-out evaluation**: remove a user from the feature matrix, run KNN on the remaining users, measure how well the resulting neighborhood reflects the removed user's true tag profile.

**Settings:** K=50, N=300 sampled users, weak_threshold=0.5

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Weakness Jaccard | 0.6434 | > 0.5 | ✓ |
| Weakness Recall | 0.8578 | > 0.7 | ✓ |
| Tag MSE | 0.0075 | < 0.05 | ✓ |
| Spearman Correlation | 0.6342 | > 0.7 | near |

**Metric definitions:**

```
Weakness Jaccard = |target_weak ∩ neighbor_weak| / |target_weak ∪ neighbor_weak|

  How much overlap exists between the user's weak-tag set and their
  neighbors' weak-tag set. 0 = no shared weaknesses, 1 = identical.

Weakness Recall  = |target_weak ∩ neighbor_weak| / |target_weak|

  What fraction of the user's own weak tags appear as weak in neighbors.
  High recall = neighbors reliably share the user's weak areas.

Tag MSE          = mean((user_tag_strengths − neighbor_centroid_strengths)²)

  Raw strength vector similarity. MSE < 0.05 means neighbors have
  very similar numeric tag profiles.

Spearman         = rank correlation between user's and neighbors' tag vectors

  Whether the ordering of strong→weak tags matches between user and neighbors.
```

**Interpretation:** A Weakness Recall of 0.86 means 86% of a user's weak tags also appear weak in their KNN neighbors. The KNN is reliably surfacing the right weakness context — the key driver of recommendation quality.

---

## 8. Web Application

### Architecture

```
Browser (React + Recharts)
    │
    │  GET  /api/cf/:handle          → Codeforces API proxy (submissions + problems)
    │  GET  /api/ml/analyze/:handle  → Python ML pipeline via subprocess
    │  POST /api/coach               → Gemini 2.5 Flash API (AI coaching plan)
    ▼
Express Server  (Node.js, port 3000)
    │
    ├── /api/cf/:handle  ─────────→  Codeforces REST API
    │                                  user.status (500 submissions)
    │                                  problemset.problems (full problem list)
    │
    ├── /api/ml/analyze/:handle  ──→  spawn .venv/bin/python -c "..."
    │                                  runs main.py → JSON result
    │                                  (profiling stripped before response)
    │
    └── /api/coach  ──────────────→  GoogleGenerativeAI (gemini-2.5-flash)
                                       generates 7-day HTML study plan
```

The CF fetch and ML pipeline run **in parallel** on the client:

```javascript
const [raw, ml] = await Promise.allSettled([
  fetchCFData(handle),
  fetchMLAnalysis(handle),
]);
// CF data renders immediately; ML data augments the view when ready
```

### UI Tabs

| Tab | Content |
|-----|---------|
| **Overview** | Tag radar · Weakest 7 tags with progress bars · Rating growth potential card |
| **Tag Analysis** | Full tag table: solved, failed, ML strength bar, WEAK badge |
| **Ratings** | Solved vs failed by rating bucket (stacked bar chart) |
| **Recs** | ML-ranked problems: difficulty match · growth boost · `~X.X tries` badge |
| **Peers** | 50 KNN neighbors sorted by display_similarity with similarity bar |
| **AI Coach** | Gemini 2.5 Flash 7-day HTML study plan based on weak tags |

### Problem Card

Each recommended problem shows three signals from three different models:

```
╔══════════════════════════════════════════════╗
║  1234_A  ·  ★1400                            ║
║  ◈ 72% match   ↑ 45% growth   ~1.8 tries    ║
║                              [ moderate ]    ║
║  [ dp ]  [ greedy ]                          ║
╚══════════════════════════════════════════════╝

  72% match   ← difficulty_match from success model
  45% growth  ← weakness_boost (user weak + neighbors strong)
  ~1.8 tries  ← estimated_attempts from attempts model (yellow = moderate)
```

### Rating Growth Potential Card (Overview tab)

```
╔══════════════════════════════════════════════╗
║  RATING GROWTH POTENTIAL                     ║
║  ✦ predicted by ML model trained on 2,877    ║
║                                              ║
║  ┌──────────────┐  ┌──────────────┐         ║
║  │ POTENTIAL    │  │ PREDICTED    │         ║
║  │    +85       │  │   PEAK 1305  │         ║
║  │ rating pts   │  │ est. ceiling │         ║
║  └──────────────┘  └──────────────┘         ║
║                                              ║
║  TOP TAGS TO IMPROVE                         ║
║  sortings      [███░░░░░] 21%               ║
║  two pointers  [██░░░░░░] 18%               ║
║  data struct.  [████░░░░] 30%               ║
╚══════════════════════════════════════════════╝
```

---

## 9. Installation & Usage

### Prerequisites

- Python 3.10+
- Node.js 18+
- A Gemini API key (for AI Coach tab — optional)

### Python Setup

```bash
git clone https://github.com/your-repo/cf-analyzer
cd cf-analyzer

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

pip install lightgbm scikit-learn pandas numpy scipy
```

### Website Setup

```bash
cd website && npm install

cd server && npm install

# Create environment file
echo "GEMINI_API_KEY=your_key_here" > .env
```

### Running the Full Stack

```bash
# Terminal 1 — verify the pipeline works
python main.py o.khalifa

# Terminal 2 — API + ML server
cd website/server && node server.js

# Terminal 3 — React dev server
cd website && npm run dev
# Open http://localhost:5173
```

### Using the Pipeline Directly

```python
from main import main

result = main("o.khalifa", verbose=False)

# Rating progression
print(result["rating_progression"])
# → {"predicted_potential": 85, "predicted_peak": 1305, "top_growth_tags": [...]}

# Top recommended problems
for p in result["recommended_problems"][:5]:
    print(f"{p['id']} [{p['rating']}]  "
          f"match={p['difficulty_match']:.0%}  "
          f"growth={p['weakness_boost']:.0%}  "
          f"~{p['estimated_attempts']:.1f} tries ({p['difficulty_label']})")
```

### Retraining Models

```bash
# Train in this order (success model trains fastest, used by pipeline)
python ML/training/train_success_model.py
python ML/training/train_attempts_model.py
python ML/training/train_rating_progression_model.py
```

### Running Evaluations

```bash
python ML/evaluation/evaluate_knn.py                      # KNN leave-one-out
python ML/evaluation/compare_rating_progression_models.py # model comparison
python ML/evaluation/compare_attempts_models.py           # model comparison
```

---

## 10. Configuration

**`src/pipeline/config.py`**

| Setting | Default | Description |
|---------|---------|-------------|
| `K_NEIGHBORS` | 50 | Number of KNN neighbors to find |
| `KNN_METRIC` | `"euclidean"` | Distance metric (`euclidean`, `manhattan`, `cosine`) |
| `MAX_SUBMISSIONS_PER_USER` | 500 | Codeforces API submission fetch limit |
| `CODEFORCES_API_TIMEOUT` | 30s | API request timeout |

**`ML/inference/prioritize_problems.py`**

| Setting | Default | Description |
|---------|---------|-------------|
| `lo` | −0.2 | Sweet spot lower bound (difficulty_match = 40%) |
| `hi` | 0.8 | Sweet spot upper bound (difficulty_match = 90%) |
| `alpha` | 0.6 | Weight of `difficulty_match` in `final_score` |
| `beta` | 0.4 | Weight of `weakness_boost` in `final_score` |

**`ML/evaluation/evaluate_knn.py`**

| Setting | Default | Description |
|---------|---------|-------------|
| `K` | 50 | Neighbors per LOO query |
| `N_SAMPLE` | 300 | Users evaluated (set `None` for all 2,877) |
| `WEAK_THRESHOLD` | 0.5 | `tag_strength` below this = weak tag |
