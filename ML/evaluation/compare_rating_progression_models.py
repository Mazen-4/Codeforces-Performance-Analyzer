"""
Model Comparison — Rating Progression Predictor
================================================
Compares three regressors on the same train/test split:
  1. LightGBM Regressor  (current model)
  2. Linear Regression
  3. Logistic Regression  (used as ordinal-proxy regressor via predict_proba × bins)

Target  : cf_max_rating - cf_rating  (rating growth potential, >= 0)
Features: 38-dim (18 profile signals + 20 tag strengths)

Metrics reported per model:
  MAE  — mean absolute error (rating points)
  RMSE — root mean squared error
  R²   — coefficient of determination
  MAE by rating band (900–1200, 1200–1600, 1600–2000, 2000–2600)

Note on Logistic Regression:
  Logistic regression is a classifier, not a regressor. To use it here we
  bucket the target into 5 equal-width bins, train a multi-class classifier,
  then predict the bin mid-point as the numeric output. This gives a fair
  "what if we treated this as classification" baseline, at the cost of
  quantisation error from the binning.
"""

import os
import sys
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import lightgbm as lgb

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

DATASET_DIR = os.path.join(os.path.dirname(__file__), "..", "dataset")

TAG_COLS = [
    "tag_dp", "tag_greedy", "tag_graphs", "tag_math", "tag_strings",
    "tag_impl", "tag_binary_search", "tag_data_structures", "tag_number_theory",
    "tag_combinatorics", "tag_geometry", "tag_trees", "tag_sortings",
    "tag_two_pointers", "tag_bitmasks", "tag_flows", "tag_fft",
    "tag_games", "tag_probabilities", "tag_constructive",
]
STRENGTH_COLS = [f"strength_{t}" for t in TAG_COLS]

PROFILE_FEATURE_COLS = [
    "cf_rating", "total_contests", "contests_per_year",
    "first_try_rate", "avg_attempts_to_ac",
    "unique_problems_solved", "unique_problems_tried",
    "solved_lte_1000", "solved_1001_1500", "solved_1501_2000",
    "solved_2001_2500", "solved_2501_3000", "solved_gt_3000",
    "practice_sub_ratio", "contest_sub_ratio", "subs_per_active_day",
    "tag_coverage_pct", "unique_tags_solved",
]

N_BINS = 5  # bins for logistic regression proxy


def build_data():
    profiles  = pd.read_csv(os.path.join(DATASET_DIR, "02_user_profiles.csv"))
    strengths = pd.read_csv(os.path.join(DATASET_DIR, "06_user_tag_strengths.csv"))

    strength_pivot = (
        strengths.pivot_table(index="handle", columns="tag", values="tag_strength")
        .reindex(columns=TAG_COLS).fillna(0.0)
    )
    strength_pivot.columns = STRENGTH_COLS

    profiles  = profiles.drop_duplicates(subset="handle").set_index("handle")
    target    = (profiles["cf_max_rating"] - profiles["cf_rating"]).clip(lower=0)
    combined  = profiles[PROFILE_FEATURE_COLS].join(strength_pivot, how="inner")
    y_series  = target.reindex(combined.index).dropna()
    combined  = combined.loc[y_series.index]

    feature_names = PROFILE_FEATURE_COLS + STRENGTH_COLS
    X = combined[feature_names].fillna(0.0).astype(np.float32)
    y = y_series.values.astype(np.float32)
    return X, y, feature_names


def evaluate(name, y_test, y_pred, test_ratings):
    mae  = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    r2   = r2_score(y_test, y_pred)
    bands = {}
    for lo, hi in [(900, 1200), (1200, 1600), (1600, 2000), (2000, 2600)]:
        mask = (test_ratings >= lo) & (test_ratings < hi)
        if mask.sum() > 0:
            bands[f"{lo}–{hi}"] = round(mean_absolute_error(y_test[mask], y_pred[mask]), 1)
    return {"model": name, "MAE": round(mae, 2), "RMSE": round(rmse, 2), "R²": round(r2, 4), "bands": bands}


