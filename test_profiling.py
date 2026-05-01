import json
import subprocess
import os
import time

LOG_FILE = "logs/performance_logs.json"


def run_command(cmd):
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=60)
        return True, result.stdout, result.stderr
    except Exception as e:
        return False, "", str(e)


def load_logs():
    if not os.path.exists(LOG_FILE):
        return {"runs": []}
    with open(LOG_FILE, "r") as f:
        data = json.load(f)
        return data.get("runs", [])


def validate_run(run):
    issues = []

    stages = run.get("stages", [])

    # Check 1: All stages exist
    expected_stages = [
        "data_collection",
        "preprocessing",
        "feature_engineering",
        "model_inference",
        "recommendation_generation"
    ]

    stage_names = [s["stage"] for s in stages]

    for s in expected_stages:
        if s not in stage_names:
            issues.append(f"Missing stage: {s}")

    # Check 2: Time validity
    for s in stages:
        if s.get("execution_time_seconds", 0) <= 0:
            issues.append(f"Invalid time in {s['stage']}")

    # Check 3: Memory validity (if exists)
    for s in stages:
        if "memory_usage_mb" in s and s["memory_usage_mb"] is not None and s["memory_usage_mb"] < 0:
            issues.append(f"Negative memory in {s['stage']}")

    return issues


def run_test_case(name, command):
    print(f"\n=== Running: {name} ===")

    before = load_logs()
    before_count = len(before)

    success, out, err = run_command(command)

    after = load_logs()
    after_count = len(after)

    if not success:
        print(f"[ERROR] Execution failed: {err}")
        return

    if after_count <= before_count:
        print("[FAIL] No new log entry created")
        print(f"Before: {before_count} runs, After: {after_count} runs")
        return

    latest_run = after[-1]

    issues = validate_run(latest_run)

    if issues:
        print("[FAIL] Issues detected:")
        for i in issues:
            print(" -", i)
    else:
        print("[PASS] Profiling looks correct")

    print("Stages recorded:", [s["stage"] for s in latest_run.get("stages", [])])
    if "summary" in latest_run:
        summary = latest_run["summary"]
        print(f"Total time: {summary.get('total_execution_time_seconds', 'N/A')}s")
        print(f"Total memory: {summary.get('total_memory_used_mb', 'N/A')}MB")


def main():
    # Real Codeforces handles for testing
    test_cases = [
        ("Single User", "python main.py tourist Um_nik"),
        ("5 Valid Users", "python main.py tourist Um_nik jiangly ksun48 Radewoosh"),
        ("With Invalid Handles", "python main.py tourist Um_nik jiangly ksun48 Radewoosh invalid1 invalid2"),
        ("10 Mixed Users", "python main.py tourist Um_nik jiangly ksun48 Radewoosh ecnerwala SecondThread pllk duality Swistakk"),
    ]

    for name, cmd in test_cases:
        run_test_case(name, cmd)
        time.sleep(1)  # avoid API rate limits


if __name__ == "__main__":
    main()