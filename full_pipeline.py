"""
CF Analyzer — Full Pipeline
============================
This single file covers every step of the project:

  Phase 1: Data Collection   — fetch user submissions from Codeforces API
  Phase 2: Data Cleaning     — remove noise, deduplicate, filter weak users
  Phase 3: Tag Strength      — compute per-(user, tag) skill scores from submissions
  Phase 4: Feature Building  — turn tag scores into an 82-dim KNN vector
  Phase 5: KNN Inference     — find the 50 most similar users in the dataset
  Phase 6: Tag Analysis      — re-score tags relative to the 50 peers
  Phase 7: Problem Pool      — collect unsolved problems from neighbors
  Phase 8: Problem Ranking   — rank problems using success model + weakness boost
  Phase 9: Counterfactual    — estimate rating gain from improving each tag
  Phase 10: Training         — train all three LightGBM models from scratch

Run modes
---------
  python pipeline.py analyze <handle>   → run phases 1-9 for a user
  python pipeline.py train              → run phase 10 (retrain models)

Dependencies: requests, pandas, numpy, lightgbm, scikit-learn, pickle
"""

import os
import sys
import math
import pickle
import requests
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score, roc_auc_score

def eprint(*args, **kwargs):
    """Print to stderr so stdout stays clean for JSON output."""
    print(*args, file=sys.stderr, **kwargs)

# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(BASE_DIR, "ML", "dataset")
MODEL_DIR   = os.path.join(BASE_DIR, "ML", "models")

SUBMISSIONS_CSV  = os.path.join(DATASET_DIR, "04_filtered_submissions.csv")
PROFILES_CSV     = os.path.join(DATASET_DIR, "02_user_profiles.csv")
STRENGTHS_CSV    = os.path.join(DATASET_DIR, "06_user_tag_strengths.csv")
ENRICHED_CSV     = os.path.join(DATASET_DIR, "07_enriched_user_profiles.csv")

SUCCESS_MODEL_PATH     = os.path.join(MODEL_DIR, "success_model.pkl")
ATTEMPTS_MODEL_PATH    = os.path.join(MODEL_DIR, "attempts_model.pkl")
PROGRESSION_MODEL_PATH = os.path.join(MODEL_DIR, "rating_progression_model.pkl")

CF_API = "https://codeforces.com/api"

# The 20 problem tags the system tracks
TAG_COLS = [
    "tag_dp", "tag_greedy", "tag_graphs", "tag_math", "tag_strings",
    "tag_impl", "tag_binary_search", "tag_data_structures", "tag_number_theory",
    "tag_combinatorics", "tag_geometry", "tag_trees", "tag_sortings",
    "tag_two_pointers", "tag_bitmasks", "tag_flows", "tag_fft",
    "tag_games", "tag_probabilities", "tag_constructive",
]

# Human-readable label for each tag (used in printed output)
TAG_LABELS = {
    "tag_dp": "Dynamic Programming", "tag_greedy": "Greedy", "tag_graphs": "Graphs",
    "tag_math": "Math", "tag_strings": "Strings", "tag_impl": "Implementation",
    "tag_binary_search": "Binary Search", "tag_data_structures": "Data Structures",
    "tag_number_theory": "Number Theory", "tag_combinatorics": "Combinatorics",
    "tag_geometry": "Geometry", "tag_trees": "Trees", "tag_sortings": "Sortings",
    "tag_two_pointers": "Two Pointers", "tag_bitmasks": "Bitmasks",
    "tag_flows": "Flows", "tag_fft": "FFT", "tag_games": "Games",
    "tag_probabilities": "Probabilities", "tag_constructive": "Constructive",
}

# Codeforces tag names → our internal tag column names
CF_TAG_MAP = {
    "dp": "tag_dp", "greedy": "tag_greedy", "graphs": "tag_graphs",
    "dfs and similar": "tag_graphs", "shortest paths": "tag_graphs",
    "math": "tag_math", "strings": "tag_strings",
    "implementation": "tag_impl", "binary search": "tag_binary_search",
    "data structures": "tag_data_structures", "number theory": "tag_number_theory",
    "combinatorics": "tag_combinatorics", "geometry": "tag_geometry",
    "trees": "tag_trees", "sortings": "tag_sortings",
    "two pointers": "tag_two_pointers", "bitmasks": "tag_bitmasks",
    "flows": "tag_flows", "fft": "tag_fft", "games": "tag_games",
    "probabilities": "tag_probabilities",
    "constructive algorithms": "tag_constructive",
}

# Weights for the tag strength formula (must sum to 1.0)
STRENGTH_WEIGHTS = {
    "acceptance_rate":      0.30,
    "difficulty_score":     0.30,
    "rating_boost":         0.20,
    "specialization_score": 0.10,
    "efficiency_score":     0.075,
    "volume_score":         0.075,
}

K_NEIGHBORS  = 50   # number of similar users to find
MAX_RATING   = 3500  # Codeforces max rating (used for normalization)
WA_PENALTY   = 0.2   # penalty per wrong answer in solve_score formula


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 1: DATA COLLECTION
# Fetch the target user's submissions and profile from the Codeforces API.
# Only the TARGET user is fetched live — dataset users are pre-computed in CSVs.
# ─────────────────────────────────────────────────────────────────────────────

