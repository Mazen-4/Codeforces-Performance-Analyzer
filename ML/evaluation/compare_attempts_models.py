"""
Model Comparison — Problem Attempts Estimator
=============================================
Compares three regressors on the same train/test split:
  1. LightGBM Regressor  (current model)
  2. Linear Regression
  3. Logistic Regression  (ordinal-proxy regressor via predict_proba × bins)

Target  : attempts = wa_count + 1, clipped to [1, 10]
          (number of submissions before AC, solved problems only)
Features: 29-dim (same feature vector as the success model)

Metrics reported per model:
  MAE  — mean absolute error (attempts)
  RMSE — root mean squared error
  R²   — coefficient of determination
  Calibration: mean predicted per actual-attempts bucket (1–5)
  MAE by rating band

Note on Logistic Regression:
  Attempts is a discrete ordered variable (1, 2, 3, …). We bucket into
  N_BINS equal-frequency classes, train a multi-class classifier, then
  recover a continuous prediction via weighted bin midpoints. This is
  the same ordinal-proxy approach used in the rating progression comparison.
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

DATASET_DIR      = os.path.join(os.path.dirname(__file__), "..", "dataset")
MAX_ATTEMPTS_CLIP = 10

TAG_COLS = [
    "tag_dp", "tag_greedy", "tag_graphs", "tag_math", "tag_strings",
    "tag_impl", "tag_binary_search", "tag_data_structures", "tag_number_theory",
    "tag_combinatorics", "tag_geometry", "tag_trees", "tag_sortings",
    "tag_two_pointers", "tag_bitmasks", "tag_flows", "tag_fft",
    "tag_games", "tag_probabilities", "tag_constructive",
]

FEATURE_NAMES = [
    "rating_diff", "rating_diff_sq", "cf_rating",
    "mean_tag_strength", "tag_strength_min", "tag_strength_max",
    "tag_coverage", "num_solved", "problem_tag_count",
] + TAG_COLS

N_BINS = 5


def build_data():
    subs      = pd.read_csv(os.path.join(DATASET_DIR, "04_filtered_submissions.csv"))
    strengths = pd.read_csv(os.path.join(DATASET_DIR, "06_user_tag_strengths.csv"))
    profiles  = pd.read_csv(os.path.join(DATASET_DIR, "02_user_profiles.csv"))

    strength_pivot = (
        strengths.pivot_table(index="handle", columns="tag", values="tag_strength")
        .reindex(columns=TAG_COLS).fillna(0.0)
    )
    user_rating = profiles.drop_duplicates("handle").set_index("handle")["cf_rating"].to_dict()

    per_prob = (
        subs.groupby(["handle", "problem_id"], sort=False)
            .agg(
                ever_ac        = ("is_ac",  "max"),
                wa_count       = ("is_wa",  "sum"),
                problem_rating = ("problem_rating", "first"),
                **{t: (t, "first") for t in TAG_COLS},
            )
            .reset_index()
    )
    per_prob = per_prob[per_prob["problem_rating"] > 0].copy()
    per_prob = per_prob[per_prob["ever_ac"] == 1].copy()
    per_prob = per_prob[per_prob["handle"].isin(strength_pivot.index)].copy()
    per_prob["attempts"] = (per_prob["wa_count"] + 1).clip(upper=MAX_ATTEMPTS_CLIP)

    solved_counts = per_prob.groupby("handle")["problem_id"].nunique().to_dict()

    handles     = per_prob["handle"].values
    ratings     = per_prob["problem_rating"].values.astype(np.float32)
    tags_matrix = per_prob[TAG_COLS].values.astype(np.float32)
    cf_ratings  = np.array([user_rating.get(h, 1200) for h in handles], dtype=np.float32)

    rating_diff    = ratings - cf_ratings
    rating_diff_sq = rating_diff ** 2

    user_strengths = strength_pivot.loc[handles].values.astype(np.float32)
    active_mask    = tags_matrix.astype(bool)
    tag_count      = active_mask.sum(axis=1).clip(min=1)

    mean_ts = (user_strengths * active_mask).sum(axis=1) / tag_count
    min_ts  = np.where(active_mask, user_strengths,  np.inf).min(axis=1)
    max_ts  = np.where(active_mask, user_strengths, -np.inf).max(axis=1)
    min_ts  = np.where(tag_count > 0, min_ts, 0.0)
    max_ts  = np.where(tag_count > 0, max_ts, 0.0)

    tag_coverage      = tag_count / len(TAG_COLS)
    problem_tag_count = tag_count
    num_solved        = np.array([solved_counts.get(h, 0) for h in handles], dtype=np.float32)

    min_ts = np.where(np.isinf(min_ts), 0.0, min_ts)
    max_ts = np.where(np.isinf(max_ts), 0.0, max_ts)

    X = pd.DataFrame(np.column_stack([
        rating_diff, rating_diff_sq, cf_ratings,
        mean_ts, min_ts, max_ts,
        tag_coverage, num_solved, problem_tag_count,
        tags_matrix,
    ]).astype(np.float32), columns=FEATURE_NAMES)

    y = per_prob["attempts"].values.astype(np.float32)
    return X, y


def evaluate(name, y_test, y_pred, test_ratings):
    mae  = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    r2   = r2_score(y_test, y_pred)

    calib = {}
    for v in range(1, 6):
        mask = y_test == v
        if mask.sum() > 10:
            calib[v] = round(float(y_pred[mask].mean()), 2)

    bands = {}
    for lo, hi in [(900, 1200), (1200, 1600), (1600, 2000), (2000, 2600)]:
        mask = (test_ratings >= lo) & (test_ratings < hi)
        if mask.sum() > 0:
            bands[f"{lo}–{hi}"] = round(mean_absolute_error(y_test[mask], y_pred[mask]), 3)

    return {"model": name, "MAE": round(mae, 4), "RMSE": round(rmse, 4), "R²": round(r2, 4),
            "calib": calib, "bands": bands}


def compare():
    print("Loading data...")
    X, y = build_data()
    print(f"Dataset: {X.shape[0]:,} solved problems, {X.shape[1]} features\n")

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    test_ratings = X_test["cf_rating"].values

    results = []

    # ── 1. LightGBM ──────────────────────────────────────────────────────────
    print("Training LightGBM Regressor...")
    lgbm = lgb.LGBMRegressor(
        n_estimators=500, learning_rate=0.05, num_leaves=63,
        min_child_samples=50, subsample=0.8, colsample_bytree=0.8,
        random_state=42, n_jobs=-1, verbose=-1,
    )
    lgbm.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(0)],
    )
    results.append(evaluate("LightGBM", y_test,
                             lgbm.predict(X_test).clip(1, MAX_ATTEMPTS_CLIP), test_ratings))

    scaler = StandardScaler()
    Xtr_sc = scaler.fit_transform(X_train)
    Xte_sc = scaler.transform(X_test)

    # ── 2. Linear Regression ─────────────────────────────────────────────────
    print("Training Linear Regression...")
    lr = LinearRegression()
    lr.fit(Xtr_sc, y_train)
    results.append(evaluate("Linear Regression", y_test,
                             lr.predict(Xte_sc).clip(1, MAX_ATTEMPTS_CLIP), test_ratings))

    # ── 3. Logistic Regression (ordinal proxy) ────────────────────────────────
    print("Training Logistic Regression (ordinal proxy)...")
    bin_edges     = np.percentile(y_train, np.linspace(0, 100, N_BINS + 1))
    bin_edges[0]  -= 1e-6
    bin_edges[-1] += 1e-6
    bin_mids      = [(bin_edges[i] + bin_edges[i + 1]) / 2 for i in range(N_BINS)]
    y_train_bin   = np.digitize(y_train, bin_edges[1:-1])

    logreg = LogisticRegression(max_iter=1000, C=1.0, solver="lbfgs", random_state=42)
    logreg.fit(Xtr_sc, y_train_bin)
    proba      = logreg.predict_proba(Xte_sc)
    mids_seen  = np.array([bin_mids[c] for c in logreg.classes_])
    y_pred_log = (proba @ mids_seen).clip(1, MAX_ATTEMPTS_CLIP)
    results.append(evaluate("Logistic Regression*", y_test, y_pred_log, test_ratings))

    # ── Print comparison table ────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"Model Comparison — Attempts Estimator")
    print(f"{'='*70}")
    print(f"  {'Model':<26} {'MAE':>8} {'RMSE':>8} {'R²':>8}")
    print("  " + "-" * 52)
    for r in results:
        marker = " ◀ best" if r["R²"] == max(x["R²"] for x in results) else ""
        print(f"  {r['model']:<26} {r['MAE']:>8.4f} {r['RMSE']:>8.4f} {r['R²']:>8.4f}{marker}")

    print(f"\nCalibration (mean predicted vs actual attempts):")
    print(f"  {'Model':<26}", end="")
    for v in range(1, 6):
        print(f"  actual={v}", end="")
    print()
    print("  " + "-" * (26 + 9 * 5))
    for r in results:
        print(f"  {r['model']:<26}", end="")
        for v in range(1, 6):
            val = r["calib"].get(v, "—")
            print(f"  {str(val):>7}", end="")
        print()

    print(f"\nMAE by rating band:")
    band_keys = list(results[0]["bands"].keys())
    print(f"  {'Model':<26}", end="")
    for b in band_keys:
        print(f"  {b:>10}", end="")
    print()
    print("  " + "-" * (26 + 12 * len(band_keys)))
    for r in results:
        print(f"  {r['model']:<26}", end="")
        for b in band_keys:
            print(f"  {str(r['bands'].get(b, '—')):>10}", end="")
        print()

    print(f"\n* Logistic Regression used as ordinal-proxy regressor:")
    print(f"  Target binned into {N_BINS} equal-frequency classes,")
    print(f"  prediction = weighted average of bin midpoints via predict_proba.")
    print(f"{'='*70}")


if __name__ == "__main__":
    compare()
