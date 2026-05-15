"""
Counterfactual Tag Impact — inference module.

For each of the 20 tags, simulate: "what if the user's strength in this tag
increased by +0.2?"  Then re-run the success model and count how many more
problems enter the sweet-spot difficulty window (solve_score ∈ [-0.2, 0.8]).

The delta (extra solvable problems) is a proxy for how much rating gain
the user could realistically achieve by improving that tag.

compute_tag_impact(problems, cf_rating, user_tag_strength, num_solved)
  → list of dicts sorted by impact descending:
    {
      "tag":          "tag_dp",
      "label":        "dp",
      "strength":     0.34,
      "delta_problems": 7,      # extra problems entering sweet spot
      "estimated_rating_gain": 45  # rough mapping via 10 problems ≈ +50 rating
    }
"""

import os
import pickle
import numpy as np
import pandas as pd

_MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "success_model.pkl")
_payload    = None

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

SWEET_LO = -0.2
SWEET_HI =  0.8
BOOST    =  0.2
PROBLEMS_PER_50_RATING = 10  # empirical constant: ~10 extra solvable problems ≈ +50 rating


def _load():
    global _payload
    if _payload is None:
        with open(_MODEL_PATH, "rb") as f:
            _payload = pickle.load(f)
    return _payload["model"]


def _build_matrix(problems: list[dict], cf_rating: float, user_tag_strength: dict, num_solved: int) -> np.ndarray:
    rows = []
    for p in problems:
        rating = p["rating"]
        tags   = p["tags"]

        rating_diff    = rating - cf_rating
        rating_diff_sq = rating_diff ** 2

        active = [user_tag_strength.get(t, 0.0) for t in tags if t in TAG_COLS]
        if active:
            mean_ts = float(np.mean(active))
            min_ts  = float(min(active))
            max_ts  = float(max(active))
        else:
            mean_ts = min_ts = max_ts = 0.0

        problem_tag_count = len(active)
        tag_coverage      = problem_tag_count / len(TAG_COLS)
        tag_flags         = [1.0 if t in tags else 0.0 for t in TAG_COLS]

        rows.append([
            rating_diff, rating_diff_sq, float(cf_rating),
            mean_ts, min_ts, max_ts,
            tag_coverage, float(num_solved), float(problem_tag_count),
        ] + tag_flags)

    return np.array(rows, dtype=np.float32)


def _count_sweet_spot(model, X: np.ndarray) -> int:
    scores = model.predict(pd.DataFrame(X, columns=FEATURE_NAMES, dtype=np.float32))
    return int(np.sum((scores >= SWEET_LO) & (scores <= SWEET_HI)))


def compute_tag_impact(
    problems: list[dict],
    cf_rating: int,
    user_tag_strength: dict,
    num_solved: int = 0,
) -> list[dict]:
    if not problems:
        return []

    model       = _load()
    user_rating = float(cf_rating) if cf_rating and cf_rating > 0 else 1200.0

    baseline_X   = _build_matrix(problems, user_rating, user_tag_strength, num_solved)
    baseline_cnt = _count_sweet_spot(model, baseline_X)

    results = []
    for tag in TAG_COLS:
        boosted = dict(user_tag_strength)
        boosted[tag] = min(1.0, boosted.get(tag, 0.0) + BOOST)

        boosted_X   = _build_matrix(problems, user_rating, boosted, num_solved)
        boosted_cnt = _count_sweet_spot(model, boosted_X)

        delta = max(0, boosted_cnt - baseline_cnt)
        estimated_gain = round((delta / PROBLEMS_PER_50_RATING) * 50)

        results.append({
            "tag":                  tag,
            "label":                tag.replace("tag_", "").replace("_", " "),
            "strength":             round(user_tag_strength.get(tag, 0.0), 4),
            "delta_problems":       delta,
            "estimated_rating_gain": estimated_gain,
        })

    results.sort(key=lambda x: (x["delta_problems"], x["estimated_rating_gain"]), reverse=True)
    return results
