"""
Codeforces Performance Analyzer — Main Pipeline

1. Data Collection   - Fetch TARGET user from Codeforces API
2. Feature Building  - Compute 120-dim feature vector (6 scores × 20 tags) from submissions
3. KNN               - Find 50 nearest neighbors using the feature vector
4. Tag Re-analysis   - Benchmark tag strengths vs. actual KNN neighbors
5. Problem Finder    - Load neighbor submissions from CSV, find unsolved problems
6. Prioritization    - Rank problems by difficulty fit + weakness boost
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd

from pipeline.data_collection import DataCollector
from pipeline.feature_engineering import FeatureEngineer, compute_target_features
from pipeline.model_inference import ModelInference
from pipeline.recommendation import RecommendationGenerator
from profiling.profiler import StageProfiler
from profiling.logger import PerformanceLogger
import src.pipeline.config as config

from ML.inference.TagAnalyzer import analyze as tag_analyze, print_report
from ML.inference.find_unsolved_problems import find_unsolved_problems
from ML.inference.prioritize_problems import prioritize_problems
from ML.inference.counterfactual_tag_impact import compute_tag_impact
from ML.inference.predict_attempts import estimate_attempts

SUBMISSIONS_CSV = os.path.join(os.path.dirname(__file__), "ML", "dataset", "04_filtered_submissions.csv")
PROFILES_CSV    = os.path.join(os.path.dirname(__file__), "ML", "dataset", "02_user_profiles.csv")
DATASET_CSV     = os.path.join(os.path.dirname(__file__), "ML", "dataset", "06_user_tag_strengths.csv")


def _load_submissions_csv(handles: set | None = None) -> pd.DataFrame:
    """Load 04_filtered_submissions.csv.

    When `handles` is given, filter to those handles *during* the read in chunks so
    peak memory stays at one chunk (~a few MB) instead of the full ~100 MB file.
    This keeps the web pipeline under tight container memory limits (e.g. Railway).
    """
    if handles is None:
        return pd.read_csv(SUBMISSIONS_CSV)

    parts = []
    for chunk in pd.read_csv(SUBMISSIONS_CSV, chunksize=100_000):
        keep = chunk[chunk["handle"].isin(handles)]
        if not keep.empty:
            parts.append(keep)
    if parts:
        return pd.concat(parts, ignore_index=True)
    # Preserve column schema even when no rows match
    return pd.read_csv(SUBMISSIONS_CSV, nrows=0)


def _compute_tag_strength_for_model(submission_rows: list, cf_rating: int, cf_max_rating: int) -> dict:
    """Compute tag_strength using the exact same formula as strength.py / 06_user_tag_strengths.csv.
    Returns dict: tag_name -> tag_strength in [0, 1], matching training-time feature scale."""
    TAG_COLS_LOCAL = [
        "tag_dp", "tag_greedy", "tag_graphs", "tag_math", "tag_strings",
        "tag_impl", "tag_binary_search", "tag_data_structures", "tag_number_theory",
        "tag_combinatorics", "tag_geometry", "tag_trees", "tag_sortings",
        "tag_two_pointers", "tag_bitmasks", "tag_flows", "tag_fft",
        "tag_games", "tag_probabilities", "tag_constructive",
    ]
    MAX_RATING = 3500
    SMOOTHING  = 2
    WEIGHTS = {
        "acceptance_rate":      0.30,
        "difficulty_score":     0.30,
        "rating_boost":         0.20,
        "specialization_score": 0.10,
        "efficiency_score":     0.075,
        "volume_score":         0.075,
    }

    if not submission_rows:
        return {t: 0.0 for t in TAG_COLS_LOCAL}

    df = pd.DataFrame(submission_rows)
    required = {"problem_id", "problem_rating", "is_ac"}
    if not required.issubset(df.columns):
        return {t: 0.0 for t in TAG_COLS_LOCAL}

    # Deduplicate to one row per problem (max is_ac) — same as training
    per_prob = df.groupby("problem_id").agg(
        is_ac=("is_ac", "max"),
        problem_rating=("problem_rating", "first"),
        **{t: (t, "first") for t in TAG_COLS_LOCAL if t in df.columns},
    ).reset_index()

    # User-level signals
    total_ac       = int(per_prob["is_ac"].sum())
    # first_try_rate: fraction of problems solved on the first attempt
    # approximate from raw rows: problem solved and only 1 submission for it
    attempts_per_prob = df.groupby("problem_id")["is_ac"].count()
    solved_probs      = per_prob[per_prob["is_ac"] == 1]["problem_id"]
    first_tries       = (attempts_per_prob[solved_probs] == 1).sum() if len(solved_probs) > 0 else 0
    first_try_rate    = float(first_tries / len(solved_probs)) if len(solved_probs) > 0 else 0.0

    df = per_prob  # work on deduplicated data from here

    result = {}
    for tag in TAG_COLS_LOCAL:
        if tag not in df.columns:
            result[tag] = 0.0
            continue

        tag_rows = df[df[tag] == 1]
        if tag_rows.empty:
            result[tag] = 0.0
            continue

        ac_mask        = tag_rows["is_ac"] == 1
        total_attempts = len(tag_rows)
        ac_count       = int(ac_mask.sum())
        solved_ratings = tag_rows.loc[ac_mask, "problem_rating"]

        acceptance_rate  = (ac_count + SMOOTHING * 0.5) / (total_attempts + SMOOTHING)
        difficulty_score = float(solved_ratings.mean() / MAX_RATING) if ac_count > 0 else 0.0
        rating_boost     = min((cf_rating + cf_max_rating) / (2 * MAX_RATING), 1.0)
        efficiency_score = min(first_try_rate, 1.0)
        volume_score     = min(__import__("math").log1p(ac_count) / __import__("math").log1p(50), 1.0)
        specialization   = min(ac_count / total_ac, 1.0) if total_ac > 0 else 0.0

        tag_strength = (
            acceptance_rate  * WEIGHTS["acceptance_rate"]  +
            difficulty_score * WEIGHTS["difficulty_score"] +
            rating_boost     * WEIGHTS["rating_boost"]     +
            specialization   * WEIGHTS["specialization_score"] +
            efficiency_score * WEIGHTS["efficiency_score"] +
            volume_score     * WEIGHTS["volume_score"]
        )
        result[tag] = float(min(max(tag_strength, 0.0), 1.0))

    return result


# verbose = True for detailed output, False for silent execution (e.g., API mode)
def main(user_handle: str, verbose: bool = True) -> dict:
    if verbose:
        print(f"\n{'='*60}")
        print(f"Codeforces Performance Analyzer")
        print(f"{'='*60}")
        print(f"Target User: {user_handle}")
        print(f"{'='*60}\n")

    for _f in (config.PERFORMANCE_LOG_FILE, config.RECOMMENDATION_OUTPUT_FILE):
        if os.path.exists(_f):
            os.remove(_f)

    logger   = PerformanceLogger(config.PERFORMANCE_LOG_FILE)
    profiler = StageProfiler(logger)

    result = {
        "success": False,
        "target_user": user_handle,
        "error": None,
        "recommendation": None,
        "tag_strengths": {},
        "recommended_problems": [],
        "tag_impact": [],
        "problem_attempts": [],
        "profiling": None,
    }

    try:


        # ── STAGE 1: Fetch target user from API ──────────────────────────────
        if verbose:
            print("[1/6] Data Collection - Fetching target user from Codeforces API...")

        with profiler.profile_data_collection(metadata={"target_user": user_handle}):
            collector = DataCollector()
            collected = collector.collect_data(user_handle)

        target_submission_rows = collected["target_user_submissions"]
        user_info              = collected["target_user_info"]
        cf_rating     = user_info.get("rating", 0) or 0
        cf_max_rating = user_info.get("maxRating", 0) or 0

        if verbose:
            print(f"[OK] Fetched {len(target_submission_rows)} submissions for {user_handle} "
                  f"(rating: {cf_rating}, max: {cf_max_rating})")




        # ── STAGE 2: Build 82-dim feature vector for KNN ─────────────────────
        if verbose:
            print("[2/6] Feature Building - Computing 4-score × 20-tag + 2 user-level feature vector...")

        with profiler.profile_feature_engineering(
            metadata={"source": "strength.py formula", "dims": 82}
        ):
            target_features = compute_target_features(
                target_submission_rows, cf_rating, cf_max_rating
            )

        if verbose:
            print(f"[OK] Built {len(target_features)}-dim feature vector")




        # ── STAGE 3: KNN — find 50 nearest neighbors ─────────────────────────
        if verbose:
            print("[3/6] KNN - Finding nearest neighbors from dataset...")

        with profiler.profile_model_inference(
            metadata={"k_neighbors": config.K_NEIGHBORS, "metric": config.KNN_METRIC}
        ):
            feature_engineer = FeatureEngineer()
            engineered = feature_engineer.engineer_features({
                "target_user_handle": user_handle,
                "target_features":    target_features,
            })

            model = ModelInference(k=config.K_NEIGHBORS)
            inference_result = model.perform_inference(engineered)

        if verbose:
            print(f"[OK] Found {inference_result['num_neighbors_found']} nearest neighbors")
            print("  Top 50 neighbors:")
            for n in inference_result["neighbors"][:50]:
                print(f"    {n['rank']}. {n['user_handle']} (similarity: {n['display_similarity']:.1f}%)")



        # ── STAGE 4: Benchmark tag strengths vs. actual KNN neighbors ─────────
        if verbose:
            print("[4/6] Tag analysis - Benchmarking tag strengths vs. KNN neighbors...")

        neighbor_handles = {n["user_handle"] for n in inference_result["neighbors"]}
        tag_strengths    = {}

        # Filter to neighbor rows during the CSV read — never hold the full file in memory.
        neighbor_subs_df = _load_submissions_csv(neighbor_handles)

        if target_submission_rows:
            # convert user submissions from API response to DataFrame
            target_df           = pd.DataFrame(target_submission_rows)

            # combine target user submissions with neighbor submissions
            combined_neighbor_df = pd.concat([target_df, neighbor_subs_df], ignore_index=True)

            tag_strengths = tag_analyze(user_handle, combined_neighbor_df, list(neighbor_handles))
            if verbose:
                print_report(user_handle, tag_strengths)
        else:
            if verbose:
                print("[WARNING] No submissions — tag strengths will be zero")



        # ── STAGE 5: Load neighbor submissions, build problem pool ────────────
        if verbose:
            print("[5/6] Problem Finder - Loading neighbor submissions from CSV...")

        with profiler.profile_preprocessing(metadata={"source": "04_filtered_submissions.csv"}):
            # neighbor_subs_df was already filtered to neighbor_handles during the chunked
            # read above; no full-file DataFrame exists to re-filter here.
            pass

        # Build set of problem IDs solved by target user for quick lookup
        target_solved_ids = {
            r["problem_id"] for r in target_submission_rows if r.get("is_ac") == 1
        }
        num_solved = len(target_solved_ids)

        problem_metadata: dict = {}

        tag_col_names = [c for c in neighbor_subs_df.columns if c.startswith("tag_")]
        
        # Extract problem metadata (tags, difficulty) for all problems solved by neighbors
        for _, row in neighbor_subs_df.iterrows():
            pid = row["problem_id"]
            if pid not in problem_metadata and row.get("problem_rating", 0) > 0:
                # extract tags from columns where value is 1
                tags = [c.replace("tag_", "") for c in tag_col_names if row[c] == 1]
                problem_metadata[pid] = {
                    "tags":       tags,
                    "difficulty": int(row["problem_rating"]),
                    "name":       row.get("problem_name", pid),
                }

        neighbor_dicts = []
        # Build list of neighbor dicts with weights and solved problem sets
        for n in inference_result["neighbors"]:
            handle = n["user_handle"]
            weight = n["similarity"] / 100.0
            # find problems solved by this neighbor using the neighbor_subs_df DataFrame
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



        # ── STAGE 6: Prioritize unsolved problems ─────────────────────────────
        if verbose:
            print("[6/6] Prioritization - Ranking unsolved problems...")

        recommended_problems = []
        tag_impact           = []
        problem_attempts     = []
        with profiler.profile_recommendation_generation(metadata={"limit": 200}):
            if neighbor_dicts and problem_metadata:
                unsolved = find_unsolved_problems(
                    target_solved_ids, neighbor_dicts, problem_metadata, limit=200
                )

                # Use the same tag_strength formula as training data (strength.py)
                user_tag_strength_norm = _compute_tag_strength_for_model(
                    target_submission_rows, cf_rating, cf_max_rating
                )

                tag_strengths_csv = pd.read_csv(DATASET_CSV)
                # Build a map of neighbor handle → similarity weight
                neighbor_sim_map = {
                    n["user_handle"]: n["display_similarity"] / 100.0
                    for n in inference_result["neighbors"]
                }

                # Similarity-weighted average of neighbor tag strengths
                neighbor_tag_strength_norm = {}
                for tag in user_tag_strength_norm:
                    tag_rows = tag_strengths_csv[
                        (tag_strengths_csv["handle"].isin(neighbor_handles)) &
                        (tag_strengths_csv["tag"] == tag)
                    ]
                    total_weight, weighted_sum = 0.0, 0.0
                    for _, row in tag_rows.iterrows():
                        w = neighbor_sim_map.get(row["handle"], 0.0)
                        weighted_sum += w * float(row["tag_strength"])
                        total_weight += w
                    neighbor_tag_strength_norm[tag] = (
                        weighted_sum / total_weight if total_weight > 0 else 0.5
                    )

                problems_input = [
                    {
                        "id":           p["problem_id"],
                        "rating":       problem_metadata[p["problem_id"]]["difficulty"],
                        "tags":         [f"tag_{t}" for t in p["tags"]],
                        "problem_score": p["score"],
                    }
                    for p in unsolved
                ]

                if problems_input:
                    recommended_problems = prioritize_problems(
                        problems_input,
                        cf_rating,
                        user_tag_strength_norm,
                        neighbor_tag_strength_norm,
                        num_solved=num_solved,
                    )

        if verbose and recommended_problems:
            print(f"[OK] Top 10 recommended problems:")
            for i, p in enumerate(recommended_problems[:10], 1):
                name = problem_metadata.get(p["id"], {}).get("name", p["id"])
                print(f"  {i:>2}. [{p['rating']}] {name}  "
                      f"(score={p['final_score']:.2f}, difficulty_match={p['difficulty_match']:.2f}, weakness={p['weakness_boost']:.2f})")


        # ── Counterfactual Tag Impact ─────────────────────────────────────────
        tag_impact = []
        if problems_input:
            if verbose:
                print("[+] Counterfactual Analysis - Computing per-tag rating gain potential...")

            tag_impact = compute_tag_impact(
                problems=problems_input,
                cf_rating=cf_rating,
                user_tag_strength=user_tag_strength_norm,
                num_solved=num_solved,
            )

            if verbose:
                top = [t for t in tag_impact if t["delta_problems"] > 0][:5]
                for t in top:
                    print(f"     {t['label']:20s} +{t['delta_problems']} problems  "
                          f"≈ +{t['estimated_rating_gain']} rating")


        # ── Model 3: Estimate attempts for top recommended problems ───────────
        problem_attempts = []
        if recommended_problems:
            if verbose:
                print("[+] Attempts Estimator - Estimating solve difficulty for top problems...")
            top_problems = recommended_problems[:50]
            problem_attempts = estimate_attempts(
                problems=top_problems,
                cf_rating=cf_rating,
                user_tag_strength=user_tag_strength_norm,
                num_solved=num_solved,
            )
            attempts_map = {a["id"]: a for a in problem_attempts}
            # Annotate recommended_problems with attempts estimate
            for p in recommended_problems:
                est = attempts_map.get(p["id"])
                if est:
                    p["estimated_attempts"]  = est["estimated_attempts"]
                    p["difficulty_label"]    = est["difficulty_label"]

            if verbose:
                easy   = sum(1 for a in problem_attempts if a["difficulty_label"] == "easy")
                moderate = sum(1 for a in problem_attempts if a["difficulty_label"] == "moderate")
                hard   = sum(1 for a in problem_attempts if a["difficulty_label"] == "hard")
                print(f"[OK] Top-50 problems: {easy} easy, {moderate} moderate, {hard} hard")


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

        result["success"]              = True
        result["recommendation"]       = final_recommendation
        result["tag_strengths"]        = tag_strengths
        result["recommended_problems"] = recommended_problems
        result["tag_impact"]           = tag_impact
        result["problem_attempts"]     = problem_attempts
        result["profiling"]            = profiling_summary

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
