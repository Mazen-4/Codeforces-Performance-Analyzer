"""
Rating Progression Predictor — inference module.

predict_rating_progression(cf_rating, user_tag_strength, profile_features)
  → {
      "predicted_potential": int,       # estimated cf_max_rating - cf_rating
      "predicted_peak":      int,       # cf_rating + predicted_potential
      "top_growth_tags":     list[dict] # tags sorted by SHAP contribution
    }

profile_features dict keys (all optional, default 0):
  total_contests, contests_per_year, first_try_rate, avg_attempts_to_ac,
  unique_problems_solved, unique_problems_tried,
  solved_lte_1000, solved_1001_1500, solved_1501_2000,
  solved_2001_2500, solved_2501_3000, solved_gt_3000,
  practice_sub_ratio, contest_sub_ratio, subs_per_active_day,
  tag_coverage_pct, unique_tags_solved
"""

import os
import pickle
import numpy as np
import pandas as pd

_MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "rating_progression_model.pkl")
_payload    = None


def _load():
    global _payload
    if _payload is None:
        with open(_MODEL_PATH, "rb") as f:
            _payload = pickle.load(f)
    return _payload


PROFILE_FEATURE_COLS = [
    "cf_rating",
    "total_contests",
    "contests_per_year",
    "first_try_rate",
    "avg_attempts_to_ac",
    "unique_problems_solved",
    "unique_problems_tried",
    "solved_lte_1000",
    "solved_1001_1500",
    "solved_1501_2000",
    "solved_2001_2500",
    "solved_2501_3000",
    "solved_gt_3000",
    "practice_sub_ratio",
    "contest_sub_ratio",
    "subs_per_active_day",
    "tag_coverage_pct",
    "unique_tags_solved",
]

TAG_COLS = [
    "tag_dp", "tag_greedy", "tag_graphs", "tag_math", "tag_strings",
    "tag_impl", "tag_binary_search", "tag_data_structures", "tag_number_theory",
    "tag_combinatorics", "tag_geometry", "tag_trees", "tag_sortings",
    "tag_two_pointers", "tag_bitmasks", "tag_flows", "tag_fft",
    "tag_games", "tag_probabilities", "tag_constructive",
]


def predict_rating_progression(
    cf_rating: int,
    user_tag_strength: dict,
    profile_features: dict | None = None,
) -> dict:
    p = _load()
    model         = p["model"]
    feature_names = p["feature_names"]

    pf = profile_features or {}
    row = {}

    for col in PROFILE_FEATURE_COLS:
        row[col] = float(pf.get(col, 0.0))
    row["cf_rating"] = float(cf_rating)

    for tag in TAG_COLS:
        row[f"strength_{tag}"] = float(user_tag_strength.get(tag, 0.0))

    X = pd.DataFrame([row])[feature_names].astype(np.float32)
    predicted_potential = max(0, float(model.predict(X)[0]))

    # Rank tag strength columns by feature importance (proxy for SHAP)
    # Use model feature importances filtered to strength_* cols
    imp_map = dict(zip(feature_names, model.feature_importances_))
    tag_importance = []
    for tag in TAG_COLS:
        col      = f"strength_{tag}"
        strength = user_tag_strength.get(tag, 0.0)
        imp      = imp_map.get(col, 0)
        label    = tag.replace("tag_", "").replace("_", " ")
        tag_importance.append({
            "tag":      tag,
            "label":    label,
            "strength": round(strength, 4),
            "importance": int(imp),
        })

    # Sort by: weak tags (< 0.5) ranked by their feature importance descending
    # These are the tags where improving would most help
    tag_importance.sort(key=lambda x: (x["strength"] < 0.5, x["importance"]), reverse=True)
    growth_tags = [t for t in tag_importance if t["strength"] < 0.5][:5]

    return {
        "predicted_potential": round(predicted_potential),
        "predicted_peak":      cf_rating + round(predicted_potential),
        "top_growth_tags":     growth_tags,
    }