def fetch_user_info(handle):
    """Return (cf_rating, cf_max_rating) for the given handle."""
    print(f"[Phase 1] Fetching profile for '{handle}'...")

    # API: https://codeforces.com/api/user.info?handles=handle
    resp = requests.get(f"{CF_API}/user.info", params={"handles": handle}, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    if data["status"] != "OK":
        raise ValueError(f"Codeforces API error: {data.get('comment', 'unknown')}")
    user = data["result"][0]
    return user.get("rating", 0), user.get("maxRating", 0)


def fetch_user_submissions(handle, count=500):
    """
    Fetch the latest `count` submissions for the user.
    Returns a list of flat dicts with binary tag flags.
    Each row represents ONE individual submission (not deduplicated).
    Multiple rows per problem are intentional — the strength formula needs raw attempt counts.
    """
    print(f"[Phase 1] Fetching last {count} submissions for '{handle}'...")

    # API: https://codeforces.com/api/user.status?handle=handle&count=count
    resp = requests.get(
        f"{CF_API}/user.status",
        params={"handle": handle, "count": count},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if data["status"] != "OK":
        raise ValueError(f"Codeforces API error: {data.get('comment', 'unknown')}")

    rows = []
    for sub in data["result"]:
        # Skip practice-only verdicts that aren't AC or WA
        verdict = sub.get("verdict", "")
        if verdict not in ("OK", "WRONG_ANSWER", "TIME_LIMIT_EXCEEDED",
                           "MEMORY_LIMIT_EXCEEDED", "RUNTIME_ERROR"):
            continue

        problem = sub.get("problem", {})
        rating  = problem.get("rating", 0)
        pid     = f"{problem.get('contestId', '')}_{problem.get('index', '')}"

        is_ac = 1 if verdict == "OK" else 0
        is_wa = 0 if verdict == "OK" else 1  # WA, TLE, MLE, RE all count as WA

        # Build binary tag flags
        row = {
            "handle":         handle,
            "problem_id":     pid,
            "problem_name":   problem.get("name", ""),
            "problem_rating": rating,
            "is_ac":          is_ac,
            "is_wa":          is_wa,
        }
        
        cf_tags = []
        for t in problem.get("tags", []):
            t_lower = t.lower()
            cf_tags.append(t_lower)
        
        # Initialize all tag columns to 0
        for tag_col in TAG_COLS:
            row[tag_col] = 0

        # Map Codeforces tags to our internal tag columns
        for cf_tag in cf_tags:
            mapped = CF_TAG_MAP.get(cf_tag)
            if mapped:
                row[mapped] = 1

        rows.append(row)

    print(f"[Phase 1] Got {len(rows)} raw submissions")
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 2: DATA CLEANING
# Deduplicate submissions (keep one row per problem), remove unrated problems,
# and for dataset users, remove those with fewer than 30 accepted solutions.
# ─────────────────────────────────────────────────────────────────────────────

def clean_submissions(rows):
    """
    Convert a list of raw submission dicts into a clean DataFrame.
    One row per (handle, problem_id), keeping the best result (max is_ac).
    Unrated problems (rating=0) are dropped.
    """
    df = pd.DataFrame(rows)
    if df.empty:
        return df

    # One row per (handle, problem) — if the user ever accepted it, mark as AC
    df = (
        df.groupby(["handle", "problem_id"], sort=False)
        .agg(
            problem_name   = ("problem_name",   "first"),
            problem_rating = ("problem_rating",  "first"),
            is_ac          = ("is_ac",           "max"),
            is_wa          = ("is_wa",           "sum"),
            **{t: (t, "first") for t in TAG_COLS},
        )
        .reset_index()
    )

    # Drop problems with no official rating
    before = len(df)
    df = df[df["problem_rating"] > 0].copy()
    print(f"[Phase 2] Dropped {before - len(df)} unrated problems, kept {len(df)}")
    return df


def clean_dataset_handles(df, col="handle"):
    """
    Remove rows where Excel corrupted the handle to '#NAME?'.
    This happens when handles start with special characters like =, +, -.
    """
    df = df[df[col] != "#NAME?"].copy()
    df[col] = df[col].astype(str).str.strip().str.lstrip("=+-@")
    df = df[df[col].str.len() > 0].reset_index(drop=True)
    return df


def filter_dataset_users(df_subs, min_accepted=30):
    """
    Remove dataset users with fewer than `min_accepted` accepted solutions.
    We only train and do KNN on users with enough data to be meaningful.
    """
    ac_counts = df_subs[df_subs["is_ac"] == 1].groupby("handle").size()
    good_handles = ac_counts[ac_counts >= min_accepted].index
    before = df_subs["handle"].nunique()
    df_subs = df_subs[df_subs["handle"].isin(good_handles)].copy()
    after = df_subs["handle"].nunique()
    print(f"[Phase 2] Filtered to users with >= {min_accepted} AC: {before} → {after} users")
    return df_subs


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 3: TAG STRENGTH COMPUTATION
# For each (user, tag) pair, compute a single strength score in [0, 1].
# This score combines 6 components, each measuring a different skill dimension.
#
# Formula:
#   tag_strength = 0.30 × acceptance_rate
#                + 0.30 × difficulty_score
#                + 0.20 × rating_boost
#                + 0.10 × specialization_score
#                + 0.075 × efficiency_score
#                + 0.075 × volume_score
# ─────────────────────────────────────────────────────────────────────────────

def compute_tag_strengths(df_subs, df_profiles):
    """
    Build a DataFrame with one row per (handle, tag) containing the
    tag_strength score and all intermediate component scores.

    df_subs:    cleaned submissions DataFrame (one row per handle×problem)
    df_profiles: user profiles with cf_rating, cf_max_rating, first_try_rate,
                 total_ac, etc.
    """
    print("[Phase 3] Computing tag strengths...")

    # Melt the wide tag columns into long format: one row per (handle, problem, tag)
    melted = df_subs.melt(
        id_vars=["handle", "problem_id", "problem_rating", "is_ac", "is_wa"],
        value_vars=TAG_COLS,
        var_name="tag",
        value_name="has_tag",
    )
    # Keep only rows where the problem actually has this tag
    melted = melted[melted["has_tag"] == 1].drop(columns="has_tag")

    # Aggregate per (handle, tag)
    user_tag_df = (
        melted.groupby(["handle", "tag"])
        .agg(
            total_attempts    = ("problem_id",     "count"),
            ac_count          = ("is_ac",          "sum"),
            avg_rating_solved = ("problem_rating", lambda x: x[melted.loc[x.index, "is_ac"] == 1].mean() if (melted.loc[x.index, "is_ac"] == 1).any() else 0),
        )
        .reset_index()
    )
    user_tag_df["avg_rating_solved"] = user_tag_df["avg_rating_solved"].fillna(0)

    # Merge user-level profile signals
    profile_cols = ["handle", "cf_rating", "cf_max_rating", "first_try_rate", "total_ac"]
    user_tag_df = user_tag_df.merge(df_profiles[profile_cols], on="handle", how="left")

    # Component 1: acceptance rate with Laplace smoothing (avoids division by zero)
    user_tag_df["acceptance_rate"] = (user_tag_df["ac_count"] + 1) / (user_tag_df["total_attempts"] + 2)

    # Component 2: average difficulty of solved problems, normalized to [0, 1]
    user_tag_df["difficulty_score"] = (user_tag_df["avg_rating_solved"] / MAX_RATING).clip(0, 1)

    # Component 3: user's current + peak rating, normalized (global skill signal)
    user_tag_df["rating_boost"] = (
        (user_tag_df["cf_rating"] + user_tag_df["cf_max_rating"]) / (2 * MAX_RATING)
    ).clip(0, 1)

    # Component 4: what fraction of this user's total solves are in this tag
    user_tag_df["specialization_score"] = (
        user_tag_df["ac_count"] / user_tag_df["total_ac"].replace(0, np.nan)
    ).fillna(0).clip(0, 1)

    # Component 5: first-try rate from the profile (no retries needed = efficient)
    user_tag_df["efficiency_score"] = user_tag_df["first_try_rate"].clip(0, 1)

    # Component 6: volume of solved problems, with log saturation (diminishing returns)
    user_tag_df["volume_score"] = (
        np.log1p(user_tag_df["ac_count"]) / np.log1p(50)
    ).clip(0, 1)

    # Weighted sum of all 6 components
    user_tag_df["tag_strength"] = sum(
        user_tag_df[col] * w for col, w in STRENGTH_WEIGHTS.items()
    ).clip(0, 1)

    print(f"[Phase 3] Built {len(user_tag_df)} (user, tag) strength rows")
    return user_tag_df


def build_tag_strength_for_target(target_subs_df, cf_rating, cf_max_rating, first_try_rate, total_ac):
    """
    Compute tag strengths for a single target user (fetched live from API).
    Returns a dict: {tag_col: tag_strength_value}
    """
    # Create a minimal profile row for the target user
    handle = target_subs_df["handle"].iloc[0]
    df_profile = pd.DataFrame([{
        "handle":         handle,
        "cf_rating":      cf_rating,
        "cf_max_rating":  cf_max_rating,
        "first_try_rate": first_try_rate,
        "total_ac":       total_ac,
    }])

    user_tag_df = compute_tag_strengths(target_subs_df, df_profile)
    # Convert to dict keyed by tag column
    strength_map = user_tag_df.set_index("tag")["tag_strength"].to_dict()
    # Fill missing tags with 0
    return {tag: strength_map.get(tag, 0.0) for tag in TAG_COLS}


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 4: FEATURE BUILDING
# Convert tag strengths into an 82-dimensional vector for KNN.
#
# Vector layout:
#   [acceptance_rate × 20]    indices 0–19
#   [difficulty_score × 20]   indices 20–39
#   [specialization × 20]     indices 40–59
#   [volume_score × 20]       indices 60–79
#   [rating_boost]            index 80
#   [efficiency_score]        index 81
#
# The user-level features (rating_boost, efficiency_score) appear ONCE at the end,
# not repeated 20×, so they don't dominate the Euclidean distance.
# ─────────────────────────────────────────────────────────────────────────────

def build_knn_vector(user_tag_df_row_or_dict, cf_rating, cf_max_rating, first_try_rate):
    """
    Build a single 82-dim KNN feature vector for one user.

    Can accept either:
    - a dict of per-tag component values (for the target user)
    - a subset of the user_tag_df for one user (for dataset users)
    """
    acceptance   = np.zeros(len(TAG_COLS))
    difficulty   = np.zeros(len(TAG_COLS))
    specialization = np.zeros(len(TAG_COLS))
    volume       = np.zeros(len(TAG_COLS))

    if isinstance(user_tag_df_row_or_dict, pd.DataFrame):
        df = user_tag_df_row_or_dict.set_index("tag")
        for i, tag in enumerate(TAG_COLS):
            if tag in df.index:
                acceptance[i]     = df.loc[tag, "acceptance_rate"]
                difficulty[i]     = df.loc[tag, "difficulty_score"]
                specialization[i] = df.loc[tag, "specialization_score"]
                volume[i]         = df.loc[tag, "volume_score"]
    else:
        # dict passed directly
        for i, tag in enumerate(TAG_COLS):
            acceptance[i]     = user_tag_df_row_or_dict.get(f"{tag}_acceptance", 0.0)
            difficulty[i]     = user_tag_df_row_or_dict.get(f"{tag}_difficulty", 0.0)
            specialization[i] = user_tag_df_row_or_dict.get(f"{tag}_specialization", 0.0)
            volume[i]         = user_tag_df_row_or_dict.get(f"{tag}_volume", 0.0)

    rating_boost_val  = ((cf_rating + cf_max_rating) / (2 * MAX_RATING))
    efficiency_val    = float(first_try_rate)

    vector = np.concatenate([acceptance, difficulty, specialization, volume,
                             [rating_boost_val, efficiency_val]])
    return vector.astype(np.float32)


def build_dataset_knn_matrix(user_tag_df, df_profiles):
    """
    Build the full N × 82 KNN matrix for all dataset users.
    Returns (matrix, handles_list).
    """
    print("[Phase 4] Building KNN feature matrix for dataset users...")

    profile_lookup = df_profiles.set_index("handle")

    handles = user_tag_df["handle"].unique().tolist()
    vectors = []
    valid_handles = []

    for handle in handles:
        if handle not in profile_lookup.index:
            continue
        row = profile_lookup.loc[handle]
        user_rows = user_tag_df[user_tag_df["handle"] == handle]
        vec = build_knn_vector(
            user_rows,
            cf_rating=float(row.get("cf_rating", 0)),
            cf_max_rating=float(row.get("cf_max_rating", 0)),
            first_try_rate=float(row.get("first_try_rate", 0)),
        )
        vectors.append(vec)
        valid_handles.append(handle)

    matrix = np.stack(vectors)
    print(f"[Phase 4] Dataset KNN matrix shape: {matrix.shape}")
    return matrix, valid_handles


def build_target_knn_vector(raw_rows, cf_rating, cf_max_rating):
    """
    Build the 82-dim KNN vector for the target user from their live submissions.

    raw_rows: list of raw submission dicts (NOT deduplicated) — same format as
              fetch_user_submissions returns. This matches how the training data
              was built: each wrong-answer submission is its own row, so
              total_attempts per tag = actual number of submissions to problems
              with that tag, not just unique problems.
    """
    raw_df = pd.DataFrame(raw_rows)
    raw_df = raw_df[raw_df["problem_rating"] > 0].copy()

    # Compute profile stats from raw submissions
    # Per unique problem: did they ever solve it? how many total submissions?
    per_problem = (
        raw_df.groupby("problem_id")
        .agg(ever_ac=("is_ac", "max"), total_subs=("is_ac", "count"))
        .reset_index()
    )
    total_ac = int(per_problem["ever_ac"].sum())
    # first_try_rate: fraction of unique problems solved with only 1 submission
    first_try_count = int(((per_problem["total_subs"] == 1) & (per_problem["ever_ac"] == 1)).sum())
    first_try_rate = first_try_count / max(len(per_problem), 1)

    handle = raw_df["handle"].iloc[0]
    df_profile = pd.DataFrame([{
        "handle":         handle,
        "cf_rating":      cf_rating,
        "cf_max_rating":  cf_max_rating,
        "first_try_rate": first_try_rate,
        "total_ac":       total_ac,
    }])

    # Pass raw_df (non-deduplicated) so total_attempts per tag counts all submission
    # attempts, not just unique problems — this matches the training data structure.
    user_tag_df = compute_tag_strengths(raw_df, df_profile)

    vec = build_knn_vector(user_tag_df, cf_rating, cf_max_rating, first_try_rate)
    return vec, user_tag_df, total_ac, first_try_rate


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 5: KNN INFERENCE
# Find the K=50 most similar users in the dataset using Euclidean distance
# on the 82-dim feature vectors. No libraries — pure NumPy.
# ─────────────────────────────────────────────────────────────────────────────

def find_neighbors(target_vector, dataset_matrix, dataset_handles, k=K_NEIGHBORS):
    """
    Compute Euclidean distance from the target user to every dataset user,
    then return the K closest users with their distances.
    """
    print(f"[Phase 5] Running KNN with K={k} on {len(dataset_handles)} dataset users...")

    # Euclidean distance: sqrt( sum( (target - each_user)^2 ) )
    diffs = dataset_matrix - target_vector   # shape: (N, 82)
    distances = np.sqrt((diffs ** 2).sum(axis=1))  # shape: (N,)

    # Get indices of the K smallest distances
    sorted_idx = np.argsort(distances)[:k]

    neighbors = []
    for rank, idx in enumerate(sorted_idx):
        neighbors.append({
            "handle":   dataset_handles[idx],
            "distance": float(distances[idx]),
            "rank":     rank,
        })

    # Convert distance to a 0–100 similarity score using rank
    max_dist = distances.max()
    for n in neighbors:
        # similarity based on actual distance vs the furthest user in the dataset
        n["similarity"] = max(0, round(100 * (1 - n["distance"] / (max_dist + 1e-9)), 1))

    print(f"[Phase 5] Found {len(neighbors)} neighbors")
    return neighbors


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 6: TAG ANALYSIS (PEER-BENCHMARKED)
# Re-score the target user's tag strengths relative to the 50 neighbors.
# This gives a display score (0–100) that shows WHERE the user stands
# compared to similar players, not just their absolute skill.
# ─────────────────────────────────────────────────────────────────────────────

def compute_peer_benchmarked_strengths(target_tag_df, neighbor_handles, df_strengths):
    """
    For each tag, compare the target user's stats against the median of neighbors.

    Returns a dict: {tag_col: {"strength": 0-100, "label": "...", ...}}
    """
    print("[Phase 6] Computing peer-benchmarked tag strengths...")

    # Collect neighbor tag data from the pre-computed strengths dataset
    peer_df = df_strengths[df_strengths["handle"].isin(neighbor_handles)]

    target_tag_map = target_tag_df.set_index("tag")
    results = {}

    for tag in TAG_COLS:
        peer_rows = peer_df[peer_df["tag"] == tag]
        if peer_rows.empty:
            results[tag] = {"strength": 0, "label": TAG_LABELS.get(tag, tag)}
            continue

        # Peer medians for each component
        peer_ac_rate   = peer_rows["acceptance_rate"].median()
        peer_difficulty = peer_rows["difficulty_score"].median()
        peer_volume    = peer_rows["ac_count"].median()
        peer_spec      = peer_rows["specialization_score"].median()

        if tag not in target_tag_map.index:
            results[tag] = {"strength": 0, "label": TAG_LABELS.get(tag, tag)}
            continue

        t = target_tag_map.loc[tag]

        # Each sub-score is how the user compares to the peer median (1.0 = at median)
        ac_score   = min(1.0, t["acceptance_rate"] / max(peer_ac_rate, 1e-9))
        diff_score = min(1.0, t["difficulty_score"] / max(peer_difficulty, 1e-9))

        # Volume uses exponential saturation: full score if >= peer median solved
        vol_score = 1.0 - math.exp(-t["ac_count"] / max(peer_volume, 1))

        spec_score = min(1.0, t["specialization_score"] / max(peer_spec, 1e-9))

        # Weighted combination
        strength = (
            0.35 * ac_score +
            0.35 * diff_score +
            0.20 * vol_score +
            0.10 * spec_score
        ) * 100

        results[tag] = {
            "strength":       round(min(100, max(0, strength)), 1),
            "label":          TAG_LABELS.get(tag, tag),
            "ac_count":       int(t.get("ac_count", 0)),
            "total_attempts": int(t.get("total_attempts", 0)),
            "acceptance_rate": round(float(t.get("acceptance_rate", 0)), 3),
            "avg_difficulty": round(float(t.get("avg_rating_solved", 0)), 0),
            "raw_strength":   round(float(t.get("tag_strength", 0)), 3),
        }

    return results


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 7: PROBLEM POOL BUILDING
# Gather candidate problems the target user hasn't solved yet,
# sourced from what the 50 nearest neighbors have solved.
# Problems solved by more (and more similar) neighbors rank higher.
# ─────────────────────────────────────────────────────────────────────────────

def build_problem_pool(target_subs_df, neighbors, df_subs_dataset, max_problems=300):
    """
    Build a pool of candidate problems for the target user.

    A problem is a good candidate if:
    - The target user has NOT solved it yet
    - At least one neighbor HAS solved it
    - Higher similarity neighbors contribute more weight

    Returns a list of dicts with problem metadata + accumulated neighbor weight.
    """
    print("[Phase 7] Building problem pool from neighbors' solved problems...")

    # Set of problems the target already solved
    solved_by_target = set(
        target_subs_df[target_subs_df["is_ac"] == 1]["problem_id"].tolist()
    )
    tried_by_target = set(target_subs_df["problem_id"].tolist())

    # Build weight map for each neighbor (higher rank = lower weight)
    neighbor_weights = {}
    for n in neighbors:
        # Rank 0 = closest → highest weight
        neighbor_weights[n["handle"]] = 1.0 / (n["rank"] + 1)

    neighbor_handles = set(n["handle"] for n in neighbors)

    # Only look at neighbor submissions from the dataset
    neighbor_subs = df_subs_dataset[
        df_subs_dataset["handle"].isin(neighbor_handles)
    ].copy()

    # One row per (handle, problem) — only solved problems
    per_prob = (
        neighbor_subs.groupby(["handle", "problem_id"], sort=False)
        .agg(
            ever_ac        = ("is_ac", "max"),
            problem_rating = ("problem_rating", "first"),
            problem_name   = ("problem_name", "first"),
            **{t: (t, "first") for t in TAG_COLS},
        )
        .reset_index()
    )
    per_prob = per_prob[per_prob["ever_ac"] == 1].copy()

    # Accumulate weighted votes for each problem
    problem_scores = {}
    problem_meta   = {}

    for _, row in per_prob.iterrows():
        pid = row["problem_id"]
        if pid in solved_by_target:
            continue  # target already solved this
        if row["problem_rating"] <= 0:
            continue  # skip unrated problems

        weight = neighbor_weights.get(row["handle"], 0)
        problem_scores[pid] = problem_scores.get(pid, 0) + weight

        if pid not in problem_meta:
            problem_meta[pid] = {
                "id":     pid,
                "name":   row["problem_name"],
                "rating": int(row["problem_rating"]),
                "tags":   [t for t in TAG_COLS if row[t] == 1],
            }

    # Sort by accumulated neighbor weight, take top candidates
    sorted_problems = sorted(problem_scores.items(), key=lambda x: x[1], reverse=True)
    pool = []
    for pid, score in sorted_problems[:max_problems]:
        meta = problem_meta[pid]
        meta["neighbor_score"] = round(score, 3)
        pool.append(meta)

    print(f"[Phase 7] Problem pool: {len(pool)} candidates")
    return pool


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 8: PROBLEM RANKING
# Use the trained success model to predict how likely the user is to solve
# each candidate problem, then combine with a weakness boost score.
#
# The weakness boost measures how weak the user is in the tags required by the
# problem (relative to neighbors). We want to push problems that will fill gaps.
#
# Sweet-spot filter: only keep problems where solve_score ∈ [-0.2, 0.8]
#   Too easy (>0.8) → no growth
#   Too hard (<-0.2) → frustration
#
# Final score = 0.6 × difficulty_match + 0.4 × weakness_boost
# ─────────────────────────────────────────────────────────────────────────────

def rank_problems(problem_pool, target_strength_raw, cf_rating, target_subs_df,
                  success_model_payload, attempts_model_payload,
                  neighbor_tag_df, neighbor_handles):
    """
    Score and rank all candidate problems using the success model.

    target_strength_raw: dict {tag_col: raw_strength_0_to_1} for the target user
    neighbor_tag_df:     strengths DataFrame for the 50 neighbors
    """
    print("[Phase 8] Ranking problems using ML models...")

    success_model = success_model_payload["model"]
    attempts_model = attempts_model_payload["model"]

    # Compute median tag strength per tag across all neighbors (for weakness boost)
    peer_median_strength = {}
    for tag in TAG_COLS:
        peer_rows = neighbor_tag_df[neighbor_tag_df["tag"] == tag]["tag_strength"]
        peer_median_strength[tag] = float(peer_rows.median()) if not peer_rows.empty else 0.0

    num_solved_by_target = int(target_subs_df["is_ac"].sum())

    results = []

    for prob in problem_pool:
        tags = prob["tags"]
        if not tags:
            continue

        rating  = prob["rating"]
        pid     = prob["id"]

        # Build the 29-dim feature vector for the ML models
        rating_diff    = rating - cf_rating
        rating_diff_sq = rating_diff ** 2

        user_strengths_for_tags = [target_strength_raw.get(t, 0.0) for t in tags]
        mean_strength = sum(user_strengths_for_tags) / len(user_strengths_for_tags)
        min_strength  = min(user_strengths_for_tags)
        max_strength  = max(user_strengths_for_tags)
        tag_coverage  = len(tags) / len(TAG_COLS)

        tag_flags = [1 if t in tags else 0 for t in TAG_COLS]

        feature_row = pd.DataFrame([[
            rating_diff, rating_diff_sq, cf_rating,
            mean_strength, min_strength, max_strength,
            tag_coverage, num_solved_by_target, len(tags),
        ] + tag_flags], columns=[
            "rating_diff", "rating_diff_sq", "cf_rating",
            "mean_tag_strength", "tag_strength_min", "tag_strength_max",
            "tag_coverage", "num_solved", "problem_tag_count",
        ] + TAG_COLS)

        solve_score = float(success_model.predict(feature_row)[0])
        attempts    = float(attempts_model.predict(feature_row)[0])

        # Sweet-spot filter: skip problems that are too easy or too hard
        if solve_score > 0.8 or solve_score < -0.2:
            continue

        # difficulty_match: how well this problem fits the user (mapped to [0, 1])
        difficulty_match = (solve_score + 0.2) / 1.0  # shifts range [-0.2, 0.8] → [0, 1]

        # weakness_boost: high when user is weak in required tags AND neighbors are strong
        weakness_components = []
        for tag in tags:
            user_str = target_strength_raw.get(tag, 0.0)
            peer_str = peer_median_strength.get(tag, 0.0)
            weakness_components.append((1 - user_str) * peer_str)
        weakness_boost = sum(weakness_components) / len(weakness_components) if weakness_components else 0

        final_score = 0.6 * difficulty_match + 0.4 * weakness_boost

        # Difficulty label based on predicted attempts
        if attempts < 1.5:
            difficulty_label = "easy"
        elif attempts < 2.5:
            difficulty_label = "moderate"
        else:
            difficulty_label = "hard"

        results.append({
            "id":               pid,
            "name":             prob["name"],
            "rating":           rating,
            "tags":             [TAG_LABELS.get(t, t) for t in tags],
            "solve_score":      round(solve_score, 3),
            "difficulty_match": round(difficulty_match, 3),
            "weakness_boost":   round(weakness_boost, 3),
            "final_score":      round(final_score, 3),
            "est_attempts":     round(float(attempts), 2),
            "difficulty_label": difficulty_label,
        })

    # Sort: weakest tags first (highest weakness_boost), then by final_score
    results.sort(key=lambda x: (-x["weakness_boost"], -x["final_score"]))
    print(f"[Phase 8] {len(results)} problems survived the sweet-spot filter")
    return results[:50]  # return top 50


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 9: COUNTERFACTUAL TAG IMPACT
# Answer: "If I improve tag X by +0.2 strength, how many more problems
#          would become reachable in the sweet spot?"
#
# This tells the user which tags to prioritize for rating growth.
# ─────────────────────────────────────────────────────────────────────────────

def compute_counterfactual_impact(problem_pool, target_strength_raw, cf_rating,
                                  target_subs_df, success_model_payload):
    """
    For each tag, simulate a +0.2 boost and count how many more problems
    fall into the sweet spot (solve_score ∈ [-0.2, 0.8]).
    """
    print("[Phase 9] Computing counterfactual tag impacts...")

    success_model = success_model_payload["model"]
    num_solved = int(target_subs_df["is_ac"].sum())

    def count_sweet_spot(strength_map):
        count = 0
        for prob in problem_pool:
            tags = prob["tags"]
            if not tags:
                continue
            rating = prob["rating"]
            rating_diff    = rating - cf_rating
            rating_diff_sq = rating_diff ** 2
            user_strengths_for_tags = [strength_map.get(t, 0.0) for t in tags]
            mean_strength = sum(user_strengths_for_tags) / len(user_strengths_for_tags)
            min_strength  = min(user_strengths_for_tags)
            max_strength  = max(user_strengths_for_tags)
            tag_coverage  = len(tags) / len(TAG_COLS)
            tag_flags     = [1 if t in tags else 0 for t in TAG_COLS]

            feature_row = pd.DataFrame([[
                rating_diff, rating_diff_sq, cf_rating,
                mean_strength, min_strength, max_strength,
                tag_coverage, num_solved, len(tags),
            ] + tag_flags], columns=[
                "rating_diff", "rating_diff_sq", "cf_rating",
                "mean_tag_strength", "tag_strength_min", "tag_strength_max",
                "tag_coverage", "num_solved", "problem_tag_count",
            ] + TAG_COLS)

            score = float(success_model.predict(feature_row)[0])
            if -0.2 <= score <= 0.8:
                count += 1
        return count

    baseline = count_sweet_spot(target_strength_raw)
    impact_list = []

    for tag in TAG_COLS:
        # Boost this one tag by 0.2 (cap at 1.0)
        boosted = dict(target_strength_raw)
        boosted[tag] = min(1.0, boosted.get(tag, 0.0) + 0.2)

        new_count = count_sweet_spot(boosted)
        delta = new_count - baseline

        # Rough estimate: each extra sweet-spot problem ≈ 5 rating points
        est_gain = delta * 5

        impact_list.append({
            "tag":              tag,
            "label":            TAG_LABELS.get(tag, tag),
            "current_strength": round(target_strength_raw.get(tag, 0.0), 3),
            "delta_problems":   delta,
            "est_rating_gain":  est_gain,
        })

    # Sort by estimated gain descending
    impact_list.sort(key=lambda x: -x["est_rating_gain"])
    return impact_list


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 10: TRAINING
# Train all three LightGBM models from the pre-built dataset CSVs.
# Run this when you want to update the models with new data.
# ─────────────────────────────────────────────────────────────────────────────

def _build_ml_features(df_subs, df_strengths, df_profiles):
    """
    Shared feature building for the success and attempts models.
    Returns (X, per_prob_df) where X is a DataFrame of 29 features.
    """
    strength_pivot = (
        df_strengths.pivot_table(index="handle", columns="tag", values="tag_strength")
        .reindex(columns=TAG_COLS).fillna(0.0)
    )
    user_rating = df_profiles.drop_duplicates("handle").set_index("handle")["cf_rating"].to_dict()

    # One row per (handle, problem)
    per_prob = (
        df_subs.groupby(["handle", "problem_id"], sort=False)
        .agg(
            ever_ac        = ("is_ac", "max"),
            wa_count       = ("is_wa", "sum"),
            problem_rating = ("problem_rating", "first"),
            **{t: (t, "first") for t in TAG_COLS},
        )
        .reset_index()
    )
    per_prob = per_prob[per_prob["problem_rating"] > 0].copy()
    per_prob = per_prob[per_prob["handle"].isin(strength_pivot.index)].copy()

    handles     = per_prob["handle"].values
    ratings     = per_prob["problem_rating"].values.astype(np.float32)
    tags_matrix = per_prob[TAG_COLS].values.astype(np.float32)

    cf_ratings     = np.array([user_rating.get(h, 1200) for h in handles], dtype=np.float32)
    rating_diff    = ratings - cf_ratings
    rating_diff_sq = rating_diff ** 2

    user_strengths = strength_pivot.loc[handles].values.astype(np.float32)
    active_mask    = tags_matrix.astype(bool)
    tag_count      = active_mask.sum(axis=1).clip(min=1)

    mean_strength = (user_strengths * active_mask).sum(axis=1) / tag_count
    min_strength  = np.where(active_mask, user_strengths,  np.inf).min(axis=1)
    max_strength  = np.where(active_mask, user_strengths, -np.inf).max(axis=1)
    min_strength  = np.where(tag_count > 0, min_strength, 0.0)
    max_strength  = np.where(tag_count > 0, max_strength, 0.0)

    tag_coverage      = tag_count / len(TAG_COLS)
    num_solved        = np.array(
        [per_prob[per_prob["handle"] == h]["ever_ac"].sum() for h in handles],
        dtype=np.float32,
    )

    feature_names = [
        "rating_diff", "rating_diff_sq", "cf_rating",
        "mean_tag_strength", "tag_strength_min", "tag_strength_max",
        "tag_coverage", "num_solved", "problem_tag_count",
    ] + TAG_COLS

    X = pd.DataFrame(np.column_stack([
        rating_diff, rating_diff_sq, cf_ratings,
        mean_strength, min_strength, max_strength,
        tag_coverage, num_solved, tag_count,
        tags_matrix,
    ]).astype(np.float32), columns=feature_names)

    return X, per_prob


def train_success_model(df_subs, df_strengths, df_profiles):
    """
    Train a LightGBM model to predict solve_score ∈ [-1, 1].
    solve_score = ever_ac - wa_count × 0.2   (clipped to [-1, 1])
      1.0  = clean solve (0 wrong answers)
      0.0  = solved but with ~5 wrong answers
     -1.0  = never solved, many wrong answers
    """
    print("[Phase 10] Training success model...")
    X, per_prob = _build_ml_features(df_subs, df_strengths, df_profiles)

    y = (per_prob["ever_ac"] - per_prob["wa_count"] * WA_PENALTY).clip(-1.0, 1.0).values

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = lgb.LGBMRegressor(
        n_estimators=500, learning_rate=0.05, num_leaves=63,
        min_child_samples=50, subsample=0.8, colsample_bytree=0.8,
        random_state=42, n_jobs=-1, verbose=-1,
    )
    model.fit(X_train, y_train,
              eval_set=[(X_test, y_test)],
              callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(100)])

    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    r2  = r2_score(y_test, y_pred)
    auc = roc_auc_score((y_test >= 0.5).astype(int), y_pred)
    print(f"[Phase 10] Success model — MAE: {mae:.3f}, R²: {r2:.3f}, AUC: {auc:.3f}")

    payload = {"model": model, "type": "success_regressor", "wa_penalty": WA_PENALTY}
    with open(SUCCESS_MODEL_PATH, "wb") as f:
        pickle.dump(payload, f)
    print(f"[Phase 10] Saved success model to {SUCCESS_MODEL_PATH}")
    return payload


def train_attempts_model(df_subs, df_strengths, df_profiles):
    """
    Train a LightGBM model to predict attempts = wa_count + 1 ∈ [1, 10].
    Only trained on solved problems (ever_ac == 1).
    1 = first-try solve, 3 = solved after 2 wrong answers, etc.
    """
    print("[Phase 10] Training attempts model...")
    X, per_prob = _build_ml_features(df_subs, df_strengths, df_profiles)

    # Only keep solved problems
    solved_mask = per_prob["ever_ac"].values == 1
    X = X[solved_mask].copy()
    y = (per_prob["wa_count"].values[solved_mask] + 1).clip(1, 10).astype(np.float32)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = lgb.LGBMRegressor(
        n_estimators=500, learning_rate=0.05, num_leaves=63,
        min_child_samples=50, subsample=0.8, colsample_bytree=0.8,
        random_state=42, n_jobs=-1, verbose=-1,
    )
    model.fit(X_train, y_train,
              eval_set=[(X_test, y_test)],
              callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(100)])

    y_pred = model.predict(X_test).clip(1, 10)
    mae = mean_absolute_error(y_test, y_pred)
    r2  = r2_score(y_test, y_pred)
    print(f"[Phase 10] Attempts model — MAE: {mae:.3f}, R²: {r2:.3f}")

    payload = {"model": model, "type": "attempts_regressor"}
    with open(ATTEMPTS_MODEL_PATH, "wb") as f:
        pickle.dump(payload, f)
    print(f"[Phase 10] Saved attempts model to {ATTEMPTS_MODEL_PATH}")
    return payload


