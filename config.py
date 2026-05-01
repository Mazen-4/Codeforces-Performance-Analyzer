"""
Configuration module for the Codeforces Performance Analyzer.

Contains paths, settings, and constants for:
- Performance profiling and logging
- KNN recommendation pipeline
- Data collection and processing
- Model inference parameters
"""

import os

# ==================== PROJECT PATHS ====================
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(PROJECT_ROOT, "src")
PIPELINE_DIR = os.path.join(SRC_DIR, "pipeline")
PROFILING_DIR = os.path.join(SRC_DIR, "profiling")
LOGS_DIR = os.path.join(PROJECT_ROOT, "logs")
DATA_DIR = os.path.join(PROJECT_ROOT, "data")

# Ensure log directory exists
os.makedirs(LOGS_DIR, exist_ok=True)

# ==================== PERFORMANCE PROFILING ====================
# Log file for storing performance metrics
PERFORMANCE_LOG_FILE = os.path.join(LOGS_DIR, "performance_logs.json")

# Pipeline stages to be profiled
PIPELINE_STAGES = [
    "data_collection",
    "preprocessing",
    "feature_engineering",
    "model_inference",
    "recommendation_generation"
]

# ==================== KNN RECOMMENDATION SETTINGS ====================
# Number of nearest neighbors to return
K_NEIGHBORS = 50

# Distance metric for KNN (e.g., "euclidean", "manhattan", "cosine")
KNN_METRIC = "euclidean"

# KNN algorithm implementation (e.g., "auto", "ball_tree", "kd_tree", "brute")
KNN_ALGORITHM = "auto"

# ==================== DATA COLLECTION ====================
# Codeforces API settings
CODEFORCES_API_BASE_URL = "https://codeforces.com/api"
CODEFORCES_API_TIMEOUT = 30  # seconds

# Maximum number of submissions to fetch per user (to optimize API calls)
# Feature extraction only needs stats, not full history
MAX_SUBMISSIONS_PER_USER = 200

# Cache settings for API calls (to reduce redundant API calls)
ENABLE_API_CACHE = True
CACHE_EXPIRY_HOURS = 24

# ==================== DATA PROCESSING ====================
# Features to extract from user submissions
FEATURES_TO_EXTRACT = [
    "submission_count",
    "accepted_count",
    "max_rating",
    "average_rating",
    "problem_tags",
    "languages_used",
    "submission_frequency"
]

# Normalization method for features ("minmax", "zscore", "robust")
FEATURE_NORMALIZATION = "minmax"

# ==================== MODEL INFERENCE ====================
# Number of features expected after feature engineering
EXPECTED_FEATURE_DIMENSION = 50

# Batch size for processing multiple users
BATCH_SIZE = 100

# ==================== LOGGING & PROFILING ====================
# Enable detailed logging for debugging
DEBUG_MODE = True

# Log level ("DEBUG", "INFO", "WARNING", "ERROR")
LOG_LEVEL = "INFO"

# Format for performance logs
LOG_FORMAT = "json"  # or "csv"

# ==================== PERFORMANCE BENCHMARKS ====================
# Expected max execution times per stage (in seconds) - for anomaly detection
STAGE_TIME_LIMITS = {
    "data_collection": 30.0,
    "preprocessing": 10.0,
    "feature_engineering": 15.0,
    "model_inference": 20.0,
    "recommendation_generation": 5.0
}

# Total pipeline execution time limit (in seconds)
PIPELINE_TIME_LIMIT = 90.0

# ==================== OUTPUT ====================
# Format for recommendation output ("json", "csv", "list")
RECOMMENDATION_OUTPUT_FORMAT = "json"

# Path for storing recommendation results
RECOMMENDATION_OUTPUT_FILE = os.path.join(LOGS_DIR, "recommendations.json")

# ==================== CONSTANTS ====================
# Minimum number of submissions required for a user to be analyzed
MIN_SUBMISSIONS_REQUIRED = 5

# Maximum number of users to process in one run
MAX_USERS_PER_RUN = 1000

# Default number of users to return in recommendation
DEFAULT_NUM_NEIGHBORS = K_NEIGHBORS


def get_config():
    """
    Return all configuration as a dictionary.
    
    Returns:
        Dictionary containing all configuration settings
    """
    return {
        "paths": {
            "project_root": PROJECT_ROOT,
            "src": SRC_DIR,
            "pipeline": PIPELINE_DIR,
            "profiling": PROFILING_DIR,
            "logs": LOGS_DIR,
            "data": DATA_DIR
        },
        "profiling": {
            "log_file": PERFORMANCE_LOG_FILE,
            "stages": PIPELINE_STAGES,
            "debug_mode": DEBUG_MODE,
            "log_level": LOG_LEVEL
        },
        "knn": {
            "k": K_NEIGHBORS,
            "metric": KNN_METRIC,
            "algorithm": KNN_ALGORITHM
        },
        "api": {
            "base_url": CODEFORCES_API_BASE_URL,
            "timeout": CODEFORCES_API_TIMEOUT,
            "cache_enabled": ENABLE_API_CACHE,
            "cache_expiry_hours": CACHE_EXPIRY_HOURS
        },
        "features": {
            "features": FEATURES_TO_EXTRACT,
            "normalization": FEATURE_NORMALIZATION,
            "expected_dimension": EXPECTED_FEATURE_DIMENSION
        },
        "performance_limits": {
            "stage_limits": STAGE_TIME_LIMITS,
            "pipeline_limit": PIPELINE_TIME_LIMIT
        }
    }
