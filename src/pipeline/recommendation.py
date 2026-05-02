"""
Recommendation Generation Module

Formats and outputs the final recommendations (50 nearest neighbors).
Prepares data for presentation to the user.
"""

from typing import Dict, Any, List
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from config import RECOMMENDATION_OUTPUT_FORMAT, RECOMMENDATION_OUTPUT_FILE


class RecommendationGenerator:
    """Generates final recommendations from inference results."""
    
    def __init__(self, output_format: str = RECOMMENDATION_OUTPUT_FORMAT):
        """
        Initialize recommendation generator.
        
        Args:
            output_format: Output format ('json', 'csv', 'list')
        """
        self.output_format = output_format
    
    def format_neighbors_json(self, inference_result: Dict[str, Any]) -> Dict[str, Any]:
        """
        Format neighbors as JSON.
        
        Args:
            inference_result: Result from model_inference stage
            
        Returns:
            Formatted JSON dictionary
        """
        return {
            "target_user": inference_result["target_user"],
            "num_neighbors": inference_result["num_neighbors_found"],
            "neighbors": inference_result["neighbors"],
            "metadata": {
                "distance_metric": inference_result["distance_metric"],
                "dataset_size": inference_result["dataset_size"]
            }
        }
    
    def format_neighbors_csv(self, inference_result: Dict[str, Any]) -> List[str]:
        """
        Format neighbors as CSV lines.
        
        Args:
            inference_result: Result from model_inference stage
            
        Returns:
            List of CSV lines
        """
        lines = []
        lines.append("rank,user_handle,distance")
        
        for neighbor in inference_result["neighbors"]:
            line = f"{neighbor['rank']},{neighbor['user_handle']},{neighbor['distance']}"
            lines.append(line)
        
        return lines
    
    def format_neighbors_list(self, inference_result: Dict[str, Any]) -> List[str]:
        """
        Format neighbors as simple list.
        
        Args:
            inference_result: Result from model_inference stage
            
        Returns:
            List of user handles
        """
        return [neighbor["user_handle"] for neighbor in inference_result["neighbors"]]
    
    def generate_recommendation(self, inference_result: Dict[str, Any]) -> Any:
        """
        Generate recommendation in the configured format.
        
        Args:
            inference_result: Result from model_inference stage
            
        Returns:
            Formatted recommendation
        """
        if self.output_format == "json":
            return self.format_neighbors_json(inference_result)
        elif self.output_format == "csv":
            return self.format_neighbors_csv(inference_result)
        else:  # list
            return self.format_neighbors_list(inference_result)
    
    def save_recommendation(self, recommendation: Any, user_handle: str):
        """
        Save recommendation to file.
        
        Args:
            recommendation: Generated recommendation
            user_handle: User handle for filename
        """
        if self.output_format == "json":
            with open(RECOMMENDATION_OUTPUT_FILE, 'w') as f:
                json.dump(recommendation, f, indent=2)
        elif self.output_format == "csv":
            filename = RECOMMENDATION_OUTPUT_FILE.replace('.json', '.csv')
            with open(filename, 'w') as f:
                f.write('\n'.join(recommendation))
        else:  # list
            filename = RECOMMENDATION_OUTPUT_FILE.replace('.json', '.txt')
            with open(filename, 'w') as f:
                f.write('\n'.join(recommendation))
    
    def generate_and_save(self, inference_result: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate recommendation and save to file.
        
        Args:
            inference_result: Result from model_inference stage
            
        Returns:
            The generated recommendation
        """
        recommendation = self.generate_recommendation(inference_result)
        user_handle = inference_result["target_user"]
        self.save_recommendation(recommendation, user_handle)
        
        return {
            "target_user": user_handle,
            "num_neighbors": inference_result["num_neighbors_found"],
            "recommendation": recommendation,
            "format": self.output_format,
            "saved_to": RECOMMENDATION_OUTPUT_FILE
        }
