"""
Prioritize unsolved problems using a LightGBM regressor.

The model predicts solve_score ∈ [-1, 1]:
  1.0  = solved cleanly (no wrong answers)
  0.0  = solved after many WAs, or borderline
 -1.0  = never solved / many WAs

difficulty_match = solve_score normalised to [0, 1]:
  1.0 = perfect fit (challenging but reachable)
  0.0 = out of reach
"""

import os
import pickle
import numpy as np
import pandas as pd

TAG_COLS = [
    "tag_dp", "tag_greedy", "tag_graphs", "tag_math", "tag_strings",
    "tag_impl", "tag_binary_search", "tag_data_structures", "tag_number_theory",
    "tag_combinatorics", "tag_geometry", "tag_trees", "tag_sortings",
    "tag_two_pointers", "tag_bitmasks", "tag_flows", "tag_fft",
    "tag_games", "tag_probabilities", "tag_constructive",
]

FEATURE_NAMES = [
    "rating_diff", "rating_diff_sq", "cf_rating",
    "mean_tag_strength", "tag_strength_min", "tag_strength_max",
    "tag_coverage", "num_solved", "problem_tag_count",
] + TAG_COLS

_MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "success_model.pkl")
_payload    = None


def _load_model():
    global _payload
    if _payload is None:
        with open(_MODEL_PATH, "rb") as f:
            _payload = pickle.load(f)
    return _payload["model"]


def _build_feature_row(problem, cf_rating, user_tag_strength, num_solved):
    rating = problem["rating"]
    tags   = problem["tags"]

    rating_diff    = rating - cf_rating
    rating_diff_sq = rating_diff ** 2

    active_strengths = [user_tag_strength.get(t, 0.0) for t in tags if t in TAG_COLS]
    if active_strengths:
        mean_tag_strength = float(np.mean(active_strengths))
        tag_strength_min  = float(min(active_strengths))
        tag_strength_max  = float(max(active_strengths))
    else:
        mean_tag_strength = tag_strength_min = tag_strength_max = 0.0

    problem_tag_count = len(active_strengths)
    tag_coverage      = problem_tag_count / len(TAG_COLS)
    tag_flags         = [1.0 if t in tags else 0.0 for t in TAG_COLS]

    return [
        rating_diff, rating_diff_sq, float(cf_rating),
        mean_tag_strength, tag_strength_min, tag_strength_max,
        tag_coverage, float(num_solved), float(problem_tag_count),
    ] + tag_flags


def prioritize_problems(
    problems,
    cf_rating,
    user_tag_strength,
    neighbor_tag_strength,
    num_solved=0,
    alpha=0.6,
    beta=0.4,
):
    model = _load_model()
    user_rating = cf_rating if cf_rating and cf_rating > 0 else 1200

    rows = [_build_feature_row(p, user_rating, user_tag_strength, num_solved) for p in problems]
    X    = pd.DataFrame(rows, columns=FEATURE_NAMES, dtype=np.float32)
    scores = model.predict(X)  # solve_score ∈ [-1, 1]

    # Sweet spot: difficulty_match 40%–90%, i.e. solve_score -0.2 to 0.8
    # Too easy (> 0.8): user breezes through, no growth
    # Too hard (< -0.2): user unlikely to solve it
    lo, hi = -0.2, 0.8

    ranked = []
    for p, solve_score in zip(problems, scores):
        if solve_score < lo or solve_score > hi:
            continue

        # Tag weakness boost: high when user is weak AND neighbors are strong in that tag
        contrast_values = [
            (1 - user_tag_strength.get(tag, 0.0)) * neighbor_tag_strength.get(tag, 0.0)
            for tag in p["tags"]
        ]
        weakness_boost = float(np.mean(contrast_values)) if contrast_values else 0.0

        # Normalise solve_score from [-1, 1] to [0, 1]
        difficulty_match = (float(solve_score) + 1.0) / 2.0

        final_score = alpha * difficulty_match + beta * weakness_boost

        ranked.append({
            "id":               p["id"],
            "rating":           p["rating"],
            "tags":             p["tags"],
            "difficulty_match": round(difficulty_match, 4),
            "solve_score":      round(float(solve_score), 4),
            "weakness_boost":   round(weakness_boost, 4),
            "final_score":      round(final_score, 4),
        })

    ranked.sort(key=lambda x: (x["weakness_boost"], x["final_score"]), reverse=True)
    return ranked
