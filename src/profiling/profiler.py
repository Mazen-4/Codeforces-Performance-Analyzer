import time
import functools
from contextlib import contextmanager
from typing import Callable, Optional, Dict, Any
import psutil
import os

from .logger import PerformanceLogger


class Profiler:
    """
    Profiler for measuring execution time and memory usage of pipeline stages.
    
    Provides decorators and context managers for easy instrumentation of
    data collection, preprocessing, feature engineering, model inference,
    and recommendation generation stages.
    """
    
    def __init__(self, logger: Optional[PerformanceLogger] = None):
        """
        Initialize the profiler.
        
        Args:
            logger: PerformanceLogger instance. If None, creates a new instance.
        """
        self.logger = logger or PerformanceLogger()
        self.process = psutil.Process(os.getpid())
    
    def _get_memory_usage_mb(self) -> float:
        """
        Get current process memory usage in megabytes.
        
        Returns:
            Memory usage in MB
        """
        try:
            return self.process.memory_info().rss / 1024 / 1024
        except Exception:
            return 0.0
    
    @contextmanager
    def profile_stage(
        self,
        stage_name: str,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """
        Context manager for profiling a pipeline stage.
        
        Usage:
            with profiler.profile_stage("data_collection", {"source": "codeforces"}):
                # your code here
                pass
        
        Args:
            stage_name: Name of the pipeline stage
            metadata: Additional metadata about the stage
            
        Yields:
            None
        """
        start_time = time.perf_counter()
        start_memory = self._get_memory_usage_mb()
        
        try:
            yield
        finally:
            end_time = time.perf_counter()
            end_memory = self._get_memory_usage_mb()
            
            execution_time = end_time - start_time
            # Enforce minimum time to avoid zero logging
            execution_time = max(execution_time, 0.0001)
            memory_delta = end_memory - start_memory
            
            self.logger.log_stage(
                stage_name=stage_name,
                execution_time=execution_time,
                memory_usage_mb=max(memory_delta, 0),  # Avoid negative values
                metadata=metadata
            )
    
    def profile_function(
        self,
        stage_name: Optional[str] = None,
        metadata_fn: Optional[Callable] = None
    ):
        """
        Decorator for profiling a function.
        
        Usage:
            @profiler.profile_function("preprocessing")
            def preprocess_data(data):
                # your code here
                return processed_data
        
        Args:
            stage_name: Name of the pipeline stage. If None, uses function name.
            metadata_fn: Optional callable that returns metadata dict based on function args/kwargs
            
        Returns:
            Decorated function
        """
        def decorator(func: Callable) -> Callable:
            name = stage_name or func.__name__
            
            @functools.wraps(func)
            def wrapper(*args, **kwargs):
                metadata = None
                if metadata_fn:
                    try:
                        metadata = metadata_fn(*args, **kwargs)
                    except Exception:
                        metadata = None
                
                with self.profile_stage(name, metadata=metadata):
                    return func(*args, **kwargs)
            
            return wrapper
        return decorator
    
    def get_logger(self) -> PerformanceLogger:
        """Return the associated PerformanceLogger instance."""
        return self.logger


class StageProfiler:
    """
    High-level profiler for the complete recommendation pipeline.
    
    Orchestrates profiling across all stages: data collection, preprocessing,
    feature engineering, model inference, and recommendation generation.
    """
    
    def __init__(self, logger: Optional[PerformanceLogger] = None):
        """
        Initialize the stage profiler.
        
        Args:
            logger: PerformanceLogger instance. If None, creates a new instance.
        """
        self.profiler = Profiler(logger)
        self.logger = self.profiler.logger
    
    def profile_data_collection(self, metadata: Optional[Dict[str, Any]] = None):
        """Context manager for profiling data collection stage."""
        return self.profiler.profile_stage("data_collection", metadata)
    
    def profile_preprocessing(self, metadata: Optional[Dict[str, Any]] = None):
        """Context manager for profiling preprocessing stage."""
        return self.profiler.profile_stage("preprocessing", metadata)
    
    def profile_feature_engineering(self, metadata: Optional[Dict[str, Any]] = None):
        """Context manager for profiling feature engineering stage."""
        return self.profiler.profile_stage("feature_engineering", metadata)
    
    def profile_model_inference(self, metadata: Optional[Dict[str, Any]] = None):
        """Context manager for profiling KNN model inference stage."""
        return self.profiler.profile_stage("model_inference", metadata)
    
    def profile_recommendation_generation(self, metadata: Optional[Dict[str, Any]] = None):
        """Context manager for profiling recommendation generation stage."""
        return self.profiler.profile_stage("recommendation_generation", metadata)
    
    def finalize_run(self, user_handle: str, num_neighbors: int = 50):
        """
        Finalize profiling run with summary metrics.
        
        Args:
            user_handle: The input user handle
            num_neighbors: Number of neighbors returned (default 50)
        """
        self.logger.finalize_run(user_handle, num_neighbors)
    
    def save_run(self):
        """Save profiling run to JSON log file."""
        self.logger.save_run()
    
    def reset_run(self):
        """Reset profiler for a new run."""
        self.logger.reset_run()
