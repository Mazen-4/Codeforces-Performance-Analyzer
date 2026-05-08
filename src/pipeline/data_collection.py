"""
Data Collection Module

Only fetches the TARGET user from the Codeforces API.
Dataset users are loaded from pre-built CSVs — no API calls for them.
"""

import requests
from typing import Dict, Any, List, Optional
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from src.pipeline.config import CODEFORCES_API_BASE_URL, CODEFORCES_API_TIMEOUT, MAX_SUBMISSIONS_PER_USER

# Canonical tag set matching TagAnalyzer.TAG_COLS
TAG_COLS = [
    "tag_dp", "tag_greedy", "tag_graphs", "tag_math", "tag_strings",
    "tag_impl", "tag_binary_search", "tag_data_structures", "tag_number_theory",
    "tag_combinatorics", "tag_geometry", "tag_trees", "tag_sortings",
    "tag_two_pointers", "tag_bitmasks", "tag_flows", "tag_fft",
    "tag_games", "tag_probabilities", "tag_constructive",
]

_CF_TAG_MAP = {
    "dp": "tag_dp",
    "greedy": "tag_greedy",
    "graphs": "tag_graphs",
    "graph matchings": "tag_graphs",
    "math": "tag_math",
    "strings": "tag_strings",
    "implementation": "tag_impl",
    "binary search": "tag_binary_search",
    "data structures": "tag_data_structures",
    "number theory": "tag_number_theory",
    "combinatorics": "tag_combinatorics",
    "geometry": "tag_geometry",
    "trees": "tag_trees",
    "sortings": "tag_sortings",
    "two pointers": "tag_two_pointers",
    "bitmasks": "tag_bitmasks",
    "flows": "tag_flows",
    "fft": "tag_fft",
    "games": "tag_games",
    "probabilities": "tag_probabilities",
    "constructive algorithms": "tag_constructive",
}


def _submission_to_row(handle: str, submission: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Convert a raw Codeforces submission dict into a flat analysis row."""
    problem = submission.get("problem", {})
    verdict = submission.get("verdict", "")

    problem_id = f"{problem.get('contestId', '')}_{problem.get('index', '')}"
    rating = problem.get("rating", 0) or 0

    row = {
        "handle": handle,
        "problem_id": problem_id,
        "problem_name": problem.get("name", ""),
        "problem_rating": rating,
        "is_ac": 1 if verdict == "OK" else 0,
    }
    for col in TAG_COLS:
        row[col] = 0
    for t in problem.get("tags", []):
        col = _CF_TAG_MAP.get(t.lower())
        if col:
            row[col] = 1

    return row


class DataCollector:
    """Fetches only the target user's data from the Codeforces API."""

    def __init__(self):
        self.base_url = CODEFORCES_API_BASE_URL
        self.timeout = CODEFORCES_API_TIMEOUT

    def fetch_user_info(self, user_handle: str) -> Dict[str, Any]:
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
        """Fetch submissions and return as flat rows with binary tag columns."""
        try:
            url = f"{self.base_url}/user.status?handle={user_handle}&count={MAX_SUBMISSIONS_PER_USER}"
            response = requests.get(url, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()
            if data.get("status") == "OK":
                return [_submission_to_row(user_handle, s) for s in data.get("result", [])]
            return []
        except requests.RequestException as e:
            print(f"Error fetching submissions for {user_handle}: {e}")
            return []

    def collect_data(self, user_handle: str) -> Dict[str, Any]:
        """
        Fetch target user info and submissions from the API.
        Dataset users are NOT fetched here — they come from CSV.
        """
        user_info = self.fetch_user_info(user_handle)
        if not user_info:
            raise ValueError(f"Target user handle not found or invalid: {user_handle}")

        submission_rows = self.fetch_user_submissions(user_handle)

        return {
            "target_user": user_handle,
            "target_user_info": user_info,
            "target_user_submissions": submission_rows,
        }