def compare():
    print("Loading data...")
    X, y, feature_names = build_data()
    print(f"Dataset: {X.shape[0]:,} users, {X.shape[1]} features\n")

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    test_ratings = X_test["cf_rating"].values

    results = []

    # ── 1. LightGBM ──────────────────────────────────────────────────────────
    print("Training LightGBM Regressor...")
    lgbm = lgb.LGBMRegressor(
        n_estimators=600, learning_rate=0.03, num_leaves=31,
        min_child_samples=30, subsample=0.8, colsample_bytree=0.8,
        reg_alpha=0.1, reg_lambda=0.1, random_state=42, n_jobs=-1, verbose=-1,
    )
    lgbm.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(0)],
    )
    results.append(evaluate("LightGBM", y_test, lgbm.predict(X_test).clip(0), test_ratings))

    # Scale features for linear models
    scaler  = StandardScaler()
    Xtr_sc  = scaler.fit_transform(X_train)
    Xte_sc  = scaler.transform(X_test)

    # ── 2. Linear Regression ─────────────────────────────────────────────────
    print("Training Linear Regression...")
    lr = LinearRegression()
    lr.fit(Xtr_sc, y_train)
    results.append(evaluate("Linear Regression", y_test, lr.predict(Xte_sc).clip(0), test_ratings))

    # ── 3. Logistic Regression (ordinal proxy) ────────────────────────────────
    print("Training Logistic Regression (ordinal proxy)...")
    bin_edges   = np.percentile(y_train, np.linspace(0, 100, N_BINS + 1))
    bin_edges[0]  -= 1e-6
    bin_edges[-1] += 1e-6
    bin_mids    = [(bin_edges[i] + bin_edges[i + 1]) / 2 for i in range(N_BINS)]
    y_train_bin = np.digitize(y_train, bin_edges[1:-1])  # classes 0..N_BINS-1

    logreg = LogisticRegression(max_iter=1000, C=1.0, solver="lbfgs", random_state=42)
    logreg.fit(Xtr_sc, y_train_bin)
    proba      = logreg.predict_proba(Xte_sc)           # (n, n_classes_seen)
    # Map each class seen by the model to its bin midpoint
    mids_seen  = np.array([bin_mids[c] for c in logreg.classes_])
    y_pred_log = proba @ mids_seen
    results.append(evaluate("Logistic Regression*", y_test, y_pred_log.clip(0), test_ratings))

    # ── Print comparison table ────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"Model Comparison — Rating Progression Predictor")
    print(f"{'='*70}")
    hdr = f"{'Model':<26} {'MAE':>8} {'RMSE':>8} {'R²':>8}"
    print(hdr)
    print("-" * 52)
    for r in results:
        marker = " ◀ best" if r["R²"] == max(x["R²"] for x in results) else ""
        print(f"  {r['model']:<24} {r['MAE']:>8.2f} {r['RMSE']:>8.2f} {r['R²']:>8.4f}{marker}")

    print(f"\nMAE by rating band:")
    band_keys = list(results[0]["bands"].keys())
    print(f"  {'Model':<24}", end="")
    for b in band_keys:
        print(f"  {b:>10}", end="")
    print()
    print("  " + "-" * (24 + 12 * len(band_keys)))
    for r in results:
        print(f"  {r['model']:<24}", end="")
        for b in band_keys:
            print(f"  {r['bands'].get(b, '—'):>10}", end="")
        print()

    print(f"\n* Logistic Regression used as ordinal-proxy regressor:")
    print(f"  Target binned into {N_BINS} equal-frequency classes,")
    print(f"  prediction = weighted average of bin midpoints via predict_proba.")
    print(f"{'='*70}")


if __name__ == "__main__":
    compare()
