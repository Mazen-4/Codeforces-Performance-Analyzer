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
import re

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
from scripts.db.connection import get_engine, use_postgres

SUBMISSIONS_CSV = os.path.join(os.path.dirname(__file__), "ML", "dataset", "04_filtered_submissions.csv")
PROFILES_CSV    = os.path.join(os.path.dirname(__file__), "ML", "dataset", "02_user_profiles.csv")
DATASET_CSV     = os.path.join(os.path.dirname(__file__), "ML", "dataset", "06_user_tag_strengths.csv")


def _load_submissions_csv(handles: set | None = None) -> pd.DataFrame:
    """Load submissions for the given handles.

    Reads from Postgres when DATABASE_URL is configured, else falls back to
    04_filtered_submissions.csv. The name is kept for its callers; the CSV is
    now the fallback path, not the primary one.

    The dataset is ~1.5 GB and grows every week, so the full file is never
    loaded: Postgres answers this with an index lookup on handle, and the CSV
    path filters during a chunked read.
    """
    if use_postgres():
        return _load_submissions_pg(handles)

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


def _load_submissions_pg(handles: set | None) -> pd.DataFrame:
    """Submissions for `handles` from Postgres, as an indexed lookup."""
    from sqlalchemy import text

    engine = get_engine()
    if handles is None:
        # 14M rows would exhaust the container. Callers always pass a handle
        # set; guard rather than let this silently become a full scan.
        raise ValueError(
            "_load_submissions_csv(handles=None) would read the entire "
            "submissions table (~14M rows). Pass an explicit handle set."
        )
    if not handles:
        handles = set()

    sql = text("SELECT * FROM submissions WHERE handle = ANY(:handles)")
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn, params={"handles": list(handles)})
    return df