PROFILE_FEATURE_COLS = [
    "cf_rating", "total_contests", "contests_per_year", "first_try_rate",
    "avg_attempts_to_ac", "unique_problems_solved", "unique_problems_tried",
    "solved_lte_1000", "solved_1001_1500", "solved_1501_2000",
    "solved_2001_2500", "solved_2501_3000", "solved_gt_3000",
    "practice_sub_ratio", "contest_sub_ratio", "subs_per_active_day",
    "tag_coverage_pct", "unique_tags_solved",
]


def train_rating_progression_model(df_profiles, df_strengths):
    """
    Train a LightGBM model to predict cf_max_rating - cf_rating (rating growth potential).
    High value = user peaked well above current rating, or has lots of room to grow.
    Features: 18 contest/submission profile signals + 20 tag strengths.
    """
    print("[Phase 10] Training rating progression model...")

    strength_pivot = (
        df_strengths.pivot_table(index="handle", columns="tag", values="tag_strength")
        .reindex(columns=TAG_COLS).fillna(0.0)
    )
    strength_cols = [f"strength_{t}" for t in TAG_COLS]
    strength_pivot.columns = strength_cols

    profiles = df_profiles.drop_duplicates(subset="handle").set_index("handle")
    target = (profiles["cf_max_rating"] - profiles["cf_rating"]).clip(lower=0)

    profile_feats = profiles[PROFILE_FEATURE_COLS]
    combined = profile_feats.join(strength_pivot, how="inner")
    y_series = target.reindex(combined.index).dropna()
    combined = combined.loc[y_series.index]

    feature_names = PROFILE_FEATURE_COLS + strength_cols
    X = combined[feature_names].fillna(0.0).astype(np.float32)
    y = y_series.values.astype(np.float32)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = lgb.LGBMRegressor(
        n_estimators=600, learning_rate=0.03, num_leaves=31,
        min_child_samples=30, subsample=0.8, colsample_bytree=0.8,
        reg_alpha=0.1, reg_lambda=0.1,
        random_state=42, n_jobs=-1, verbose=-1,
    )
    model.fit(X_train, y_train,
              eval_set=[(X_test, y_test)],
              callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(100)])

    y_pred = model.predict(X_test).clip(0)
    mae = mean_absolute_error(y_test, y_pred)
    r2  = r2_score(y_test, y_pred)
    print(f"[Phase 10] Rating progression model — MAE: {mae:.1f} pts, R²: {r2:.3f}")

    payload = {
        "model":         model,
        "feature_names": feature_names,
        "tag_cols":      TAG_COLS,
        "strength_cols": strength_cols,
        "profile_cols":  PROFILE_FEATURE_COLS,
        "type":          "rating_progression_regressor",
    }
    with open(PROGRESSION_MODEL_PATH, "wb") as f:
        pickle.dump(payload, f)
    print(f"[Phase 10] Saved progression model to {PROGRESSION_MODEL_PATH}")
    return payload


