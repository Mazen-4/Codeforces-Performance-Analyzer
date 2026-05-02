import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional


class PerformanceLogger:
    """
    Logger for recording performance metrics (execution time and memory usage)
    across pipeline stages.
    
    Metrics are stored in JSON format for easy analysis and comparison across runs.
    """
    
    def __init__(self, log_file: str = "logs/performance_logs.json"):
        """
        Initialize the performance logger.
        
        Args:
            log_file: Path to the JSON log file
        """
        self.log_file = log_file
        self.current_run = {
            "timestamp": datetime.now().isoformat(),
            "stages": []
        }
        self._ensure_log_directory()
    
    def _ensure_log_directory(self):
        """Ensure the log directory exists."""
        log_dir = os.path.dirname(self.log_file)
        if log_dir and not os.path.exists(log_dir):
            os.makedirs(log_dir, exist_ok=True)
    
    def log_stage(
        self,
        stage_name: str,
        execution_time: float,
        memory_usage_mb: Optional[float] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """
        Log performance metrics for a pipeline stage.
        
        Args:
            stage_name: Name of the pipeline stage (e.g., "data_collection", "preprocessing")
            execution_time: Execution time in seconds
            memory_usage_mb: Memory usage in megabytes (optional)
            metadata: Additional metadata about the stage (optional)
        """
        stage_log = {
            "stage": stage_name,
            "execution_time_seconds": round(execution_time, 4),
            "memory_usage_mb": round(memory_usage_mb, 2) if memory_usage_mb else None,
            "timestamp": datetime.now().isoformat()
        }
        
        if metadata:
            stage_log["metadata"] = metadata
        
        self.current_run["stages"].append(stage_log)
    
    def finalize_run(self, user_handle: str, num_neighbors: int = 50):
        """
        Finalize the current run and compute aggregate metrics.
        
        Args:
            user_handle: The input user handle for this run
            num_neighbors: Number of nearest neighbors found (default 50)
        """
        total_time = sum(stage["execution_time_seconds"] for stage in self.current_run["stages"])
        total_memory = sum(
            stage["memory_usage_mb"] for stage in self.current_run["stages"] 
            if stage["memory_usage_mb"] is not None
        )
        
        self.current_run["summary"] = {
            "user_handle": user_handle,
            "num_neighbors_returned": num_neighbors,
            "total_execution_time_seconds": round(total_time, 4),
            "total_memory_used_mb": round(total_memory, 2) if total_memory > 0 else None,
            "num_stages": len(self.current_run["stages"])
        }
    
    def save_run(self):
        """Save the current run to the JSON log file."""
        existing_runs = []
        
        # Read existing logs if file exists
        if os.path.exists(self.log_file):
            try:
                with open(self.log_file, 'r') as f:
                    data = json.load(f)
                    existing_runs = data.get("runs", [])
            except (json.JSONDecodeError, IOError):
                existing_runs = []
        
        # Append current run
        existing_runs.append(self.current_run)
        
        # Write back to file
        output_data = {
            "total_runs": len(existing_runs),
            "last_updated": datetime.now().isoformat(),
            "runs": existing_runs
        }
        
        with open(self.log_file, 'w') as f:
            json.dump(output_data, f, indent=2)
    
    def get_current_run(self) -> Dict[str, Any]:
        """Return the current run data."""
        return self.current_run
    
    def reset_run(self):
        """Reset the current run for a new profiling session."""
        self.current_run = {
            "timestamp": datetime.now().isoformat(),
            "stages": []
        }
    
    @staticmethod
    def load_logs(log_file: str = "logs/performance_logs.json") -> Dict[str, Any]:
        """
        Load and return all saved performance logs.
        
        Args:
            log_file: Path to the JSON log file
            
        Returns:
            Dictionary containing all logged runs
        """
        if not os.path.exists(log_file):
            return {"runs": [], "total_runs": 0}
        
        try:
            with open(log_file, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {"runs": [], "total_runs": 0}
    
    @staticmethod
    def get_average_metrics(log_file: str = "logs/performance_logs.json") -> Dict[str, Any]:
        """
        Calculate average metrics across all runs.
        
        Args:
            log_file: Path to the JSON log file
            
        Returns:
            Dictionary with average execution time and memory usage per stage
        """
        logs = PerformanceLogger.load_logs(log_file)
        runs = logs.get("runs", [])
        
        if not runs:
            return {}
        
        stage_metrics = {}
        
        for run in runs:
            for stage in run.get("stages", []):
                stage_name = stage["stage"]
                if stage_name not in stage_metrics:
                    stage_metrics[stage_name] = {
                        "execution_times": [],
                        "memory_usages": []
                    }
                
                stage_metrics[stage_name]["execution_times"].append(stage["execution_time_seconds"])
                if stage["memory_usage_mb"] is not None:
                    stage_metrics[stage_name]["memory_usages"].append(stage["memory_usage_mb"])
        
        # Calculate averages
        averages = {}
        for stage_name, metrics in stage_metrics.items():
            avg_time = sum(metrics["execution_times"]) / len(metrics["execution_times"])
            avg_memory = (
                sum(metrics["memory_usages"]) / len(metrics["memory_usages"])
                if metrics["memory_usages"]
                else None
            )
            averages[stage_name] = {
                "avg_execution_time_seconds": round(avg_time, 4),
                "avg_memory_usage_mb": round(avg_memory, 2) if avg_memory else None,
                "num_runs": len(metrics["execution_times"])
            }
        
        return averages
