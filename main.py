"""
Codeforces Performance Analyzer — Main Pipeline

1. Data Collection   - Fetch TARGET user from Codeforces API (one user only)
2. Tag Analysis      - Compute target's tag strengths vs. a peer sample from CSV
3. KNN               - Find 50 nearest neighbors using tag strength feature vectors
4. Problem Finder    - Load neighbor submissions from CSV, find unsolved problems
5. Prioritization    - Rank problems by difficulty fit + weakness boost
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd

from pipeline.data_collection import DataCollector
from pipeline.feature_engineering import FeatureEngineer
from pipeline.model_inference import ModelInference
from pipeline.recommendation import RecommendationGenerator
from profiling.profiler import StageProfiler
from profiling.logger import PerformanceLogger
import src.pipeline.config as config

from ML.TagAnalyzer import analyze as tag_analyze, print_report
from ML.find_unsolved_problems import find_unsolved_problems
from ML.prioritize_problems import prioritize_problems

SUBMISSIONS_CSV = os.path.join(os.path.dirname(__file__), "ML", "dataset", "04_filtered_submissions.csv")
PROFILES_CSV    = os.path.join(os.path.dirname(__file__), "ML", "dataset", "02_user_profiles.csv")
DATASET_CSV     = os.path.join(os.path.dirname(__file__), "ML", "dataset", "06_user_tag_strengths.csv")


def _load_submissions_csv() -> pd.DataFrame:
    return pd.read_csv(SUBMISSIONS_CSV)


def main(user_handle: str, verbose: bool = True) -> dict:
    if verbose:
        print(f"\n{'='*60}")
        print(f"Codeforces Performance Analyzer")
        print(f"{'='*60}")
        print(f"Target User: {user_handle}")
        print(f"{'='*60}\n")

    logger = PerformanceLogger(config.PERFORMANCE_LOG_FILE)
    profiler = StageProfiler(logger)

    result = {
        "success": False,
        "target_user": user_handle,
        "error": None,
        "recommendation": None,
        "tag_strengths": {},
        "recommended_problems": [],
        "profiling": None,
    }

    try:
        # ── STAGE 1: Fetch target user from API ──────────────────────────────
        if verbose:
            print("[1/5] Data Collection - Fetching target user from Codeforces API...")

        with profiler.profile_data_collection(metadata={"target_user": user_handle}):
            collector = DataCollector()
            collected = collector.collect_data(user_handle)

        target_submission_rows = collected["target_user_submissions"]
        if verbose:
            print(f"[OK] Fetched {len(target_submission_rows)} submissions for {user_handle}")

        # ── STAGE 2: Compute target tag strengths ────────────────────────────
        if verbose:
            print("[2/5] Tag Analysis - Computing tag strengths vs. peer group...")

        tag_strengths = {}
        with profiler.profile_feature_engineering(metadata={"source": "TagAnalyzer + CSV peers"}):
            if target_submission_rows:
                # Load a sample of dataset submissions to use as the peer benchmark
                all_subs_df = _load_submissions_csv()
                # Use all CSV users as the peer group for benchmarking
                peer_handles = all_subs_df["handle"].unique().tolist()

                # Combine target rows with CSV rows into one DataFrame for TagAnalyzer
                target_df = pd.DataFrame(target_submission_rows)
                combined_df = pd.concat([target_df, all_subs_df], ignore_index=True)

                tag_strengths = tag_analyze(user_handle, combined_df, peer_handles)
                if verbose:
                    print_report(user_handle, tag_strengths)
            else:
                if verbose:
                    print("[WARNING] No submissions found — tag strengths will be zero")

        # ── STAGE 3: KNN — find 50 nearest neighbors ─────────────────────────
        if verbose:
            print("[3/5] KNN - Finding nearest neighbors from dataset...")

        with profiler.profile_model_inference(
            metadata={"k_neighbors": config.K_NEIGHBORS, "metric": config.KNN_METRIC}
        ):
            feature_engineer = FeatureEngineer()
            engineered = feature_engineer.engineer_features({
                "target_user_handle": user_handle,
                "target_tag_strengths": tag_strengths,
            })

            model = ModelInference(k=config.K_NEIGHBORS)
            inference_result = model.perform_inference(engineered)

        if verbose:
            print(f"[OK] Found {inference_result['num_neighbors_found']} nearest neighbors")
            print("  Top 5 neighbors:")
            for n in inference_result["neighbors"][:5]:
                print(f"    {n['rank']}. {n['user_handle']} (distance: {n['distance']:.4f})")

        # ── STAGE 4: Load neighbor submissions from CSV ───────────────────────
        if verbose:
            print("[4/5] Problem Finder - Loading neighbor submissions from CSV...")

        neighbor_handles = {n["user_handle"] for n in inference_result["neighbors"]}

        with profiler.profile_preprocessing(metadata={"source": "04_filtered_submissions.csv"}):
            all_subs_df = _load_submissions_csv()
            neighbor_subs_df = all_subs_df[all_subs_df["handle"].isin(neighbor_handles)]

        # Build target solved set
        target_solved_ids = {
            r["problem_id"] for r in target_submission_rows if r.get("is_ac") == 1
        }

        # Build problem_metadata from neighbor submissions
        problem_metadata: dict = {}
        tag_col_names = [c for c in neighbor_subs_df.columns if c.startswith("tag_")]
        for _, row in neighbor_subs_df.iterrows():
            pid = row["problem_id"]
            if pid not in problem_metadata and row.get("problem_rating", 0) > 0:
                tags = [c.replace("tag_", "") for c in tag_col_names if row[c] == 1]
                problem_metadata[pid] = {
                    "tags": tags,
                    "difficulty": int(row["problem_rating"]),
                    "name": row.get("problem_name", pid),
                }

        # Build neighbor dicts with solved sets and similarity weights
        neighbor_dicts = []
        for n in inference_result["neighbors"]:
            handle = n["user_handle"]
            weight = 1.0 / (n["distance"] + 1e-9)
            solved = set(
                neighbor_subs_df.loc[
                    (neighbor_subs_df["handle"] == handle) & (neighbor_subs_df["is_ac"] == 1),
                    "problem_id",
                ]
            )
            neighbor_dicts.append({"weight": weight, "solved_problems": solved})

        if verbose:
            print(f"[OK] Loaded submissions for {len(neighbor_handles)} neighbors, "
                  f"{len(problem_metadata)} unique problems in metadata")

        # ── STAGE 5: Prioritize unsolved problems ─────────────────────────────
        if verbose:
            print("[5/5] Prioritization - Ranking unsolved problems...")

        recommended_problems = []
        with profiler.profile_recommendation_generation(metadata={"limit": 200}):
            if neighbor_dicts and problem_metadata:
                unsolved = find_unsolved_problems(
                    target_solved_ids, neighbor_dicts, problem_metadata, limit=200
                )

                solved_for_rating = [
                    {"rating": r["problem_rating"]}
                    for r in target_submission_rows
                    if r.get("is_ac") == 1 and r.get("problem_rating", 0) > 0
                ]

                user_tag_strength_norm = {
                    tag: info["strength"] / 100.0
                    for tag, info in tag_strengths.items()
                }
                neighbor_tag_strength_norm = {
                    tag: info.get("peer_median_acceptance", 0.5)
                    for tag, info in tag_strengths.items()
                }

                problems_input = [
                    {
                        "id": p["problem_id"],
                        "rating": problem_metadata[p["problem_id"]]["difficulty"],
                        "tags": [f"tag_{t}" for t in p["tags"]],
                        "problem_score": p["score"],
                    }
                    for p in unsolved
                ]

                if problems_input:
                    recommended_problems = prioritize_problems(
                        problems_input,
                        solved_for_rating,
                        user_tag_strength_norm,
                        neighbor_tag_strength_norm,
                    )

        if verbose and recommended_problems:
            print(f"[OK] Top 10 recommended problems:")
            for i, p in enumerate(recommended_problems[:10], 1):
                name = problem_metadata.get(p["id"], {}).get("name", p["id"])
                print(f"  {i:>2}. [{p['rating']}] {name}  "
                      f"(success={p['success_prob']:.2f}, weakness={p['weakness_boost']:.2f})")

        # ── Save full output ──────────────────────────────────────────────────
        rec_generator = RecommendationGenerator(config.RECOMMENDATION_OUTPUT_FORMAT)
        final_recommendation = rec_generator.generate_and_save(
            inference_result,
            tag_strengths=tag_strengths,
            recommended_problems=recommended_problems,
        )
        if verbose:
            print(f"\n[OK] Results saved to {config.RECOMMENDATION_OUTPUT_FILE}")

        # ── Finalize profiling ────────────────────────────────────────────────
        profiler.finalize_run(user_handle, num_neighbors=inference_result["num_neighbors_found"])
        profiler.save_run()
        profiling_summary = logger.get_current_run()

        if verbose:
            print(f"\n{'='*60}")
            print("Performance Summary:")
            print(f"{'='*60}")
            if "summary" in profiling_summary:
                s = profiling_summary["summary"]
                print(f"Total Time:   {s['total_execution_time_seconds']:.2f}s")
                print(f"Total Memory: {s.get('total_memory_used_mb', 'N/A')} MB")
            for stage in profiling_summary["stages"]:
                print(f"  {stage['stage']}: {stage['execution_time_seconds']:.3f}s")
            print(f"{'='*60}\n")

        result["success"] = True
        result["recommendation"] = final_recommendation
        result["tag_strengths"] = tag_strengths
        result["recommended_problems"] = recommended_problems
        result["profiling"] = profiling_summary

    except Exception as e:
        result["error"] = str(e)
        if verbose:
            print(f"\n[ERROR] {e}")
        import traceback
        traceback.print_exc()

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python main.py <codeforces_handle>")
        print("       python main.py o.khalifa")
        sys.exit(1)

    res = main(sys.argv[1], verbose=True)
    sys.exit(0 if res.get("success") else 1)
