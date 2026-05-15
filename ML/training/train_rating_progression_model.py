"""
Train a LightGBM regression model to predict a user's rating growth potential.

Target: cf_max_rating - cf_rating  (untapped rating potential, >= 0)

Interpretation:
  High value → user has peaked well above their current rating and has room to recover/grow
  Low value  → user is near their historical peak, little headroom left

Features come from two sources:
  - 02_user_profiles.csv  : contest behavior, submission patterns, activity
  - 06_user_tag_strengths.csv : per-tag tag_strength (pivoted to 20 columns)

The model is used at inference time to:
  1. Predict the user's potential rating ceiling
  2. Rank which weak tags, if improved, contribute most to that ceiling
     (via SHAP feature importances on the tag_strength columns)
"""

import os
import pickle
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

DATASET_DIR = os.path.join(os.path.dirname(__file__), "..", "dataset")
MODEL_PATH  = os.path.join(os.path.dirname(__file__), "..", "models", "rating_progression_model.pkl")

TAG_COLS = [
    "tag_dp", "tag_greedy", "tag_graphs", "tag_math", "tag_strings",
    "tag_impl", "tag_binary_search", "tag_data_structures", "tag_number_theory",
    "tag_combinatorics", "tag_geometry", "tag_trees", "tag_sortings",
    "tag_two_pointers", "tag_bitmasks", "tag_flows", "tag_fft",
    "tag_games", "tag_probabilities", "tag_constructive",
]

PROFILE_FEATURE_COLS = [
    "cf_rating",
    "total_contests",
    "contests_per_year",
    "first_try_rate",
    "avg_attempts_to_ac",
    "unique_problems_solved",
    "unique_problems_tried",
    "solved_lte_1000",
    "solved_1001_1500",
    "solved_1501_2000",
    "solved_2001_2500",
    "solved_2501_3000",
    "solved_gt_3000",
    "practice_sub_ratio",
    "contest_sub_ratio",
    "subs_per_active_day",
    "tag_coverage_pct",
    "unique_tags_solved",
]

STRENGTH_COLS = [f"strength_{t}" for t in TAG_COLS]


def build_training_data():
    print("Loading datasets...")
    profiles = pd.read_csv(os.path.join(DATASET_DIR, "02_user_profiles.csv"))
    enriched = pd.read_csv(os.path.join(DATASET_DIR, "07_enriched_user_profiles.csv"))
    strengths = pd.read_csv(os.path.join(DATASET_DIR, "06_user_tag_strengths.csv"))

    # Pivot tag_strength: handle × tag → value
    strength_pivot = (
        strengths.pivot_table(index="handle", columns="tag", values="tag_strength")
        .reindex(columns=TAG_COLS)
        .fillna(0.0)
    )
    strength_pivot.columns = STRENGTH_COLS

    # Target: rating growth potential — deduplicate handles first
    profiles = profiles.drop_duplicates(subset="handle").set_index("handle")
    target = (profiles["cf_max_rating"] - profiles["cf_rating"]).clip(lower=0)

    # Profile features
    profile_feats = profiles[PROFILE_FEATURE_COLS].copy()

    combined = profile_feats.join(strength_pivot, how="inner")
    y_series = target.reindex(combined.index).dropna()
    combined = combined.loc[y_series.index]

    feature_names = PROFILE_FEATURE_COLS + STRENGTH_COLS
    X = combined[feature_names].fillna(0.0).astype(np.float32)
    y = y_series.values.astype(np.float32)

    print(f"Dataset: {X.shape[0]:,} users, {X.shape[1]} features")
    print(f"Target (rating potential) stats:")
    print(f"  mean={y.mean():.1f}  median={np.median(y):.1f}  "
          f"max={y.max():.0f}  >200: {(y>200).sum()} users")
    return X, y, feature_names


def train():
    X, y, feature_names = build_training_data()

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    print("\nTraining LightGBM regressor...")
    model = lgb.LGBMRegressor(
        n_estimators=600,
        learning_rate=0.03,
        num_leaves=31,
        max_depth=-1,
        min_child_samples=30,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=0.1,
        random_state=42,
        n_jobs=-1,
        verbose=-1,
    )
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(100)],
    )

    y_pred = model.predict(X_test).clip(0)

    mae = mean_absolute_error(y_test, y_pred)
    mse = mean_squared_error(y_test, y_pred)
    r2  = r2_score(y_test, y_pred)

    print(f"\nRegression Evaluation:")
    print(f"  MAE : {mae:.2f} rating points")
    print(f"  RMSE: {np.sqrt(mse):.2f} rating points")
    print(f"  R²  : {r2:.4f}")

    # Rating-band breakdown
    print(f"\nMAE by current rating band:")
    test_ratings = X_test["cf_rating"].values
    for lo, hi in [(900, 1200), (1200, 1600), (1600, 2000), (2000, 2600)]:
        mask = (test_ratings >= lo) & (test_ratings < hi)
        if mask.sum() > 0:
            band_mae = mean_absolute_error(y_test[mask], y_pred[mask])
            print(f"  {lo}–{hi}: MAE={band_mae:.1f}  (n={mask.sum()})")

    print(f"\nTop 15 most important features:")
    importances = sorted(
        zip(feature_names, model.feature_importances_),
        key=lambda x: x[1], reverse=True,
    )
    for name, imp in importances[:15]:
        print(f"  {name:<35} {imp:>6}")

    payload = {
        "model":         model,
        "feature_names": feature_names,
        "tag_cols":      TAG_COLS,
        "strength_cols": STRENGTH_COLS,
        "profile_cols":  PROFILE_FEATURE_COLS,
        "type":          "rating_progression_regressor",
    }
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(payload, f)
    print(f"\nSaved to {MODEL_PATH}")


if __name__ == "__main__":
    train()
