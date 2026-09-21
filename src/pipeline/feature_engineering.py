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

    # Collapse to one row per distinct problem. Used for solved counts and
    # ratings — NOT for attempt counts, see the per-tag aggregate below.
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

    # Per-tag aggregates.
    #
    # total_attempts must count RAW submissions, not distinct problems: that is
    # what strength.py counts when it builds the reference dataset
    # (total_attempts = count of submission rows). Counting deduplicated
    # problems here made acceptance_rate ~0.97 for a user whose dataset-style
    # rate is ~0.42, because every failed attempt was collapsed away. The
    # inflated vector then only matched near-perfect, high-volume accounts,
    # which is why neighbours were always heavy solvers.
    raw = df[df["problem_rating"] > 0] if "problem_rating" in df.columns else df
    raw_melted = raw.melt(
        id_vars=["problem_id", "is_ac"],
        value_vars=[t for t in TAG_COLS if t in raw.columns],
        var_name="tag", value_name="has_tag",
    )
    raw_melted = raw_melted[raw_melted["has_tag"] == 1]
    raw_counts = raw_melted.groupby("tag").agg(
        total_attempts=("problem_id", "count"),
        raw_ac=("is_ac", "sum"),
    )

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
                "solved_problems":   int(g["ever_ac"].sum()),
                "avg_rating_solved": _mean_ac_rating(g),
            }), include_groups=False)
            .reset_index()
        )
        # Attempts and AC count come from raw submissions, matching the dataset.
        tag_agg = tag_agg.merge(raw_counts, on="tag", how="left")
        tag_agg["total_attempts"] = tag_agg["total_attempts"].fillna(0).astype(int)
        tag_agg["ac_count"]       = tag_agg["raw_ac"].fillna(0).astype(int)
        tag_agg["acceptance_rate"]      = ((tag_agg["ac_count"] + SMOOTHING * 0.5) /
                                           (tag_agg["total_attempts"] + SMOOTHING)).clip(0, 1)
        tag_agg["difficulty_score"]     = (tag_agg["avg_rating_solved"] / MAX_RATING).clip(0, 1)
        tag_agg["volume_score"]         = (np.log1p(tag_agg["ac_count"]) / np.log1p(50)).clip(0, 1)
        # specialization_score is ac_count / total_ac, where total_ac comes from
        # the profiles table. That column does not exist in the reference data,
        # so the merge yields NaN and the dataset stores 0.0 for 91% of cells.
        # Computing a real value here made the target's largest distance
        # component (32% of squared distance) one the reference set does not
        # carry, matching on an axis that is almost always zero. Mirror the
        # dataset until profiles actually provides total_ac.
        tag_agg["specialization_score"] = 0.0
        tag_map = tag_agg.set_index("tag").to_dict("index")

    # A tag the user has never attempted must look the way the reference set
    # encodes it, which is all zeros (the pivot reindexes missing tags and
    # fills 0.0). Substituting the user's global averages here made every
    # untouched tag look "attempted with average skill", inflating the target
    # vector and matching it to broad, high-volume accounts instead of to
    # users with a genuinely similar profile.
    fallback = {
        "acceptance_rate":      0.0,
        "difficulty_score":     0.0,
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

    # The pivot is identical for every user and only changes when the weekly
    # retrain republishes the dataset. Each request spawns a fresh Python
    # process, so the in-memory cache below never survives — without a disk
    # cache every analysis re-downloads the whole reference table.
    _CACHE_PATH = os.path.join(
        os.environ.get("CF_CACHE_DIR", "/tmp"), "cf_knn_pivot.parquet")
    _CACHE_TTL_SECONDS = 24 * 60 * 60

    @classmethod
    def _cached_pivot(cls):
        try:
            import time
            if not os.path.exists(cls._CACHE_PATH):
                return None
            if time.time() - os.path.getmtime(cls._CACHE_PATH) > cls._CACHE_TTL_SECONDS:
                return None
            return pd.read_parquet(cls._CACHE_PATH)
        except Exception:
            return None   # a bad cache must never break an analysis

    @classmethod
    def _store_pivot(cls, pivot) -> None:
        try:
            tmp = cls._CACHE_PATH + ".tmp"
            pivot.to_parquet(tmp)
            os.replace(tmp, cls._CACHE_PATH)   # atomic: readers see old or new
        except Exception:
            pass

    @staticmethod
    def _read_tag_strengths() -> pd.DataFrame:
        """Load every user's tag strengths, from Postgres when configured.

        This is the KNN reference set, so unlike the per-request readers in
        main.py it genuinely needs the whole table. The web container no longer
        ships the CSV (the dataset is ~1.5 GB and lives in the database), so
        falling back to the file only works for local runs and training.
        """
        try:
            from scripts.db.connection import get_engine, use_postgres
        except ImportError:
            use_postgres = lambda: False   # noqa: E731

        if use_postgres():
            from sqlalchemy import text
            # Only the columns the feature vector is built from. SELECT * pulled
            # all 21 columns of a 52 MB table on every single analysis, which
            # dominated both request time and Railway egress.
            cols = ["handle", "tag", *TAG_FEATURE_COLS, *USER_FEATURE_COLS]
            collist = ", ".join(f'"{c}"' for c in cols)
            with get_engine().connect() as conn:
                return pd.read_sql(
                    text(f"SELECT {collist} FROM user_tag_strengths"), conn)

        if not os.path.exists(TAG_STRENGTHS_CSV):
            raise RuntimeError(
                "No tag-strength data available: DATABASE_URL is not set and "
                f"{TAG_STRENGTHS_CSV} is missing."
            )
        return pd.read_csv(TAG_STRENGTHS_CSV)

    def _load_pivot(self) -> pd.DataFrame:
        if self._pivot is None:
            cached = self._cached_pivot()
            if cached is not None:
                self._pivot = cached
                return self._pivot

            df = self._read_tag_strengths()

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
            self._store_pivot(self._pivot)

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
