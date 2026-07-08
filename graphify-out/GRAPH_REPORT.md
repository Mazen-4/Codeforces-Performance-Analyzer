# Graph Report - .  (2026-07-07)

## Corpus Check
- 98 files · ~152,324 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 789 nodes · 1012 edges · 93 communities (59 shown, 34 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 56 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Main Pipeline Entry Point|Main Pipeline Entry Point]]
- [[_COMMUNITY_Deck Presentation UI Component|Deck Presentation UI Component]]
- [[_COMMUNITY_Performance Logging|Performance Logging]]
- [[_COMMUNITY_Full Pipeline Orchestration|Full Pipeline Orchestration]]
- [[_COMMUNITY_Crawl Recovery Workflow|Crawl Recovery Workflow]]
- [[_COMMUNITY_Frontend NPM Dependencies|Frontend NPM Dependencies]]
- [[_COMMUNITY_Feature Vector & Counterfactual Analysis|Feature Vector & Counterfactual Analysis]]
- [[_COMMUNITY_Codeforces Crawler|Codeforces Crawler]]
- [[_COMMUNITY_Docker & Kubernetes Deployment|Docker & Kubernetes Deployment]]
- [[_COMMUNITY_KNN Leave-One-Out Evaluation|KNN Leave-One-Out Evaluation]]
- [[_COMMUNITY_CF Analyzer Presentation Deck|CF Analyzer Presentation Deck]]
- [[_COMMUNITY_Pipeline Configuration & Data Collection|Pipeline Configuration & Data Collection]]
- [[_COMMUNITY_Attempts Estimation & Feature Engineering|Attempts Estimation & Feature Engineering]]
- [[_COMMUNITY_Backend NPM Dependencies|Backend NPM Dependencies]]
- [[_COMMUNITY_Data Preprocessing|Data Preprocessing]]
- [[_COMMUNITY_Recommendation Generation & Formatting|Recommendation Generation & Formatting]]
- [[_COMMUNITY_Research Paper Concepts|Research Paper Concepts]]
- [[_COMMUNITY_Web App Architecture Slide|Web App Architecture Slide]]
- [[_COMMUNITY_Railway Deploy Config|Railway Deploy Config]]
- [[_COMMUNITY_Codeforces API Data Collection|Codeforces API Data Collection]]
- [[_COMMUNITY_KNN Neighbor Visualization|KNN Neighbor Visualization]]
- [[_COMMUNITY_FrontendBackendAI Integration|Frontend/Backend/AI Integration]]
- [[_COMMUNITY_ML Results Dashboard|ML Results Dashboard]]
- [[_COMMUNITY_Model Baseline Comparison|Model Baseline Comparison]]
- [[_COMMUNITY_Matrix Crawl Job|Matrix Crawl Job]]
- [[_COMMUNITY_Profiling Test Suite|Profiling Test Suite]]
- [[_COMMUNITY_ML Report Export (docx)|ML Report Export (docx)]]
- [[_COMMUNITY_KNN Evaluation Metrics|KNN Evaluation Metrics]]
- [[_COMMUNITY_Attempts Model Comparison|Attempts Model Comparison]]
- [[_COMMUNITY_Rating Progression Model Comparison|Rating Progression Model Comparison]]
- [[_COMMUNITY_Dataset Overview Slide|Dataset Overview Slide]]
- [[_COMMUNITY_Three LightGBM Regressors Slide|Three LightGBM Regressors Slide]]
- [[_COMMUNITY_Crawl Setup Job|Crawl Setup Job]]
- [[_COMMUNITY_Rating Progression Inference|Rating Progression Inference]]
- [[_COMMUNITY_Handle Cleaning Utility|Handle Cleaning Utility]]
- [[_COMMUNITY_Attempts Model Training|Attempts Model Training]]
- [[_COMMUNITY_Rating Progression Model Training|Rating Progression Model Training]]
- [[_COMMUNITY_Success Model Training|Success Model Training]]
- [[_COMMUNITY_Attempts Estimator Comparison|Attempts Estimator Comparison]]
- [[_COMMUNITY_Rating Progression Comparison|Rating Progression Comparison]]
- [[_COMMUNITY_ML Results Visualization Script|ML Results Visualization Script]]
- [[_COMMUNITY_Solve-Score Confusion Matrix|Solve-Score Confusion Matrix]]
- [[_COMMUNITY_Handle Submission Boxplot (Cleaned)|Handle Submission Boxplot (Cleaned)]]
- [[_COMMUNITY_KNN Similarity Feature Slide|KNN Similarity Feature Slide]]
- [[_COMMUNITY_Recommendation Ranking Pipeline Slide|Recommendation Ranking Pipeline Slide]]
- [[_COMMUNITY_Problem Discovery  Unsolved Pool|Problem Discovery / Unsolved Pool]]
- [[_COMMUNITY_Rating Progression Prediction Module|Rating Progression Prediction Module]]
- [[_COMMUNITY_ML Dependency Pins|ML Dependency Pins]]
- [[_COMMUNITY_KNN Radar Visualization Script|KNN Radar Visualization Script]]
- [[_COMMUNITY_Kubernetes Namespace  Minikube|Kubernetes Namespace / Minikube]]
- [[_COMMUNITY_Tag Set Reference Config|Tag Set Reference Config]]
- [[_COMMUNITY_Raw Submissions CSV|Raw Submissions CSV]]
- [[_COMMUNITY_Handle Distribution Chart (Cleaned)|Handle Distribution Chart (Cleaned)]]
- [[_COMMUNITY_Handle Submission Boxplot (Outliers)|Handle Submission Boxplot (Outliers)]]
- [[_COMMUNITY_Handle Submission Cap Distribution|Handle Submission Cap Distribution]]
- [[_COMMUNITY_Problem Rating Distribution|Problem Rating Distribution]]
- [[_COMMUNITY_Problem Tag Class Imbalance|Problem Tag Class Imbalance]]
- [[_COMMUNITY_Paper Logistic Regression Failure|Paper: Logistic Regression Failure]]
- [[_COMMUNITY_Release Fetch Script|Release Fetch Script]]
- [[_COMMUNITY_Render Setup Script|Render Setup Script]]
- [[_COMMUNITY_Startup Script|Startup Script]]
- [[_COMMUNITY_Deploy Guide Doc|Deploy Guide Doc]]
- [[_COMMUNITY_Developer Documentation|Developer Documentation]]
- [[_COMMUNITY_University of Greenwich Logo|University of Greenwich Logo]]
- [[_COMMUNITY_MSA University Logo|MSA University Logo]]
- [[_COMMUNITY_CF Analyzer Project Root|CF Analyzer Project Root]]
- [[_COMMUNITY_User Profiles CSV|User Profiles CSV]]
- [[_COMMUNITY_Enriched User Profiles CSV|Enriched User Profiles CSV]]
- [[_COMMUNITY_Report Export Module|Report Export Module]]
- [[_COMMUNITY_Profiling Logger Module|Profiling Logger Module]]
- [[_COMMUNITY_Profiler Module|Profiler Module]]
- [[_COMMUNITY_Recommendation Module|Recommendation Module]]
- [[_COMMUNITY_Submissions Cleaning Module|Submissions Cleaning Module]]
- [[_COMMUNITY_User Profiles Preprocessing Module|User Profiles Preprocessing Module]]
- [[_COMMUNITY_User Tag Strengths Module|User Tag Strengths Module]]
- [[_COMMUNITY_KNN Visualization Module|KNN Visualization Module]]
- [[_COMMUNITY_ML Results Visualization Module|ML Results Visualization Module]]
- [[_COMMUNITY_Web Application Architecture|Web Application Architecture]]
- [[_COMMUNITY_Render Deploy Config|Render Deploy Config]]
- [[_COMMUNITY_NumPy Dependency Pin|NumPy Dependency Pin]]

