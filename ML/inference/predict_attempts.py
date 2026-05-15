"""
Problem Attempts Estimator — inference module.

estimate_attempts(problems, cf_rating, user_tag_strength, num_solved)
  → list of dicts, one per problem, with:
      "id":               problem id
      "rating":           problem rating
      "tags":             problem tags
      "estimated_attempts": float — predicted number of submissions before AC
      "difficulty_label": "easy" | "moderate" | "hard"

Uses the same 29-dim feature vector as the success model so inference
is consistent and the two models can be used side-by-side.
"""

import os
import pickle
import numpy as np
import pandas as pd

_MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "attempts_model.pkl")
_payload    = None


def _load():
    global _payload
    if _payload is None:
        with open(_MODEL_PATH, "rb") as f:
            _payload = pickle.load(f)
    return _payload


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


def _build_row(problem: dict, cf_rating: float, user_tag_strength: dict, num_solved: int) -> list:
    rating = problem["rating"]
    tags   = problem["tags"]  # expected as "tag_dp", "tag_greedy", etc.

    rating_diff    = rating - cf_rating
    rating_diff_sq = rating_diff ** 2

    active_strengths = [user_tag_strength.get(t, 0.0) for t in tags if t in TAG_COLS]
    if active_strengths:
        mean_ts = float(np.mean(active_strengths))
        min_ts  = float(min(active_strengths))
        max_ts  = float(max(active_strengths))
    else:
        mean_ts = min_ts = max_ts = 0.0

    problem_tag_count = len(active_strengths)
    tag_coverage      = problem_tag_count / len(TAG_COLS)
    tag_flags         = [1.0 if t in tags else 0.0 for t in TAG_COLS]

    return [
        rating_diff, rating_diff_sq, float(cf_rating),
        mean_ts, min_ts, max_ts,
        tag_coverage, float(num_solved), float(problem_tag_count),
    ] + tag_flags


def _label(attempts: float) -> str:
    if attempts < 1.5:
        return "easy"
    if attempts < 2.5:
        return "moderate"
    return "hard"


def estimate_attempts(
    problems: list[dict],
    cf_rating: int,
    user_tag_strength: dict,
    num_solved: int = 0,
) -> list[dict]:
    if not problems:
        return []

    p     = _load()
    model = p["model"]
    clip  = p["max_attempts_clip"]

    user_rating = float(cf_rating) if cf_rating and cf_rating > 0 else 1200.0
    rows = [_build_row(prob, user_rating, user_tag_strength, num_solved) for prob in problems]
    X    = pd.DataFrame(rows, columns=FEATURE_NAMES, dtype=np.float32)
    preds = model.predict(X).clip(1, clip)

    result = []
    for prob, est in zip(problems, preds):
        result.append({
            "id":                 prob["id"],
            "rating":             prob["rating"],
            "tags":               prob["tags"],
            "estimated_attempts": round(float(est), 2),
            "difficulty_label":   _label(float(est)),
        })
    return result
