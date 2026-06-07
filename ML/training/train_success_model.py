"""
Train a LightGBM regression model to predict solve_score for a (user, problem) pair.

solve_score formula (per problem attempt group):
  wa_count   = total wrong-answer submissions for this (handle, problem)
  ever_ac    = 1 if the user ever accepted it, else 0
  solve_score = ever_ac - wa_count * WA_PENALTY
  clipped to [-1, 1]

  Examples (WA_PENALTY=0.2):
    Solved, 0 WA  →  1.0   (clean solve)
    Solved, 2 WA  →  0.6   (moderate)
    Solved, 5 WA  →  0.0   (struggled but got it)
    Solved, 7 WA  → -0.4   (treated as failure)
    Not solved, 3 WA → -0.6 (clear failure)

Features (29 total):
  rating_diff, rating_diff_sq, cf_rating,
  mean_tag_strength, tag_strength_min, tag_strength_max,
  tag_coverage, num_solved, problem_tag_count,
  tag_dp ... tag_constructive (20 binary)

Target: solve_score ∈ [-1, 1]  (regression)

Saves model to ML/success_model.pkl
"""

import os
import pickle
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    roc_auc_score, f1_score, confusion_matrix,
    mean_absolute_error, mean_squared_error, r2_score,
)

DATASET_DIR = os.path.join(os.path.dirname(__file__), "..", "dataset")
MODEL_PATH  = os.path.join(os.path.dirname(__file__), "..", "models", "success_model.pkl")

WA_PENALTY = 0.2

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


def build_training_data():
    print("Loading datasets...")
    # Read int flags as float32 (tolerates NA from any schema drift), then fill
    # and downcast — forcing int8 at read raises "Integer column has NA values".
    _int_cols = ['is_ac', 'is_wa'] + TAG_COLS
    _subs_dtypes = {'handle': str, 'problem_id': str, 'problem_rating': 'float32',
                    **dict.fromkeys(_int_cols, 'float32')}
    subs      = pd.read_csv(os.path.join(DATASET_DIR, "04_filtered_submissions.csv"),
                            usecols=list(_subs_dtypes), dtype=_subs_dtypes)
    subs[_int_cols] = subs[_int_cols].fillna(0).astype('int8')
    # Categorical encoding collapses the per-row handle/problem_id string
    # overhead (the dominant memory cost at 8M rows) to small int codes.
    subs["handle"]     = subs["handle"].astype("category")
    subs["problem_id"] = subs["problem_id"].astype("category")
    strengths = pd.read_csv(os.path.join(DATASET_DIR, "06_user_tag_strengths.csv"))
    profiles  = pd.read_csv(os.path.join(DATASET_DIR, "02_user_profiles.csv"))

    strength_pivot = strengths.pivot_table(
        index="handle", columns="tag", values="tag_strength"
    ).reindex(columns=TAG_COLS).fillna(0.0)

    user_rating = profiles.set_index("handle")["cf_rating"].to_dict()

    print("Aggregating submissions to one row per (handle, problem)...")
    # observed=True is essential with categorical keys — the default would emit
    # a row per (handle × problem_id) combination, exploding to tens of millions.
    per_prob = (
        subs.groupby(["handle", "problem_id"], sort=False, observed=True)
            .agg(
                ever_ac        = ("is_ac", "max"),
                wa_count       = ("is_wa", "sum"),
                problem_rating = ("problem_rating", "first"),
                **{t: (t, "first") for t in TAG_COLS},
            )
            .reset_index()
    )
    del subs  # large frame no longer needed
    # per_prob is now one row per (handle, problem) — small enough to drop the
    # categorical dtype, avoiding observed=False surprises in later groupbys.
    per_prob["handle"]     = per_prob["handle"].astype(str)
    per_prob["problem_id"] = per_prob["problem_id"].astype(str)
    per_prob = per_prob[per_prob["problem_rating"] > 0].copy()
    per_prob = per_prob[per_prob["handle"].isin(strength_pivot.index)]

    per_prob["solve_score"] = (
        per_prob["ever_ac"] - per_prob["wa_count"] * WA_PENALTY
    ).clip(-1.0, 1.0)

    solved_counts = (
        per_prob[per_prob["ever_ac"] == 1]
        .groupby("handle")["problem_id"].nunique()
        .to_dict()
    )

    score_dist = per_prob["solve_score"]
    print("solve_score distribution:")
    for lo, hi in [(-1.0, 0.0), (0.0, 0.5), (0.5, 0.9), (0.9, 1.01)]:
        pct = ((score_dist >= lo) & (score_dist < hi)).mean() * 100
        print(f"  [{lo:.1f}, {hi:.1f}): {pct:.1f}%")

    print(f"Building feature matrix from {len(per_prob):,} rows...")

    handles     = per_prob["handle"].values
    ratings     = per_prob["problem_rating"].values.astype(np.float32)
    tags_matrix = per_prob[TAG_COLS].values.astype(np.float32)

    cf_ratings     = np.array([user_rating.get(h, 1200) for h in handles], dtype=np.float32)
    rating_diff    = ratings - cf_ratings
    rating_diff_sq = rating_diff ** 2

    user_strengths = strength_pivot.loc[handles].values.astype(np.float32)
    active_mask    = tags_matrix.astype(bool)
    tag_count      = active_mask.sum(axis=1).clip(min=1)

    mean_tag_strength = (user_strengths * active_mask).sum(axis=1) / tag_count
    tag_strength_min  = np.where(active_mask, user_strengths,  np.inf).min(axis=1)
    tag_strength_max  = np.where(active_mask, user_strengths, -np.inf).max(axis=1)
    tag_strength_min  = np.where(tag_count > 0, tag_strength_min, 0.0)
    tag_strength_max  = np.where(tag_count > 0, tag_strength_max, 0.0)

    tag_coverage      = tag_count / len(TAG_COLS)
    problem_tag_count = tag_count
    num_solved        = np.array([solved_counts.get(h, 0) for h in handles], dtype=np.float32)

    X = pd.DataFrame(np.column_stack([
        rating_diff, rating_diff_sq, cf_ratings,
        mean_tag_strength, tag_strength_min, tag_strength_max,
        tag_coverage, num_solved, problem_tag_count,
        tags_matrix,
    ]).astype(np.float32), columns=FEATURE_NAMES)

    y = per_prob["solve_score"].values.astype(np.float32)
    return X, y


