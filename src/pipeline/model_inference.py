"""
Model Inference Module

Implements KNN classification to find the K nearest neighbors (50 by default).
This stage finds users most similar to the input user based on engineered features.
"""

from typing import Dict, Any, List, Tuple
import sys
import os
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from config import K_NEIGHBORS, KNN_METRIC


def _compute_distances(feature_matrix: np.ndarray, target_features: np.ndarray, metric: str) -> np.ndarray:
    """Compute distance from target_features to each row in feature_matrix."""
    if metric == "euclidean":
        return np.linalg.norm(feature_matrix - target_features, axis=1)
    if metric == "manhattan":
        return np.sum(np.abs(feature_matrix - target_features), axis=1)
    if metric == "cosine":
        target_norm = np.linalg.norm(target_features)
        matrix_norm = np.linalg.norm(feature_matrix, axis=1)
        dot_products = feature_matrix.dot(target_features)
        # Avoid division by zero
        denom = np.maximum(matrix_norm * target_norm, 1e-12)
        return 1.0 - (dot_products / denom)
    # fallback to euclidean
    return np.linalg.norm(feature_matrix - target_features, axis=1)


class KNNModel:
    """KNN model for finding nearest neighbors using NumPy."""
    
    def __init__(self, k: int = K_NEIGHBORS, metric: str = KNN_METRIC):
        """
        Initialize the KNN model.
        """
        self.k = k
        self.metric = metric
        self.feature_matrix = None
        self.fitted = False
    
    def fit(self, feature_matrix: np.ndarray):
        """Store the feature matrix for distance calculation."""
        if feature_matrix.size == 0:
            raise ValueError("Feature matrix is empty")
        self.feature_matrix = feature_matrix
        self.fitted = True
    
    def predict(self, target_features: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """Return the nearest neighbor distances and indices."""
        if not self.fitted:
            raise ValueError("Model not fitted. Call fit() first.")
        if target_features.ndim == 1:
            target_features = target_features.reshape(1, -1)
        target_vector = target_features[0]
        distances = _compute_distances(self.feature_matrix, target_vector, self.metric)
        indices = np.argsort(distances)
        k = min(self.k, len(distances))
        return distances[indices][:k], indices[:k]
    
    def get_neighbors_info(
        self,
        distances: np.ndarray,
        indices: np.ndarray,
        handles: List[str]
    ) -> List[Dict[str, Any]]:
        """Convert neighbor indices and distances to readable info."""
        neighbors = []
        for rank, (idx, distance) in enumerate(zip(indices, distances)):
            neighbors.append({
                "rank": rank + 1,
                "user_handle": handles[int(idx)],
                "index": int(idx),
                "distance": float(distance)
            })
        return neighbors


class ModelInference:
    """High-level model inference orchestrator."""
    
    def __init__(self, k: int = K_NEIGHBORS):
        self.k = k
        self.model = KNNModel(k=k, metric=KNN_METRIC)
    
    def perform_inference(self, engineered_data: Dict[str, Any]) -> Dict[str, Any]:
        target_user = engineered_data["target_user"]
        target_features = engineered_data["target_features"]
        feature_matrix = engineered_data["feature_matrix"]
        dataset_handles = engineered_data["dataset_handles"]
        
        if feature_matrix.size == 0 or len(dataset_handles) == 0:
            return {
                "target_user": target_user,
                "num_neighbors_found": 0,
                "neighbors": [],
                "distance_metric": KNN_METRIC,
                "dataset_size": engineered_data["dataset_size"]
            }
        
        self.model.fit(feature_matrix)
        distances, indices = self.model.predict(target_features)
        neighbors = self.model.get_neighbors_info(distances, indices, dataset_handles)
        
        return {
            "target_user": target_user,
            "num_neighbors_found": len(neighbors),
            "neighbors": neighbors,
            "distance_metric": KNN_METRIC,
            "dataset_size": engineered_data["dataset_size"]
        }