def run_training():
    """Load the pre-built CSVs and retrain all three models."""
    print("=" * 60)
    print("PHASE 10: TRAINING ALL MODELS")
    print("=" * 60)

    print("Loading dataset CSVs...")
    df_subs     = pd.read_csv(SUBMISSIONS_CSV)
    df_profiles = pd.read_csv(PROFILES_CSV)
    df_strengths = pd.read_csv(STRENGTHS_CSV)

    df_subs     = clean_dataset_handles(df_subs)
    df_profiles = clean_dataset_handles(df_profiles)
    df_strengths = clean_dataset_handles(df_strengths)

    print(f"Dataset: {df_subs['handle'].nunique()} users, {len(df_subs)} submissions")

    train_success_model(df_subs, df_strengths, df_profiles)
    train_attempts_model(df_subs, df_strengths, df_profiles)
    train_rating_progression_model(df_profiles, df_strengths)

    print("\nAll models trained and saved.")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN ANALYSIS PIPELINE
# Orchestrate phases 1–9 for a given Codeforces handle.
# ─────────────────────────────────────────────────────────────────────────────

def load_models():
    """Load all three trained LightGBM models from disk."""
    with open(SUCCESS_MODEL_PATH, "rb") as f:
        success_payload = pickle.load(f)
    with open(ATTEMPTS_MODEL_PATH, "rb") as f:
        attempts_payload = pickle.load(f)
    with open(PROGRESSION_MODEL_PATH, "rb") as f:
        progression_payload = pickle.load(f)
    print("Loaded all 3 trained models.")
    return success_payload, attempts_payload, progression_payload