def train():
    X, y = build_training_data()
    print(f"\nDataset: {X.shape[0]:,} samples, {X.shape[1]} features")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    print("Training LightGBM regressor...")
    model = lgb.LGBMRegressor(
        n_estimators=500,
        learning_rate=0.05,
        num_leaves=63,
        max_depth=-1,
        min_child_samples=50,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        n_jobs=-1,
        verbose=-1,
    )
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(100)],
    )

    y_pred_score = model.predict(X_test)

    mae  = mean_absolute_error(y_test, y_pred_score)
    mse  = mean_squared_error(y_test, y_pred_score)
    r2   = r2_score(y_test, y_pred_score)

    print(f"\nRegression Evaluation:")
    print(f"  MAE  : {mae:.4f}")
    print(f"  MSE  : {mse:.4f}")
    print(f"  R²   : {r2:.4f}")

    THRESHOLD = 0.5
    y_true_bin = (y_test >= THRESHOLD).astype(int)
    y_pred_bin = (y_pred_score >= THRESHOLD).astype(int)

    auc = roc_auc_score(y_true_bin, y_pred_score)
    f1  = f1_score(y_true_bin, y_pred_bin)
    cm  = confusion_matrix(y_true_bin, y_pred_bin)

    print(f"\nClassification Evaluation (threshold = {THRESHOLD})")
    print(f"  AUC-ROC : {auc:.4f}")
    print(f"  F1 Score: {f1:.4f}")
    print(f"\nConfusion Matrix:")
    print(f"                Predicted 0   Predicted 1")
    print(f"  Actual 0    {cm[0][0]:>10,}  {cm[0][1]:>12,}")
    print(f"  Actual 1    {cm[1][0]:>10,}  {cm[1][1]:>12,}")

    print("\nTop 10 most important features:")
    importances = sorted(zip(FEATURE_NAMES, model.feature_importances_),
                         key=lambda x: x[1], reverse=True)
    for name, imp in importances[:10]:
        print(f"  {name:<25} {imp:>6}")

    payload = {"model": model, "scaler": None, "wa_penalty": WA_PENALTY, "type": "regressor"}
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(payload, f)
    print(f"\nSaved to {MODEL_PATH}")


if __name__ == "__main__":
    train()