## God Nodes (most connected - your core abstractions)
1. `DeckStage` - 57 edges
2. `PerformanceLogger` - 18 edges
3. `main()` - 17 edges
4. `analyze()` - 15 edges
5. `StageProfiler` - 13 edges
6. `ML/preprocessing/strength.py` - 11 edges
7. `CF Analyzer Presentation Deck` - 11 edges
8. `RecommendationGenerator` - 10 edges
9. `analyze()` - 9 edges
10. `main()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `GitHub Actions Weekly Crawl & Retrain Workflow` --semantically_similar_to--> `scripts/crawl_and_retrain.py`  [INFERRED] [semantically similar]
  DEPLOY.md → docker-compose.yml
- `Job cf-data-seed` --semantically_similar_to--> `Seed Initial Dataset workflow`  [INFERRED] [semantically similar]
  k8s/job-seed.yaml → .github/workflows/seed-dataset.yml
- `Weekly Crawl & Retrain workflow` --semantically_similar_to--> `CronJob cf-retrain`  [INFERRED] [semantically similar]
  .github/workflows/weekly-retrain.yml → k8s/cronjob-retrain.yaml
- `main()` --calls--> `DataCollector`  [INFERRED]
  main.py → src/pipeline/data_collection.py
- `main()` --calls--> `ModelInference`  [INFERRED]
  main.py → src/pipeline/model_inference.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three Parallel Deployment Targets (GitHub Actions, Docker/K8s, Render)** — deploy_github_actions_weekly_retrain, deploy_docker_k8s_guide, render_cf_analyzer_web_service [INFERRED 0.85]
- **tag_strength (0-1 scale) shared across strength.py, feature_engineering.py, and 29-dim model feature vector** — devdocs_strength_py, devdocs_feature_engineer_class, devdocs_shared_29dim_feature_vector [EXTRACTED 1.00]
- **Three LightGBM Models Consuming the Same Problem Pool (success, attempts, counterfactual)** — devdocs_prioritize_problems_function, devdocs_estimate_attempts_function, devdocs_compute_tag_impact_function [EXTRACTED 1.00]
- **GitHub Release as shared merge-base/output across crawl/retrain workflows** — github_workflows_weekly_retrain_merge_and_retrain_job, github_workflows_retrain_only_retrain_job, github_workflows_recover_crawl_recover_job, github_release_data_tag [INFERRED 0.85]
- **cf-data-pvc mounted at /data by both web deployment and retrain cronjob/seed job** — k8s_pvc_cf_data_pvc, k8s_deployment_web_cf_analyzer_web, k8s_cronjob_retrain_cf_retrain, k8s_job_seed_cf_data_seed [EXTRACTED 1.00]
- **Weekly retrain three-stage pipeline: setup -> parallel crawl -> merge/retrain** — github_workflows_weekly_retrain_setup_job, github_workflows_weekly_retrain_crawl_job, github_workflows_weekly_retrain_merge_and_retrain_job, chunks_artifact [EXTRACTED 1.00]
- **Model Selection Trade-off Among KNN, LightGBM, and Discarded Alternatives** — paper_paper_paper_knn_model, paper_paper_paper_lightgbm_regressor, paper_paper_paper_xgboost_alternative, paper_paper_paper_linear_regression_baseline, paper_paper_paper_logistic_regression_failed [EXTRACTED 0.90]
- **Codeforces Dataset Collection and Preprocessing Flow** — paper_paper_paper_codeforces_api, paper_paper_paper_codeforces_submission_dataset, paper_paper_paper_cf_analyzer [EXTRACTED 0.90]

## Communities (93 total, 34 thin omitted)

### Community 0 - "Main Pipeline Entry Point"
Cohesion: 0.06
Nodes (49): _compute_tag_strength_for_model(), _load_submissions_csv(), main(), DataFrame, Codeforces Performance Analyzer — Main Pipeline  1. Data Collection   - Fetch TA, Load 04_filtered_submissions.csv.      When `handles` is given, filter to those, Compute tag_strength using the exact same formula as strength.py / 06_user_tag_s, _build_matrix() (+41 more)

### Community 2 - "Performance Logging"
Cohesion: 0.05
Nodes (31): PerformanceLogger, Any, Return the current run data., Reset the current run for a new profiling session., Load and return all saved performance logs.                  Args:             l, Calculate average metrics across all runs.                  Args:             lo, Initialize the performance logger.                  Args:             log_file:, Ensure the log directory exists. (+23 more)

### Community 3 - "Full Pipeline Orchestration"
Cohesion: 0.06
Nodes (51): analyze(), build_dataset_knn_matrix(), build_knn_vector(), _build_ml_features(), build_problem_pool(), build_tag_strength_for_target(), build_target_knn_vector(), clean_dataset_handles() (+43 more)

### Community 4 - "Crawl Recovery Workflow"
Cohesion: 0.06
Nodes (43): chunks artifact (uploaded handle chunks), GitHub Release data-init (seed placeholder), GitHub Release data-YYYY-MM-DD (dataset + models), GitHub Release raw-crawl-<run_id> (safety net archive), num_chunks workflow_dispatch input, Recover Crawl (merge orphaned chunks) workflow, recover job (Archive chunks -> Merge -> Retrain -> Release), source_run_id workflow_dispatch input (+35 more)

### Community 5 - "Frontend NPM Dependencies"
Cohesion: 0.06
Nodes (28): dependencies, react, react-dom, recharts, devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks (+20 more)

### Community 6 - "Feature Vector & Counterfactual Analysis"
Cohesion: 0.06
Nodes (37): 82-dim Feature Vector Layout (4x20 + 2), Attempts Model Target Variable (wa_count+1), compute_tag_impact(), compute_target_features(), ML/inference/counterfactual_tag_impact.py, ML/dataset/06_user_tag_strengths.csv, Display Similarity Score (global-max based), estimate_attempts() (+29 more)

### Community 7 - "Codeforces Crawler"
Cohesion: 0.09
Nodes (34): Path, cf_get(), crawl_all(), fetch_user_submissions(), get_participants(), get_recent_contest_ids(), main(), merge_into_dataset() (+26 more)

### Community 8 - "Docker & Kubernetes Deployment"
Cohesion: 0.07
Nodes (34): cf-analyzer-pipeline Docker Image, cf-analyzer-web Docker Image, cf-data-pvc (Kubernetes PersistentVolumeClaim, 2Gi), cf-retrain CronJob (Kubernetes), Docker & Kubernetes Deploy Guide (local), Dockerfile.pipeline, Dockerfile.web, scripts/fetch_latest_release.sh (+26 more)

### Community 9 - "KNN Leave-One-Out Evaluation"
Cohesion: 0.12
Nodes (17): build_feature_matrix(), evaluate(), Leave-One-Out KNN Evaluation ============================= For each user in the, Build the same 82-dim matrix used in the pipeline., _compute_distances(), KNNModel, ModelInference, Any (+9 more)

### Community 10 - "CF Analyzer Presentation Deck"
Cohesion: 0.19
Nodes (22): CF Analyzer Presentation Deck, API Endpoints (cf proxy, ml analyze, coach), Codeforces API (submissions source), Counterfactual Tag Impact Analysis, Dataset: 2,877 Users / 819K Submissions, Express.js Backend, Gemini 2.5 Flash AI Coach, KNN Peer Matching (+14 more)

### Community 11 - "Pipeline Configuration & Data Collection"
Cohesion: 0.13
Nodes (12): get_config(), Configuration module for the Codeforces Performance Analyzer.  Contains paths, s, Return all configuration as a dictionary.          Returns:         Dictionary c, DataCollector, Any, Data Collection Module  Only fetches the TARGET user from the Codeforces API. Da, Fetch target user info and submissions from the API.         Dataset users are N, Convert a raw Codeforces submission dict into a flat analysis row. (+4 more)

### Community 12 - "Attempts Estimation & Feature Engineering"
Cohesion: 0.12
Nodes (19): 82-dim KNN Feature Vector, Attempts Estimation, attempts_model.pkl, src/pipeline/config.py, 06_user_tag_strengths.csv, ML/evaluation/evaluate_knn.py, src/pipeline/feature_engineering.py, Final Ranking Score (weakness_boost + difficulty_match) (+11 more)

### Community 13 - "Backend NPM Dependencies"
Cohesion: 0.11
Nodes (18): author, dependencies, cors, dotenv, express, @google/genai, @google/generative-ai, node-fetch (+10 more)

### Community 14 - "Data Preprocessing"
Cohesion: 0.16
Nodes (10): DataPreprocessor, Any, Preprocessing Module  Cleans and normalizes the raw user data collected from Cod, Preprocess the entire collected dataset.                  Args:             coll, Preprocesses raw Codeforces data., Initialize the preprocessor., Clean user data by removing/handling missing values.                  Args:, Normalize a numeric field using min-max normalization.                  Args: (+2 more)

### Community 15 - "Recommendation Generation & Formatting"
Cohesion: 0.19
Nodes (10): Any, Generate recommendation and save to file, including tag strengths and         pr, Generates final recommendations from inference results., Initialize recommendation generator.                  Args:             output_f, Format neighbors as JSON.                  Args:             inference_result: R, Format neighbors as CSV lines.                  Args:             inference_resu, Format neighbors as simple list.                  Args:             inference_re, Generate recommendation in the configured format.                  Args: (+2 more)

### Community 16 - "Research Paper Concepts"
Cohesion: 0.14
Nodes (14): 82-Dimensional Feature Space, CF-Analyzer, Class Imbalance (Data Property), Codeforces API, Codeforces Submission Dataset (800,000+ submissions, 2,877 users), Introduction (Section 1), K-Nearest Neighbors (KNN) Model, LightGBM Regressor (+6 more)

### Community 17 - "Web App Architecture Slide"
Cohesion: 0.22
Nodes (13): API endpoints: GET /api/cf/:handle, GET /api/ml/analyze/:handle, POST /api/coach, Backend: Express.js proxies CF API, spawns Python subprocess, streams to Gemini, Frontend: React 19 (Vite + TypeScript, tabs/charts/recommendation cards), ML: Python subprocess with NumPy + LightGBM (cold-load ~1s, full analysis ~5-10s), CF data and ML pipeline run in parallel via Promise.allSettled; UI degrades gracefully if ML fails, Six dashboard tabs: Overview, Tag Analysis, Ratings, Recs, Peers, AI Coach, Slide: A dashboard the model talks through, AI Coach tab: Gemini-generated 7-day personalized study plan (+5 more)

### Community 18 - "Railway Deploy Config"
Cohesion: 0.20
Nodes (9): build, buildCommand, builder, deploy, healthcheckPath, restartPolicyMaxRetries, restartPolicyType, startCommand (+1 more)

### Community 19 - "Codeforces API Data Collection"
Cohesion: 0.29
Nodes (7): GET /user.info (Codeforces API), GET /user.status (Codeforces API), DataCollector Class, DataCollector.fetch_user_info(), DataCollector.fetch_user_submissions(), _submission_to_row(), Codeforces Tag Mapping Table (raw -> internal tag_* columns)

### Community 20 - "KNN Neighbor Visualization"
Cohesion: 0.52
Nodes (6): Onion_Xiao identified as closest neighbor (distance 3.4624), KNN nearest-neighbor recommendation model (tag-strength based), Neighbor Distance Ranking: top 20 of 50 nearest users by Euclidean distance in tag-strength space, PCA of Tag Strength Space (why nearest neighbors are close, PC1 51.8% / PC2 10.6% variance), Tag Strength Heatmap: o.khalifa plus top 10 neighbors across CF tags, Tag Strength Profile: o.khalifa vs. neighbor average (radar chart)

### Community 21 - "Frontend/Backend/AI Integration"
Cohesion: 0.33
Nodes (7): website/src/App.jsx (React frontend), Codeforces API, src/pipeline/data_collection.py, Gemini 2.5 Flash API, POST /api/coach (Gemini 2.5 Flash AI Coaching), main.py Pipeline Entry Point, website/server/server.js (Express API server)

### Community 22 - "ML Results Dashboard"
Cohesion: 0.60
Nodes (6): ml_results.png — ML model results dashboard, KNN rank classification (5-fold CV, 34.3% accuracy), mo.zarad personalized recommendations (tag strength vs neighbors, problem recommendations, acceptance rate vs rating), PCA 2D clustering colored by Codeforces rank, with PC1 tag loadings, Random Forest success-rate regression (R²=0.584, MAE=0.058), Tag feature importance for success rate (math, impl, greedy dominant)

### Community 23 - "Model Baseline Comparison"
Cohesion: 0.40
Nodes (6): Attempts Estimator Prediction Task (MAE, R2 metrics), Model Baseline Comparison (LightGBM vs Linear/Logistic Regression) for Rating Progression and Attempts Estimator, LightGBM Model (winner on both tasks: MAE 53.96/R2 0.43 rating, MAE 0.88/R2 0.18 attempts), Logistic Regression as Ordinal-Proxy Regressor (bins target into 5 classes, predicts via weighted bin midpoints; fails attempts task with negative R2), Rating Progression Prediction Task (MAE, R2 metrics), Slide 10: LightGBM Beats Linear Baselines (Baselines Comparison)

### Community 24 - "Matrix Crawl Job"
Cohesion: 0.53
Nodes (5): cf_get(), fetch_user_submissions(), main(), parse_submission(), Job 2 of 3 — Matrix crawl job.  Reads chunks/chunk_N.json, fetches submissions f

### Community 25 - "Profiling Test Suite"
Cohesion: 0.60
Nodes (5): load_logs(), main(), run_command(), run_test_case(), validate_run()

### Community 26 - "ML Report Export (docx)"
Cohesion: 0.40
Nodes (3): add_kv_table(), Export ML Results Report — generates logs/ml_report.docx Includes: analysis narr, set_cell_bg()

### Community 27 - "KNN Evaluation Metrics"
Cohesion: 0.40
Nodes (5): KNN Leave-One-Out Evaluation, Spearman Correlation Metric, Tag MSE Metric, Weakness Jaccard Metric, Weakness Recall Metric

### Community 28 - "Attempts Model Comparison"
Cohesion: 0.60
Nodes (4): build_data(), compare(), evaluate(), Model Comparison — Problem Attempts Estimator ==================================

### Community 29 - "Rating Progression Model Comparison"
Cohesion: 0.60
Nodes (4): build_data(), compare(), evaluate(), Model Comparison — Rating Progression Predictor ================================

### Community 30 - "Dataset Overview Slide"
Cohesion: 0.60
Nodes (5): Dark-Themed Stat Card Dashboard UI Pattern, Dataset Overview Slide Screenshot (01-check.jpg), Codeforces Dataset Summary (2,877 users, 819K submissions, 20 tags, 82 features), User Rating Distribution by Bucket (900-2598), Algorithmic Tags Tracked (dp, greedy, graphs, math, strings, etc.)

### Community 31 - "Three LightGBM Regressors Slide"
Cohesion: 0.60
Nodes (5): LightGBM three-model regressor architecture, M1 Success model (solve_score prediction), M2 Attempts model (tries-before-AC difficulty bucketing), M3 Rating progression model (untapped rating ceiling), Slide: Three LightGBM regressors, one ranking signal

### Community 32 - "Crawl Setup Job"
Cohesion: 0.70
Nodes (4): cf_get(), get_recent_contest_ids(), main(), Job 1 of 3 — Setup job.  - Fetches rated user list - Gets all participant handle

### Community 33 - "Rating Progression Inference"
Cohesion: 0.67
Nodes (3): _load(), predict_rating_progression(), Rating Progression Predictor — inference module.  predict_rating_progression(cf_

### Community 34 - "Handle Cleaning Utility"
Cohesion: 0.50
Nodes (3): clean_handles_inplace(), DataFrame, Clean the handle column with minimal extra allocations.      Avoids the full-fra

### Community 35 - "Attempts Model Training"
Cohesion: 0.67
Nodes (3): build_training_data(), Train a LightGBM regression model to predict how many attempts a user will need, train()

### Community 36 - "Rating Progression Model Training"
Cohesion: 0.67
Nodes (3): build_training_data(), Train a LightGBM regression model to predict a user's rating growth potential., train()

### Community 37 - "Success Model Training"
Cohesion: 0.67
Nodes (3): build_training_data(), Train a LightGBM regression model to predict solve_score for a (user, problem) p, train()

### Community 38 - "Attempts Estimator Comparison"
Cohesion: 0.50
Nodes (4): Attempts Estimator Model (LightGBM), ML/evaluation/compare_attempts_models.py, Model Comparison: Attempts Estimator (LightGBM vs Linear vs Logistic), ML/training/train_attempts_model.py

### Community 39 - "Rating Progression Comparison"
Cohesion: 0.50
Nodes (4): ML/evaluation/compare_rating_progression_models.py, Model Comparison: Rating Progression (LightGBM vs Linear vs Logistic), Rating Progression Model (LightGBM), ML/training/train_rating_progression_model.py

### Community 41 - "Solve-Score Confusion Matrix"
Cohesion: 0.67
Nodes (3): Classification performance at threshold 0.5 (83.6% accuracy, high recall on Will-solve class, elevated false-positive rate on Won't-solve class), Confusion Matrix — LightGBM solve_score, LightGBM solve_score classification model

### Community 42 - "Handle Submission Boxplot (Cleaned)"
Cohesion: 1.00
Nodes (3): Boxplot of Handle Counts with Individual Points (post-cleaning), After cleaning, submission counts per handle are widely and fairly evenly spread from ~20 to ~300 (IQR ~60-230), with a long right tail and a single outlier near 480-490, indicating removal of extreme high-volume users but retention of broad activity variance, Number of submissions per user handle (cleaned dataset)

### Community 43 - "KNN Similarity Feature Slide"
Cohesion: 1.00
Nodes (3): Leave-one-out evaluation metrics (Weakness Jaccard, Weakness Recall, Tag MSE, Spearman Correlation) for KNN quality, KNN nearest-neighbor similarity search (K=50, 82-dim feature vector, pure NumPy Euclidean distance), KNN Similarity Feature Slide (06 · Similarity)

### Community 44 - "Recommendation Ranking Pipeline Slide"
Cohesion: 1.00
Nodes (3): Candidate Pool to Ranked List Pipeline (weakness_boost + final_score), Sample Recommendation Card UI (Two Heaps and a Bridge, 1900 rating), Recommendation Ranking Slide Screenshot (04-check.jpg)

### Community 45 - "Problem Discovery / Unsolved Pool"
Cohesion: 0.67
Nodes (3): 04_filtered_submissions.csv, ML/inference/find_unsolved_problems.py, Problem Discovery / Pool Builder

### Community 46 - "Rating Progression Prediction Module"
Cohesion: 0.67
Nodes (3): ML/inference/predict_rating_progression.py, rating_progression_model.pkl, Rating Progression Prediction

### Community 47 - "ML Dependency Pins"
Cohesion: 0.67
Nodes (3): lightgbm~=4.6, scripts/merge_and_retrain.py, scikit-learn~=1.8

## Ambiguous Edges - Review These
- `cf-retrain CronJob (Kubernetes)` → `cf-analyzer Render Web Service`  [AMBIGUOUS]
  render.yaml · relation: conceptually_related_to

## Knowledge Gaps
- **162 isolated node(s):** `$schema`, `builder`, `buildCommand`, `startCommand`, `healthcheckPath` (+157 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **34 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `cf-retrain CronJob (Kubernetes)` and `cf-analyzer Render Web Service`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `main()` connect `Main Pipeline Entry Point` to `KNN Leave-One-Out Evaluation`, `Performance Logging`, `Pipeline Configuration & Data Collection`, `Recommendation Generation & Formatting`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `PerformanceLogger` connect `Performance Logging` to `Main Pipeline Entry Point`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `StageProfiler` connect `Performance Logging` to `Main Pipeline Entry Point`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `PerformanceLogger` (e.g. with `main()` and `Profiler`) actually correct?**
  _`PerformanceLogger` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `main()` (e.g. with `DataCollector` and `compute_target_features()`) actually correct?**
  _`main()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `StageProfiler` (e.g. with `main()` and `PerformanceLogger`) actually correct?**
  _`StageProfiler` has 2 INFERRED edges - model-reasoned connections that need verification._