def load_dataset():
    """Load pre-built dataset CSVs into memory."""
    print("Loading dataset CSVs...")
    df_subs     = pd.read_csv(SUBMISSIONS_CSV)
    df_profiles = pd.read_csv(PROFILES_CSV)
    df_strengths = pd.read_csv(STRENGTHS_CSV)
    df_subs      = clean_dataset_handles(df_subs)
    df_profiles  = clean_dataset_handles(df_profiles)
    df_strengths = clean_dataset_handles(df_strengths)
    print(f"Dataset: {df_profiles['handle'].nunique()} users, {len(df_subs)} submissions")
    return df_subs, df_profiles, df_strengths


def analyze(handle):
    """
    Run the full analysis pipeline for a Codeforces user handle.
    Returns a dict with tag strengths, recommended problems, and tag impacts.
    """
    print("=" * 60)
    print(f"ANALYZING USER: {handle}")
    print("=" * 60)

    # ── Load models and dataset ──
    success_payload, attempts_payload, progression_payload = load_models()
    df_subs_dataset, df_profiles_dataset, df_strengths = load_dataset()

    # ── Phase 1: Fetch user data from API ──
    cf_rating, cf_max_rating = fetch_user_info(handle)
    raw_submissions = fetch_user_submissions(handle)

    if not raw_submissions:
        print("ERROR: No submissions found for this user.")
        return None

    # ── Phase 2: Clean submissions ──
    # target_subs_df is deduplicated (one row per problem) — used for problem pool.
    # raw_submissions keeps every submission row — used for tag strength computation,
    # matching how the training data was built (each WA is a separate row).
    target_subs_df = clean_submissions(raw_submissions)
    target_subs_df["handle"] = handle  # ensure handle is set after groupby

    # ── Phase 3 + 4: Compute tag strengths and build KNN vector ──
    # Pass raw_submissions (not deduplicated) so acceptance_rate per tag reflects
    # actual attempt counts, consistent with how dataset strengths were computed.
    target_vector, target_tag_df, total_ac, first_try_rate = build_target_knn_vector(
        raw_submissions, cf_rating, cf_max_rating
    )

    # Build the raw strength dict (used as ML model input)
    target_strength_raw = target_tag_df.set_index("tag")["tag_strength"].to_dict()
    target_strength_raw = {t: target_strength_raw.get(t, 0.0) for t in TAG_COLS}

    # ── Phase 4: Build the dataset KNN matrix ──
    dataset_matrix, dataset_handles = build_dataset_knn_matrix(
        df_strengths, df_profiles_dataset
    )

    # ── Phase 5: Find 50 nearest neighbors ──
    neighbors = find_neighbors(target_vector, dataset_matrix, dataset_handles)

    neighbor_handles = [n["handle"] for n in neighbors]
    neighbor_tag_df  = df_strengths[df_strengths["handle"].isin(neighbor_handles)]

    # ── Phase 6: Peer-benchmarked tag strengths ──
    tag_strengths = compute_peer_benchmarked_strengths(
        target_tag_df, neighbor_handles, df_strengths
    )

    # ── Phase 7: Build candidate problem pool ──
    problem_pool = build_problem_pool(
        target_subs_df, neighbors, df_subs_dataset
    )

    # ── Phase 8: Rank problems using ML ──
    recommended_problems = rank_problems(
        problem_pool, target_strength_raw, cf_rating,
        target_subs_df, success_payload, attempts_payload,
        neighbor_tag_df, neighbor_handles,
    )

    # ── Phase 9: Counterfactual tag impact ──
    tag_impact = compute_counterfactual_impact(
        problem_pool, target_strength_raw, cf_rating,
        target_subs_df, success_payload,
    )

    result = {
        "handle":               handle,
        "cf_rating":            cf_rating,
        "cf_max_rating":        cf_max_rating,
        "total_ac":             total_ac,
        "neighbors":            neighbors,
        "tag_strengths":        tag_strengths,
        "recommended_problems": recommended_problems,
        "tag_impact":           tag_impact,
    }

    print_summary(result)
    return result


