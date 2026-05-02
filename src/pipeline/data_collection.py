"""
Data Collection Module

Fetches user submission data from the Codeforces API.
This stage retrieves the raw user handle and dataset needed for the pipeline.
"""

import requests
from typing import Dict, Any, List, Optional
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from config import CODEFORCES_API_BASE_URL, CODEFORCES_API_TIMEOUT, MAX_SUBMISSIONS_PER_USER


class DataCollector:
    """Collects user data from Codeforces API."""
    
    def __init__(self):
        """Initialize the data collector."""
        self.base_url = CODEFORCES_API_BASE_URL
        self.timeout = CODEFORCES_API_TIMEOUT
    
    def fetch_user_info(self, user_handle: str) -> Dict[str, Any]:
        """
        Fetch user information from Codeforces.
        
        Args:
            user_handle: Codeforces user handle
            
        Returns:
            Dictionary with user info (rating, rank, etc.)
        """
        try:
            url = f"{self.base_url}/user.info?handles={user_handle}"
            response = requests.get(url, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()
            
            if data.get("status") == "OK" and data.get("result"):
                return data["result"][0]
            return {}
        except requests.RequestException as e:
            print(f"Error fetching user info for {user_handle}: {e}")
            return {}
    
    def fetch_user_submissions(self, user_handle: str) -> List[Dict[str, Any]]:
        """
        Fetch submissions for a user from Codeforces (limited to MAX_SUBMISSIONS_PER_USER).
        
        Args:
            user_handle: Codeforces user handle
            
        Returns:
            List of submission dictionaries
        """
        try:
            url = f"{self.base_url}/user.status?handle={user_handle}&count={MAX_SUBMISSIONS_PER_USER}"
            response = requests.get(url, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()
            
            if data.get("status") == "OK":
                return data.get("result", [])
            return []
        except requests.RequestException as e:
            print(f"Error fetching submissions for {user_handle}: {e}")
            return []
    
    def fetch_multiple_users(self, user_handles: List[str]) -> Dict[str, Any]:
        """
        Fetch data for multiple users, skipping invalid handles.
        Only fetches user info; submissions are not needed for KNN features.
        
        Args:
            user_handles: List of Codeforces user handles
            
        Returns:
            Dictionary containing valid users data and invalid handles list
        """
        users_data = {}
        invalid_handles = []
        for handle in user_handles:
            user_info = self.fetch_user_info(handle)
            if not user_info:
                print(f"Skipping invalid or missing handle: {handle}")
                invalid_handles.append(handle)
                continue
            
            users_data[handle] = {
                "user_info": user_info,
                "submissions": []  # Empty for memory efficiency
            }
        
        return {
            "users": users_data,
            "invalid_handles": invalid_handles
        }
    
    def collect_data(self, user_handle: str, user_dataset: List[str]) -> Dict[str, Any]:
        """
        Collect data for the input user and the comparison dataset.
        
        Args:
            user_handle: The input user handle
            user_dataset: List of user handles to compare against
            
        Returns:
            Dictionary containing target user data and dataset
        """
        target_user = self.fetch_user_info(user_handle)
        if not target_user:
            raise ValueError(f"Target user handle not found or invalid: {user_handle}")
        target_submissions = self.fetch_user_submissions(user_handle)
        
        dataset_result = self.fetch_multiple_users(user_dataset)
        valid_dataset = dataset_result["users"]
        invalid_handles = dataset_result["invalid_handles"]
        
        return {
            "target_user": user_handle,
            "target_user_info": target_user,
            "target_user_submissions": target_submissions,
            "dataset": valid_dataset,
            "dataset_size": len(user_dataset),
            "valid_dataset_size": len(valid_dataset),
            "invalid_handles": invalid_handles
        }