def _fetch_live_ratings(handles: list) -> dict:
    """Ratings straight from the Codeforces API, for handles we lack locally.

    user_profiles covers only ~10% of reference users, so the rating penalty
    was inert for most candidates — tourist (3307) was matched to a 1362.
    Codeforces accepts up to ~300 handles per call, so filling the gap for a
    shortlist costs one request.
    """
    if not handles:
        return {}
    import urllib.request, urllib.parse, json as _json
    out = {}
    CHUNK = 250
    for i in range(0, len(handles), CHUNK):
        batch = [h for h in handles[i:i + CHUNK]
                 if re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{1,23}", str(h))]
        if not batch:
            continue
        url = ("https://codeforces.com/api/user.info?handles="
               + urllib.parse.quote(";".join(batch)))
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                data = _json.loads(r.read())
            if data.get("status") == "OK":
                for u in data.get("result", []):
                    if u.get("rating"):
                        out[u["handle"]] = int(u["rating"])
        except Exception:
            # One deleted handle fails the whole batch; a missing rating just
            # means no penalty for that user, so carry on.
            continue
    return out


def _load_peer_scale(handles: list) -> tuple:
    """Solve counts and ratings for the reference users, in handle order.

    Solve counts exist for ~99.6% of reference users; ratings for only ~10%,
    because user_profiles is sparse. A missing value is returned as 0 and the
    caller disables that penalty for the user rather than guessing.
    """
    solved_map, rating_map = {}, {}
    try:
        if use_postgres():
            from sqlalchemy import text
            with get_engine().connect() as conn:
                solved_map = dict(conn.execute(text(
                    "SELECT handle, count(DISTINCT problem_id) FROM submissions "
                    "WHERE is_ac = 1 GROUP BY handle")).fetchall())
                rating_map = dict(conn.execute(text(
                    "SELECT handle, cf_rating FROM user_profiles "
                    "WHERE cf_rating > 0")).fetchall())
        else:
            if os.path.exists(SUBMISSIONS_CSV):
                counts = {}
                for chunk in pd.read_csv(SUBMISSIONS_CSV,
                                         usecols=["handle", "problem_id", "is_ac"],
                                         chunksize=200_000):
                    ac = chunk[chunk["is_ac"] == 1]
                    for h, g in ac.groupby("handle")["problem_id"]:
                        counts.setdefault(h, set()).update(g)
                solved_map = {h: len(v) for h, v in counts.items()}
            if os.path.exists(PROFILES_CSV):
                df = pd.read_csv(PROFILES_CSV, usecols=["handle", "cf_rating"])
                rating_map = {r.handle: int(r.cf_rating)
                              for r in df.itertuples() if r.cf_rating > 0}
    except Exception:
        return None, None

    import numpy as _np
    solved = _np.array([solved_map.get(h, 0) for h in handles], dtype=_np.float64)
    ratings = _np.array([rating_map.get(h, 0) for h in handles], dtype=_np.float64)
    return solved, ratings


def _load_peer_ratings(handles: set) -> dict:
    """cf_rating for the given handles, where the profiles table has one.

    Only ~10% of reference users carry a profile row, so a missing handle is
    normal and maps to None rather than 0 (which would read as "unrated").
    """
    if not handles:
        return {}
    try:
        if use_postgres():
            from sqlalchemy import text
            sql = text("SELECT handle, cf_rating FROM user_profiles "
                       "WHERE handle = ANY(:handles)")
            with get_engine().connect() as conn:
                rows = conn.execute(sql, {"handles": list(handles)}).fetchall()
            return {r[0]: (int(r[1]) if r[1] and r[1] > 0 else None) for r in rows}
        if os.path.exists(PROFILES_CSV):
            df = pd.read_csv(PROFILES_CSV, usecols=["handle", "cf_rating"])
            df = df[df["handle"].isin(handles)]
            return {r.handle: (int(r.cf_rating) if r.cf_rating > 0 else None)
                    for r in df.itertuples()}
    except Exception:
        pass
    return {}


def _load_tag_strengths(handles: set | None = None) -> pd.DataFrame:
    """Load 06_user_tag_strengths rows, from Postgres when configured.

    Previously read the whole 15 MB CSV on every request just to filter it to
    ~50 neighbour handles; now the filter happens in the query.
    """
    if use_postgres():
        from sqlalchemy import text
        engine = get_engine()
        if handles:
            sql = text("SELECT * FROM user_tag_strengths WHERE handle = ANY(:handles)")
            params = {"handles": list(handles)}
        else:
            sql = text("SELECT * FROM user_tag_strengths")
            params = {}
        with engine.connect() as conn:
            return pd.read_sql(sql, conn, params=params)

    df = pd.read_csv(DATASET_CSV)
    if handles:
        df = df[df["handle"].isin(handles)]
    return df


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
        "peers": [],
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

            # Scale context: peers should be comparable in size, not only in
            # shape. Without this the search drifts toward sparse accounts,
            # because volume_score saturates at 50 solves per tag.
            try:
                target_solved = int(
                    pd.DataFrame(target_submission_rows)
                      .query("is_ac == 1")["problem_id"].nunique()
                ) if target_submission_rows else 0
                ds_handles = list(engineered["dataset_handles"])
                solved_arr, ratings_arr = _load_peer_scale(ds_handles)
                if solved_arr is not None:
                    # Pass 1: rank on solving profile + volume only, to get a
                    # shortlist of plausible peers.
                    model.set_profile_context(
                        solved_counts=solved_arr, ratings=ratings_arr,
                        target_solved=target_solved, target_rating=cf_rating,
                    )
                    if cf_rating > 0:
                        import numpy as _np
                        shortlist_n = min(400, len(ds_handles))
                        pre = model.model  # inner KNN, for a cheap first pass
                        pre.fit(engineered["feature_matrix"])
                        _, pre_idx = pre.predict(target_features)
                        # predict() returns only k; rank the wider pool here.
                        d = _np.linalg.norm(
                            engineered["feature_matrix"] - target_features, axis=1)
                        safe = _np.maximum(solved_arr, 1.0)
                        volpen = _np.where(
                            solved_arr > 0,
                            _np.abs(_np.log(safe / max(target_solved, 1))), 3.0)
                        order = _np.argsort(d + pre.VOLUME_PENALTY_WEIGHT * volpen)
                        short = order[:shortlist_n]

                        # Pass 2: fill missing ratings for the shortlist only,
                        # so the rating penalty is not inert.
                        missing = [ds_handles[i] for i in short if ratings_arr[i] <= 0]
                        if missing:
                            live = _fetch_live_ratings(missing)
                            if live:
                                for i in short:
                                    h = ds_handles[i]
                                    if ratings_arr[i] <= 0 and h in live:
                                        ratings_arr[i] = live[h]
                                if verbose:
                                    print(f"[OK] Fetched {len(live)} peer ratings "
                                          f"from Codeforces")
                                model.set_profile_context(
                                    solved_counts=solved_arr, ratings=ratings_arr,
                                    target_solved=target_solved,
                                    target_rating=cf_rating,
                                )
                    if verbose:
                        known = int((ratings_arr > 0).sum())
                        print(f"[OK] Scale context: you solved {target_solved}; "
                              f"ratings known for {known}/{len(ratings_arr)} peers")
            except Exception as ctx_err:
                if verbose:
                    print(f"[WARN] scale context unavailable: {ctx_err}")

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
            n["solved_count"] = len(solved)

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

                tag_strengths_csv = _load_tag_strengths(neighbor_handles)
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

        # Top 10 nearest neighbours, for the Pro "who you were compared with"
        # panel. Ratings exist for only ~10% of reference users, so the field
        # is left null rather than guessed when it is unknown.
        try:
            top_peers = sorted(
                inference_result["neighbors"], key=lambda n: n["rank"]
            )[:10]
            peer_ratings = _load_peer_ratings({p["user_handle"] for p in top_peers})
            result["peers"] = [
                {
                    "rank":       p["rank"],
                    "handle":     p["user_handle"],
                    "similarity": round(float(p["display_similarity"]), 1),
                    "solved":     int(p.get("solved_count") or 0),
                    "rating":     peer_ratings.get(p["user_handle"]),
                }
                for p in top_peers
            ]
        except Exception as peer_err:   # never fail an analysis over this panel
            if verbose:
                print(f"[WARN] could not build peer list: {peer_err}")

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
