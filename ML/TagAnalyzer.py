"""
tag_analyzer.py
===============
Codeforces Tag Strength Analyzer using KNN.

PURPOSE
-------
Given:
  - A target user's submission rows (from the filtered_submissions dataset)
  - The 50 nearest neighbours' submission rows (same format, already selected by KNN)

Outputs:
  - A percentage score (0–100) per tag representing the user's relative strength
    in that problem type, benchmarked against their peer group.

SCORE FORMULA (per tag)
-----------------------
Three signals, each normalised to [0, 1] against the neighbour group:

  1. Acceptance Rate  (weight 0.40)
     = (problems solved with this tag) / (problems attempted with this tag)
     Normalised: user_rate / peer_median_rate  →  capped at 1.0

  2. Difficulty Level  (weight 0.40)
     = average problem_rating of solved problems in this tag
     Normalised: user_avg_difficulty / peer_median_difficulty  →  capped at 1.0
     (rewards solving harder problems than peers at the same rating)

  3. Volume  (weight 0.20)
     = number of distinct problems solved in this tag
     Normalised via 1 - exp(-user_solved / peer_median_solved)
     (rewards breadth of practice, with diminishing returns)

Final strength = weighted_sum * 100  →  rounded to 1 decimal place.
"""

from __future__ import annotations
import math
import pandas as pd


# ── Tag columns present in the dataset ──────────────────────────────────────
TAG_COLS = [
    "tag_dp", "tag_greedy", "tag_graphs", "tag_math", "tag_strings",
    "tag_impl", "tag_binary_search", "tag_data_structures", "tag_number_theory",
    "tag_combinatorics", "tag_geometry", "tag_trees", "tag_sortings",
    "tag_two_pointers", "tag_bitmasks", "tag_flows", "tag_fft",
    "tag_games", "tag_probabilities", "tag_constructive",
]

# Weights — must sum to 1.0
W_ACCEPTANCE      = 0.35
W_DIFFICULTY      = 0.35
W_SPECIALIZATION  = 0.10
W_VOLUME          = 0.20


# ────────────────────────────────────────────────────────────────────────────
# Step 1: Collapse raw submission rows → one row per (handle, problem)
# ────────────────────────────────────────────────────────────────────────────

def submissions_to_per_problem(df: pd.DataFrame) -> pd.DataFrame:
    """
    Input:  raw submissions DataFrame (one row per submission attempt).
            Required columns: handle, problem_id, is_ac, problem_rating, tag_*

    Output: one row per distinct (handle, problem_id) with:
              ever_ac         – 1 if the user ever got AC on this problem
              problem_rating  – problem difficulty rating
              tag_*           – tag flags (unchanged from source)
    """
    agg_dict = {"is_ac": "max", "problem_rating": "first"}
    for t in TAG_COLS:
        agg_dict[t] = "first"

    per_prob = (
        df.groupby(["handle", "problem_id"], sort=False)
          .agg(agg_dict)
          .rename(columns={"is_ac": "ever_ac"})
          .reset_index()
    )
    # Drop unrated problems (rating=0) — not useful for difficulty signal
    per_prob = per_prob[per_prob["problem_rating"] > 0].copy()
    return per_prob


# ────────────────────────────────────────────────────────────────────────────
# Step 2: Compute per-user, per-tag stats
# ────────────────────────────────────────────────────────────────────────────

def compute_user_tag_stats(per_prob: pd.DataFrame) -> dict[str, dict]:
    """
    Input:  per-problem DataFrame (output of submissions_to_per_problem).
            May contain rows for multiple users.

    Output: handle → {
                "total_solved": int,
                "tags": tag → {solved, attempted, avg_difficulty}
            }
    """
    result: dict[str, dict] = {}

    for handle, user_df in per_prob.groupby("handle"):
        total_solved = int(user_df["ever_ac"].sum())
        tag_stats: dict[str, dict] = {}
        for tag in TAG_COLS:
            tag_df    = user_df[user_df[tag] == 1]
            attempted = len(tag_df)
            solved_df = tag_df[tag_df["ever_ac"] == 1]
            solved    = len(solved_df)
            avg_diff  = (
                float(solved_df["problem_rating"].mean())
                if solved > 0 else 0.0
            )
            tag_stats[tag] = {
                "solved":         solved,
                "attempted":      attempted,
                "avg_difficulty": round(avg_diff, 1),
            }
        result[handle] = {"total_solved": total_solved, "tags": tag_stats}
    return result


