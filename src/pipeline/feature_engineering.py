"""
Feature Engineering Module

Feature vector layout (82 dims total):
  - 4 tag-level features × 20 tags = 80 dims
      [acceptance_rate, difficulty_score, specialization_score, volume_score] per tag
  - 2 user-level features appended once = 2 dims
      [rating_boost, efficiency_score]

rating_boost and efficiency_score are user-level constants — repeating them 20×
inflates distances without adding information, so they appear once at the end.

Dataset users: loaded from 06_user_tag_strengths.csv (no computation needed).
Target user:   computed live from API submissions using the same formula as
               ML/PreProcessing/strength.py.
"""

from typing import Dict, Any, List, Optional
import sys
import os
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

TAG_COLS = [
    "tag_dp", "tag_greedy", "tag_graphs", "tag_math", "tag_strings",
    "tag_impl", "tag_binary_search", "tag_data_structures", "tag_number_theory",
    "tag_combinatorics", "tag_geometry", "tag_trees", "tag_sortings",
    "tag_two_pointers", "tag_bitmasks", "tag_flows", "tag_fft",
    "tag_games", "tag_probabilities", "tag_constructive",
]

# Per-tag features (vary per tag)
TAG_FEATURE_COLS = [
    "acceptance_rate",
    "difficulty_score",
    "specialization_score",
    "volume_score",
]

# User-level features (constant across tags — included once)
USER_FEATURE_COLS = [
    "rating_boost",
    "efficiency_score",
]

FEATURE_DIM = len(TAG_COLS) * len(TAG_FEATURE_COLS) + len(USER_FEATURE_COLS)  # 82

MAX_RATING = 3500
SMOOTHING  = 2

TAG_STRENGTHS_CSV = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "ML", "dataset", "06_user_tag_strengths.csv",
)


def compute_target_features(
    submission_rows: List[Dict[str, Any]],
    cf_rating: int,
    cf_max_rating: int,
) -> np.ndarray:
    """
    Compute the 82-dim feature vector for the target user from their live submissions.
    Mirrors the strength.py formula exactly.
    """
    rating_boost = min((cf_rating + cf_max_rating) / (2 * MAX_RATING), 1.0)

    if not submission_rows:
        return np.array([0.0] * FEATURE_DIM, dtype=np.float32)

    df = pd.DataFrame(submission_rows)

    # Collapse to one row per distinct problem (mirrors strength.py submissions_to_per_problem)
    agg_dict = {"is_ac": "max", "problem_rating": "first"}
    for t in TAG_COLS:
        if t in df.columns:
            agg_dict[t] = "first"
    per_prob = (
        df.groupby("problem_id", sort=False)
          .agg(agg_dict)
          .rename(columns={"is_ac": "ever_ac"})
          .reset_index()
    )
    per_prob = per_prob[per_prob["problem_rating"] > 0]

    total_ac = int(per_prob["ever_ac"].sum())

    # first_try_rate: fraction of distinct problems where first submission was AC
    first_attempts = df.sort_values("problem_id").groupby("problem_id").first()
    first_try_rate   = float(first_attempts["is_ac"].mean()) if len(first_attempts) else 0.0
    efficiency_score = min(first_try_rate, 1.0)

    # Global stats for unattempted-tag fallback
    ac_per_prob = per_prob[per_prob["ever_ac"] == 1]
    global_acceptance = min(
        (total_ac + SMOOTHING * 0.5) / (len(per_prob) + SMOOTHING), 1.0
    )
    global_difficulty = min(
        float(ac_per_prob["problem_rating"].mean() or 0) / MAX_RATING, 1.0
    )

    # Per-tag aggregates on deduplicated per-problem rows
    melted = per_prob.melt(
        id_vars=["problem_id", "problem_rating", "ever_ac"],
        value_vars=[t for t in TAG_COLS if t in per_prob.columns],
        var_name="tag",
        value_name="has_tag",
    )
    melted = melted[melted["has_tag"] == 1].drop(columns="has_tag")

    tag_map: dict = {}
    if not melted.empty:
        def _mean_ac_rating(g):
            ac = g.loc[g["ever_ac"] == 1, "problem_rating"]
            return float(ac.mean()) if len(ac) else 0.0

        tag_agg = (
            melted.groupby("tag")
            .apply(lambda g: pd.Series({
                "total_attempts":    len(g),
                "ac_count":          int(g["ever_ac"].sum()),
                "avg_rating_solved": _mean_ac_rating(g),
            }))
            .reset_index()
        )
        tag_agg["acceptance_rate"]      = ((tag_agg["ac_count"] + SMOOTHING * 0.5) /
                                           (tag_agg["total_attempts"] + SMOOTHING)).clip(0, 1)
        tag_agg["difficulty_score"]     = (tag_agg["avg_rating_solved"] / MAX_RATING).clip(0, 1)
        tag_agg["volume_score"]         = (np.log1p(tag_agg["ac_count"]) / np.log1p(50)).clip(0, 1)
        tag_agg["specialization_score"] = (
            (tag_agg["ac_count"] / total_ac) if total_ac > 0 else 0.0
        ).clip(0, 1)
        tag_map = tag_agg.set_index("tag").to_dict("index")

    fallback = {
        "acceptance_rate":      global_acceptance,
        "difficulty_score":     global_difficulty,
        "specialization_score": 0.0,
        "volume_score":         0.0,
    }

    vec: List[float] = []
    for tag in TAG_COLS:
        if tag in tag_map:
            row = tag_map[tag]
            vec.extend([float(row[f]) for f in TAG_FEATURE_COLS])
        else:
            vec.extend([fallback[f] for f in TAG_FEATURE_COLS])

    # Append user-level features once
    vec.append(rating_boost)
    vec.append(efficiency_score)

    return np.array(vec, dtype=np.float32)


class FeatureEngineer:
    """Builds 82-dim KNN feature vectors (4 tag-level × 20 tags + 2 user-level)."""

    def __init__(self):
        self._pivot: Optional[pd.DataFrame] = None

    def _load_pivot(self) -> pd.DataFrame:
        if self._pivot is None:
            df = pd.read_csv(TAG_STRENGTHS_CSV)

            # Tag-level features: 4 × 20 = 80 columns
            frames = []
            for feat in TAG_FEATURE_COLS:
                p = (
                    df.pivot(index="handle", columns="tag", values=feat)
                      .reindex(columns=TAG_COLS)
                      .fillna(0.0)
                )
                p.columns = [f"{feat}__{tag}" for tag in TAG_COLS]
                frames.append(p)

            tag_pivot = pd.concat(frames, axis=1)

            # User-level features: take first row per handle (they're constant per user)
            user_feats = (
                df.groupby("handle")[USER_FEATURE_COLS].first()
            )

            self._pivot = tag_pivot.join(user_feats, how="left").fillna(0.0)

        return self._pivot

    def engineer_features(self, preprocessed_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Build feature matrix for KNN.

        preprocessed_data must contain:
          - "target_user_handle": str
          - "target_features": np.ndarray  (82-dim, from compute_target_features)
        """
        pivot = self._load_pivot()

        target_handle   = preprocessed_data["target_user_handle"]
        target_features = preprocessed_data["target_features"]

        dataset_handles = [h for h in pivot.index if h != target_handle]
        feature_matrix  = pivot.loc[dataset_handles].values.astype(np.float32)

        return {
            "target_user":       target_handle,
            "target_features":   target_features,
            "dataset_handles":   dataset_handles,
            "feature_matrix":    feature_matrix,
            "dataset_size":      len(dataset_handles),
            "feature_dimension": FEATURE_DIM,
        }
