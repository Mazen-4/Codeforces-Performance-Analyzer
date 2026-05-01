"""
Main Orchestrator for the Codeforces Performance Analyzer

This script orchestrates the entire recommendation pipeline with performance profiling.
It measures execution time and memory usage for each stage:
1. Data Collection - Fetch user data from Codeforces API
2. Preprocessing - Clean and normalize data
3. Feature Engineering - Extract and engineer features
4. Model Inference - Find 50 nearest neighbors using KNN
5. Recommendation Generation - Format and output recommendations

The profiling results are logged to logs/performance_logs.json for analysis.
"""

import sys
import os

# Add src to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from pipeline.data_collection import DataCollector
from pipeline.preprocessing import DataPreprocessor
from pipeline.feature_engineering import FeatureEngineer
from pipeline.model_inference import ModelInference
from pipeline.recommendation import RecommendationGenerator
from profiling.profiler import StageProfiler
from profiling.logger import PerformanceLogger
import config


def main(user_handle: str, user_dataset: list, verbose: bool = True):
    """
    Main function to run the complete recommendation pipeline with profiling.
    
    Args:
        user_handle: The input Codeforces user handle
        user_dataset: List of Codeforces user handles to compare against
        verbose: Enable verbose output
        
    Returns:
        Dictionary containing recommendations and profiling metrics
    """
    
    if verbose:
        print(f"\n{'='*60}")
        print(f"Codeforces Performance Analyzer")
        print(f"{'='*60}")
        print(f"Target User: {user_handle}")
        print(f"Dataset Size: {len(user_dataset)} users")
        print(f"{'='*60}\n")
    
    # Initialize profiler and logger
    logger = PerformanceLogger(config.PERFORMANCE_LOG_FILE)
    profiler = StageProfiler(logger)
    
    result = {
        "success": False,
        "target_user": user_handle,
        "error": None,
        "recommendation": None,
        "profiling": None
    }
    
    try:
        # ==================== STAGE 1: DATA COLLECTION ====================
        if verbose:
            print("[1/5] Data Collection - Fetching user data from Codeforces API...")
        
        with profiler.profile_data_collection(
            metadata={"target_user": user_handle, "dataset_size": len(user_dataset)}
        ):
            data_collector = DataCollector()
            collected_data = data_collector.collect_data(user_handle, user_dataset)
        
        if verbose:
            valid_count = collected_data.get("valid_dataset_size", 0)
            invalid_handles = collected_data.get("invalid_handles", [])
            print(f"[OK] Data collected for {valid_count} valid users out of {len(user_dataset)} requested")
            if invalid_handles:
                print(f"[WARNING] Invalid dataset handles skipped: {', '.join(invalid_handles)}")
        
        # ==================== STAGE 2: PREPROCESSING ====================
        if verbose:
            print("[2/5] Preprocessing - Cleaning and normalizing data...")
        
        with profiler.profile_preprocessing(metadata={"records_processed": len(user_dataset)}):
            preprocessor = DataPreprocessor()
            preprocessed_data = preprocessor.preprocess_dataset(collected_data)
        
        if verbose:
            print(f"[OK] Data preprocessed for {len(user_dataset)} users")
        
        # ==================== STAGE 3: FEATURE ENGINEERING ====================
        if verbose:
            print("[3/5] Feature Engineering - Extracting features...")
        
        with profiler.profile_feature_engineering(
            metadata={"feature_dimension": config.EXPECTED_FEATURE_DIMENSION}
        ):
            feature_engineer = FeatureEngineer()
            engineered_data = feature_engineer.engineer_features(preprocessed_data)
        
        if verbose:
            print(f"[OK] Features engineered ({config.EXPECTED_FEATURE_DIMENSION} dimensions)")
        
        # ==================== STAGE 4: MODEL INFERENCE ====================
        if verbose:
            print("[4/5] Model Inference - Running KNN classification...")
        
        with profiler.profile_model_inference(
            metadata={"k_neighbors": config.K_NEIGHBORS, "metric": config.KNN_METRIC}
        ):
            model_inference = ModelInference(k=config.K_NEIGHBORS)
            inference_result = model_inference.perform_inference(engineered_data)
        
        if verbose:
            print(f"[OK] KNN found {inference_result['num_neighbors_found']} nearest neighbors")
            print(f"  Top 5 neighbors:")
            for neighbor in inference_result["neighbors"][:5]:
                print(f"    {neighbor['rank']}. {neighbor['user_handle']} (distance: {neighbor['distance']:.4f})")
        
        # ==================== STAGE 5: RECOMMENDATION GENERATION ====================
        if verbose:
            print("[5/5] Recommendation Generation - Formatting output...")
        
        with profiler.profile_recommendation_generation(
            metadata={"output_format": config.RECOMMENDATION_OUTPUT_FORMAT}
        ):
            recommendation_generator = RecommendationGenerator(config.RECOMMENDATION_OUTPUT_FORMAT)
            final_recommendation = recommendation_generator.generate_and_save(inference_result)
        
        if verbose:
            print(f"[OK] Recommendations saved to {config.RECOMMENDATION_OUTPUT_FILE}")
        
        # ==================== FINALIZE PROFILING ====================
        profiler.finalize_run(user_handle, num_neighbors=inference_result["num_neighbors_found"])
        profiler.save_run()
        
        # Get profiling summary
        profiling_summary = logger.get_current_run()
        
        if verbose:
            print(f"\n{'='*60}")
            print("Performance Summary:")
            print(f"{'='*60}")
            if "summary" in profiling_summary:
                summary = profiling_summary["summary"]
                print(f"Total Execution Time: {summary['total_execution_time_seconds']:.4f} seconds")
                print(f"Total Memory Used: {summary.get('total_memory_used_mb', 'N/A')} MB")
                print(f"Pipeline Stages: {summary['num_stages']}")
            print(f"\nStage-by-stage breakdown:")
            for stage in profiling_summary["stages"]:
                print(f"  - {stage['stage']}: {stage['execution_time_seconds']:.4f}s " +
                      f"({stage.get('memory_usage_mb', 0) or 0:.2f}MB)")
            print(f"{'='*60}\n")
        
        result["success"] = True
        result["recommendation"] = final_recommendation
        result["profiling"] = profiling_summary
        
    except Exception as e:
        result["error"] = str(e)
        if verbose:
            print(f"\n[ERROR] Error during pipeline execution: {e}")
        import traceback
        traceback.print_exc()
    
    return result


def run_example():
    """
    Run an example with sample user data.
    """
    print("\n" + "="*60)
    print("Running Example Pipeline")
    print("="*60)
    
    # Example: Analyze user "tourist" against a dataset of other users
    target_user = "tourist"
    dataset_users = [
        "SecondThread",
        "Um_nik",
        "krijamaan",
        "duality",
        "pllk",
        "Swistakk",
        "jiangly",
        "ksun48",
        "ecnerwala",
        "Radewoosh"
    ]
    
    result = main(target_user, dataset_users, verbose=True)
    
    if result["success"]:
        print("\n[OK] Pipeline completed successfully!")
        return result
    else:
        print(f"\n[ERROR] Pipeline failed: {result['error']}")
        return result


if __name__ == "__main__":
    # If arguments provided, use them
    if len(sys.argv) > 2:
        user_handle = sys.argv[1]
        user_dataset = sys.argv[2:]
        result = main(user_handle, user_dataset, verbose=True)
    else:
        # Run example
        result = run_example()
    
    # Exit with status
    sys.exit(0 if result.get("success") else 1)