# ────────────────────────────────────────────────────────────────────────────
# Step 3: Compute peer (neighbour) medians for benchmarking
# ────────────────────────────────────────────────────────────────────────────

def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0


def compute_peer_medians(
    neighbor_stats: dict[str, dict]
) -> dict[str, dict[str, float]]:
    """
    Input:  handle → {total_solved, tags: tag → stats}  (neighbours only)
    Output: tag → {median_solved, median_acceptance, median_difficulty, median_specialization}
    """
    medians: dict[str, dict[str, float]] = {}
    for tag in TAG_COLS:
        solved_vals, acc_vals, diff_vals, spec_vals = [], [], [], []
        for user_data in neighbor_stats.values():
            total_solved = user_data.get("total_solved", 0)
            ts           = user_data.get("tags", {}).get(tag, {})
            solved       = ts.get("solved", 0)
            attempted    = ts.get("attempted", 0)
            avg_diff     = ts.get("avg_difficulty", 0.0)
            solved_vals.append(float(solved))
            if attempted > 0:
                acc_vals.append(solved / attempted)
            if solved > 0:
                diff_vals.append(avg_diff)
            if total_solved > 0:
                spec_vals.append(solved / total_solved)
        medians[tag] = {
            "median_solved":          _median(solved_vals),
            "median_acceptance":      _median(acc_vals)  if acc_vals  else 0.0,
            "median_difficulty":      _median(diff_vals) if diff_vals else 0.0,
            "median_specialization":  _median(spec_vals) if spec_vals else 0.0,
        }
    return medians


# ────────────────────────────────────────────────────────────────────────────
# Step 4: Score the target user
# ────────────────────────────────────────────────────────────────────────────

def compute_tag_strengths(
    user_stats:   dict,
    peer_medians: dict[str, dict[str, float]],
) -> dict[str, dict]:
    """
    Produces the final strength percentage for every tag.

    Parameters
    ----------
    user_stats   : {total_solved, tags: tag → {solved, attempted, avg_difficulty}}
    peer_medians : tag → {median_solved, median_acceptance, median_difficulty,
                          median_specialization}

    Returns
    -------
    tag → {
        strength                  – 0–100 float
        solved, attempted
        acceptance_rate           – float 0–1
        specialization_score      – tag_solved / total_solved
        avg_difficulty
        peer_median_*
    }
    """
    results: dict[str, dict] = {}

    total_solved = user_stats.get("total_solved", 0)
    tag_stats    = user_stats.get("tags", {})

    for tag in TAG_COLS:
        ts = tag_stats.get(tag, {"solved": 0, "attempted": 0, "avg_difficulty": 0.0})
        pm = peer_medians.get(tag, {
            "median_solved": 0.0, "median_acceptance": 0.0,
            "median_difficulty": 0.0, "median_specialization": 0.0,
        })

        solved    = ts["solved"]
        attempted = ts["attempted"]
        avg_diff  = ts["avg_difficulty"]

        # Sub-score 1: acceptance rate vs peer median
        user_acc = solved / attempted if attempted > 0 else 0.0
        peer_acc = pm["median_acceptance"]
        if peer_acc > 0:
            acc_score = min(user_acc / peer_acc, 1.0)
        else:
            acc_score = 1.0 if user_acc > 0 else 0.0

        # Sub-score 2: difficulty of problems solved vs peer median
        peer_diff = pm["median_difficulty"]
        if peer_diff > 0 and solved > 0:
            diff_score = min(avg_diff / peer_diff, 1.0)
        elif solved > 0:
            diff_score = 1.0
        else:
            diff_score = 0.0

        # Sub-score 3: specialization — tag_solved / total_solved vs peer median
        user_spec = solved / total_solved if total_solved > 0 else 0.0
        peer_spec = pm["median_specialization"]
        if peer_spec > 0:
            spec_score = min(user_spec / peer_spec, 1.0)
        else:
            spec_score = 1.0 if user_spec > 0 else 0.0

        # Sub-score 4: volume of practice vs peer median (soft saturation)
        peer_solved = pm["median_solved"]
        if peer_solved > 0:
            vol_score = 1.0 - math.exp(-solved / peer_solved)
        else:
            vol_score = 1.0 if solved > 0 else 0.0

        raw      = (W_ACCEPTANCE * acc_score + W_DIFFICULTY * diff_score
                    + W_SPECIALIZATION * spec_score + W_VOLUME * vol_score)
        strength = round(raw * 100, 1)

        results[tag] = {
            "strength":                  strength,
            "solved":                    solved,
            "attempted":                 attempted,
            "acceptance_rate":           round(user_acc, 3),
            "specialization_score":      round(user_spec, 3),
            "avg_difficulty":            avg_diff,
            "peer_median_solved":        round(pm["median_solved"], 1),
            "peer_median_acceptance":    round(pm["median_acceptance"], 3),
            "peer_median_difficulty":    round(pm["median_difficulty"], 1),
            "peer_median_specialization": round(pm["median_specialization"], 3),
        }

    return results


