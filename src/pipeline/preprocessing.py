"""
Preprocessing Module

Cleans and normalizes the raw user data collected from Codeforces.
Handles missing values, outliers, and data standardization.
"""

from typing import Dict, Any, List
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))


class DataPreprocessor:
    """Preprocesses raw Codeforces data."""
    
    def __init__(self):
        """Initialize the preprocessor."""
        self.missing_value_strategy = "drop"  # or "fill"
    
    def clean_user_data(self, user_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Clean user data by removing/handling missing values.
        
        Args:
            user_data: Raw user data dictionary
            
        Returns:
            Cleaned user data
        """
        cleaned = {}
        
        # Handle missing fields with defaults
        for key, value in user_data.items():
            if value is None:
                cleaned[key] = 0
            else:
                cleaned[key] = value
        
        return cleaned
    
    def normalize_numeric_field(self, value: float, min_val: float, max_val: float) -> float:
        """
        Normalize a numeric field using min-max normalization.
        
        Args:
            value: The value to normalize
            min_val: Minimum value in the range
            max_val: Maximum value in the range
            
        Returns:
            Normalized value between 0 and 1
        """
        if max_val - min_val == 0:
            return 0.0
        return (value - min_val) / (max_val - min_val)
    
    def extract_submission_stats(self, submissions: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Extract statistics from user submissions.
        
        Args:
            submissions: List of submission dictionaries
            
        Returns:
            Dictionary with submission statistics
        """
        if not submissions:
            return {
                "total_submissions": 0,
                "accepted_count": 0,
                "rejected_count": 0,
                "success_rate": 0.0
            }
        
        total = len(submissions)
        accepted = sum(1 for s in submissions if s.get("verdict") == "OK")
        rejected = total - accepted
        
        return {
            "total_submissions": total,
            "accepted_count": accepted,
            "rejected_count": rejected,
            "success_rate": accepted / total if total > 0 else 0.0
        }
    
    def preprocess_user_data(self, user_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Preprocess a single user's data. Only keeps stats, discards submission history.
        
        Args:
            user_data: Raw user data
            
        Returns:
            Preprocessed user data (lightweight, stats-only)
        """
        user_info = user_data.get("user_info", {})
        submissions = user_data.get("submissions", [])
        
        cleaned_info = self.clean_user_data(user_info)
        submission_stats = self.extract_submission_stats(submissions)
        
        # Note: We don't store submission_stats['submissions'] to save memory
        # Only keep the aggregated statistics
        return {
            "user_handle": user_data.get("handle"),
            "user_info": cleaned_info,
            "submission_stats": {
                "total_submissions": submission_stats["total_submissions"],
                "accepted_count": submission_stats["accepted_count"],
                "success_rate": submission_stats["success_rate"]
            },
            "submission_count": submission_stats["total_submissions"]
        }
    
    def preprocess_dataset(self, collected_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Preprocess the entire collected dataset.
        
        Args:
            collected_data: Collected data from data_collection stage
            
        Returns:
            Preprocessed dataset
        """
        target_user_data = {
            "handle": collected_data["target_user"],
            "user_info": collected_data["target_user_info"],
            "submissions": collected_data["target_user_submissions"]
        }
        
        target_processed = self.preprocess_user_data(target_user_data)
        
        # Preprocess dataset users, skipping invalid entries
        dataset_processed = {}
        for handle, user_data in collected_data["dataset"].items():
            user_dict = {"handle": handle}
            user_dict.update(user_data)
            dataset_processed[handle] = self.preprocess_user_data(user_dict)
        
        return {
            "target_user": target_processed,
            "dataset": dataset_processed,
            "dataset_size": collected_data["dataset_size"],
            "valid_dataset_size": collected_data.get("valid_dataset_size", len(dataset_processed)),
            "invalid_handles": collected_data.get("invalid_handles", [])
        }