def print_summary(result):
    """Print a human-readable summary of the analysis."""
    print("\n" + "=" * 60)
    print(f"RESULTS FOR: {result['handle']}")
    print(f"Rating: {result['cf_rating']}  |  Peak: {result['cf_max_rating']}")
    print(f"Total AC: {result['total_ac']}  |  Neighbors found: {len(result['neighbors'])}")
    print("=" * 60)

    print("\n── TAG STRENGTHS (peer-benchmarked, 0–100) ──")
    sorted_tags = sorted(result["tag_strengths"].items(), key=lambda x: x[1]["strength"], reverse=True)
    for _, info in sorted_tags:
        bar = "█" * int(info["strength"] / 5)
        print(f"  {info['label']:<25} {info['strength']:>5.1f}  {bar}")

    print("\n── TOP 10 RECOMMENDED PROBLEMS ──")
    for i, p in enumerate(result["recommended_problems"][:10], 1):
        tags_str = ", ".join(p["tags"][:3])
        print(f"  {i:>2}. [{p['rating']}] {p['name'][:40]:<40}  "
              f"match={p['difficulty_match']:.2f}  boost={p['weakness_boost']:.2f}  "
              f"({p['difficulty_label']})")

    print("\n── TOP 5 TAGS TO IMPROVE (by estimated rating gain) ──")
    for item in result["tag_impact"][:5]:
        print(f"  {item['label']:<25}  strength={item['current_strength']:.2f}  "
              f"+{item['delta_problems']} problems  ~+{item['est_rating_gain']} rating pts")

    print()


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python pipeline.py analyze <handle>   — analyze a Codeforces user")
        print("  python pipeline.py train              — retrain all models")
        sys.exit(1)

    command = sys.argv[1]

    if command == "analyze":
        if len(sys.argv) < 3:
            print("Please provide a Codeforces handle, e.g.:  python pipeline.py analyze tourist")
            sys.exit(1)
        handle = sys.argv[2]
        analyze(handle)

    elif command == "train":
        run_training()

    else:
        print(f"Unknown command: {command}")
        print("Use 'analyze <handle>' or 'train'")
        sys.exit(1)
