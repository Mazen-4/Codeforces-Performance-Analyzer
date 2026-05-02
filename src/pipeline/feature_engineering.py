"""
Feature Engineering Module

Extracts and engineered features from preprocessed user data.
Prepares data in a format suitable for KNN model inference.
"""

from typing import Dict, Any, List, Tuple
import sys
import os
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from config import FEATURES_TO_EXTRACT, FEATURE_NORMALIZATION, EXPECTED_FEATURE_DIMENSION


class FeatureEngineer:
    """Extracts and engineers features for KNN model."""
    
    RANK_ORDER = [
        "newbie",
        "pupil",
        "specialist",
        "expert",
        "candidate master",
        "master",
        "international master",
        "grandmaster",
        "international grandmaster",
        "legendary grandmaster"
    ]
    
    def __init__(self):
        """Initialize the feature engineer."""
        self.features_to_extract = FEATURES_TO_EXTRACT
        self.normalization_method = FEATURE_NORMALIZATION
    
    def _to_float(self, value: Any, default: float = 0.0) -> float:
        """
        Convert a value to float if possible.
        """
        if value is None:
            return default
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                return default
        return default
    
    def _parse_rank_to_numeric(self, value: Any) -> float:
        """
        Parse a Codeforces rank string into a numeric ordinal.
        """
        if value is None:
            return float(1e6)
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized.isdigit():
                return float(normalized)
            if normalized in self.RANK_ORDER:
                return float(self.RANK_ORDER.index(normalized) + 1)
            # If the rank string contains user handle or unknown text, return a large penalty value
            return float(1e6)
        return float(1e6)
    
    def extract_features_from_user(self, user_data: Dict[str, Any]) -> np.ndarray:
        """
        Extract feature vector from preprocessed user data.
        
        Args:
            user_data: Preprocessed user data
            
        Returns:
            Feature vector as numpy array
        """
        features = []
        
        user_info = user_data.get("user_info", {})
        submission_stats = user_data.get("submission_stats", {})
        
        # Extract numeric features
        features.append(self._to_float(user_info.get("rating", 0)))  # current rating
        features.append(self._to_float(user_info.get("maxRating", 0)))  # max rating
        features.append(self._parse_rank_to_numeric(user_info.get("maxRank", 1e6)))  # max rank
        features.append(self._to_float(submission_stats.get("total_submissions", 0)))
        features.append(self._to_float(submission_stats.get("accepted_count", 0)))
        features.append(self._to_float(submission_stats.get("success_rate", 0.0)))
        
        # Pad to expected dimension
        while len(features) < EXPECTED_FEATURE_DIMENSION:
            features.append(0.0)
        
        return np.array(features[:EXPECTED_FEATURE_DIMENSION], dtype=np.float32)
    
    def normalize_features(self, feature_vector: np.ndarray) -> np.ndarray:
        """
        Normalize feature vector using configured method.
        
        Args:
            feature_vector: Feature vector to normalize
            
        Returns:
            Normalized feature vector
        """
        if self.normalization_method == "minmax":
            # Min-max normalization
            min_val = np.min(feature_vector)
            max_val = np.max(feature_vector)
            if max_val - min_val != 0:
                return (feature_vector - min_val) / (max_val - min_val)
            return feature_vector
        
        elif self.normalization_method == "zscore":
            # Z-score normalization
            mean = np.mean(feature_vector)
            std = np.std(feature_vector)
            if std != 0:
                return (feature_vector - mean) / std
            return feature_vector
        
        else:  # robust
            # Robust normalization
            q1 = np.percentile(feature_vector, 25)
            q3 = np.percentile(feature_vector, 75)
            iqr = q3 - q1
            if iqr != 0:
                return (feature_vector - q1) / iqr
            return feature_vector
    
    def engineer_features(self, preprocessed_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Engineer features for the entire dataset.
        
        Args:
            preprocessed_data: Preprocessed data from preprocessing stage
            
        Returns:
            Dictionary with target user features and dataset feature vectors
        """
        target_user_data = preprocessed_data["target_user"]
        dataset = preprocessed_data["dataset"]
        
        # Extract and normalize target user features
        target_features = self.extract_features_from_user(target_user_data)
        target_features = self.normalize_features(target_features)
        
        # Extract and normalize dataset features
        dataset_features = {}
        dataset_handles = []
        feature_vectors = []
        
        for handle, user_data in dataset.items():
            features = self.extract_features_from_user(user_data)
            features = self.normalize_features(features)
            dataset_features[handle] = features
            dataset_handles.append(handle)
            feature_vectors.append(features)
        
        # Convert to numpy array for KNN
        feature_matrix = np.array(feature_vectors) if feature_vectors else np.array([])
        
        return {
            "target_user": target_user_data["user_handle"],
            "target_features": target_features,
            "dataset_handles": dataset_handles,
            "feature_matrix": feature_matrix,
            "dataset_size": len(dataset),
            "feature_dimension": EXPECTED_FEATURE_DIMENSION
        }
