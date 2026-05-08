"""
Feature Engineering Module

Builds the KNN feature matrix from pre-computed tag strengths.
Dataset users: loaded from 06_user_tag_strengths.csv (no API calls).
Target user:   tag strengths computed live via TagAnalyzer from their submissions.
"""

from typing import Dict, Any, List
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

TAG_STRENGTHS_CSV = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "ML", "dataset", "06_user_tag_strengths.csv",
)


class FeatureEngineer:
    """Builds KNN feature vectors from pre-computed tag strength data."""

    def __init__(self):
        self._pivot: pd.DataFrame = None  # loaded lazily

    def _load_pivot(self) -> pd.DataFrame:
        if self._pivot is None:
            df = pd.read_csv(TAG_STRENGTHS_CSV)
            self._pivot = (
                df.pivot(index="handle", columns="tag", values="tag_strength")
                  .reindex(columns=TAG_COLS)
                  .fillna(0.0)
            )
        return self._pivot

    def _tag_strength_dict_to_vector(self, strengths: Dict[str, Any]) -> np.ndarray:
        """Convert TagAnalyzer output dict → 20-dim numpy vector (values 0–1)."""
        vec = np.array(
            [strengths.get(tag, {}).get("strength", 0.0) / 100.0 for tag in TAG_COLS],
            dtype=np.float32,
        )
        return vec

    def engineer_features(self, preprocessed_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Build feature matrix for KNN.

        preprocessed_data must contain:
          - "target_user_handle": str
          - "target_tag_strengths": dict  (TagAnalyzer output, tag → {strength, ...})
          - "dataset_handles": list[str]  (optional override; uses full CSV if absent)
        """
        pivot = self._load_pivot()

        target_handle = preprocessed_data["target_user_handle"]
        target_tag_strengths = preprocessed_data.get("target_tag_strengths", {})
        target_features = self._tag_strength_dict_to_vector(target_tag_strengths)

        # Use all handles in the pivot (excludes target if not in CSV, which is expected)
        dataset_handles = [h for h in pivot.index if h != target_handle]
        feature_matrix = pivot.loc[dataset_handles].values.astype(np.float32)

        return {
            "target_user": target_handle,
            "target_features": target_features,
            "dataset_handles": dataset_handles,
            "feature_matrix": feature_matrix,
            "dataset_size": len(dataset_handles),
            "feature_dimension": len(TAG_COLS),
        }