# ────────────────────────────────────────────────────────────────────────────
# Step 5: Utilities
# ────────────────────────────────────────────────────────────────────────────

def rank_tags(strengths: dict[str, dict], min_attempted: int = 1) -> list[tuple[str, float]]:
    """Return (tag, strength%) pairs sorted strongest → weakest."""
    return sorted(
        [(tag, info["strength"]) for tag, info in strengths.items()
         if info["attempted"] >= min_attempted],
        key=lambda x: x[1],
        reverse=True,
    )


def print_report(handle: str, strengths: dict[str, dict]) -> None:
    """Pretty-print a strength report for a user."""
    ranked = rank_tags(strengths)
    print(f"\n{'='*72}")
    print(f"  Tag Strength Report — {handle}")
    print(f"{'='*72}")
    print(f"  {'TAG':<22} {'STRENGTH':>8}  {'SOLVED/TRIED':>12}  {'ACC%':>6}  {'AVG DIFF':>9}")
    print(f"  {'-'*68}")
    for tag, strength in ranked:
        info  = strengths[tag]
        label = tag.replace("tag_", "").replace("_", " ")
        print(
            f"  {label:<22} {strength:>6.1f}%  "
            f"  {info['solved']:>4}/{info['attempted']:<6}"
            f"  {info['acceptance_rate']*100:>5.1f}%"
            f"  {info['avg_difficulty']:>9.0f}"
        )
    print(f"{'='*72}\n")


# ────────────────────────────────────────────────────────────────────────────
# Top-level convenience function
# ────────────────────────────────────────────────────────────────────────────

def analyze(
    target_handle:    str,
    all_submissions:  pd.DataFrame,
    neighbor_handles: list[str],
) -> dict[str, dict]:
    """
    Run the full pipeline in one call.

    Parameters
    ----------
    target_handle    : Handle of the user being scored.
    all_submissions  : DataFrame containing rows for the target + all neighbours.
    neighbor_handles : List of the 50 KNN neighbour handles.

    Returns
    -------
    dict  tag → {strength (0-100), solved, attempted, acceptance_rate,
                 avg_difficulty, peer_median_*}
    """
    per_prob       = submissions_to_per_problem(all_submissions)
    all_stats      = compute_user_tag_stats(per_prob)
    user_stats     = all_stats.get(target_handle, {
        "total_solved": 0,
        "tags": {t: {"solved": 0, "attempted": 0, "avg_difficulty": 0.0} for t in TAG_COLS},
    })
    neighbor_stats = {h: all_stats[h] for h in neighbor_handles if h in all_stats}
    peer_medians   = compute_peer_medians(neighbor_stats)
    return compute_tag_strengths(user_stats, peer_medians)