"""
Leave-One-Out KNN Evaluation
=============================
For each user in the dataset:
  1. Remove them from the feature matrix
  2. Run KNN to find their K nearest neighbors
  3. Evaluate how well the neighbors reflect the user's true profile

Metrics:
  - Weakness Jaccard : |target_weak ∩ neighbor_weak| / |target_weak ∪ neighbor_weak|
                       How much of the weak-tag set is shared (0=none, 1=identical)
  - Weakness Recall  : |target_weak ∩ neighbor_weak| / |target_weak|
                       Fraction of the user's weak tags also weak in neighbors
  - Tag MSE          : mean squared difference in tag_strength vectors (user vs neighbor centroid)
  - Rank Correlation : Spearman correlation between user's tag strengths and neighbor centroid's

Runs on a random sample of N users for speed (full dataset = 2877 users, takes ~30s).
"""

import os
import sys
import numpy as np
import pandas as pd
from scipy.stats import spearmanr

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from pipeline.model_inference import _compute_distances

DATASET_DIR   = os.path.join(os.path.dirname(__file__), "..", "dataset")
STRENGTHS_CSV = os.path.join(DATASET_DIR, "06_user_tag_strengths.csv")

TAG_COLS = [
    "tag_dp", "tag_greedy", "tag_graphs", "tag_math", "tag_strings",
    "tag_impl", "tag_binary_search", "tag_data_structures", "tag_number_theory",
    "tag_combinatorics", "tag_geometry", "tag_trees", "tag_sortings",
    "tag_two_pointers", "tag_bitmasks", "tag_flows", "tag_fft",
    "tag_games", "tag_probabilities", "tag_constructive",
]
TAG_FEATURE_COLS = ["acceptance_rate", "difficulty_score", "specialization_score", "volume_score"]

K              = 50
N_SAMPLE       = None   # users to evaluate (set to None for full dataset)
SEED           = 42
WEAK_THRESHOLD = 0.7   # tag_strength below this = "weak tag"


def build_feature_matrix():
    """Build the same 82-dim matrix used in the pipeline."""
    df = pd.read_csv(STRENGTHS_CSV)

    frames = []
    for feat in TAG_FEATURE_COLS:
        p = (
            df.pivot(index="handle", columns="tag", values=feat)
              .reindex(columns=TAG_COLS)
              .fillna(0.0)
        )
        p.columns = [f"{feat}__{tag}" for tag in TAG_COLS]
        frames.append(p)

    tag_pivot = pd.concat(frames, axis=1)
    user_feats = df.groupby("handle")[["rating_boost", "efficiency_score"]].first()
    matrix = tag_pivot.join(user_feats, how="left").fillna(0.0)

    # Also keep a tag_strength pivot for tag similarity metrics
    strength_pivot = (
        df.pivot_table(index="handle", columns="tag", values="tag_strength")
          .reindex(columns=TAG_COLS)
          .fillna(0.0)
    )

    return matrix, strength_pivot


def evaluate():
    print("Loading data...")
    matrix, strength_pivot = build_feature_matrix()

    handles = np.array(matrix.index.tolist())
    X       = matrix.values.astype(np.float32)

    # Filter to users present in strength_pivot
    valid_mask = np.array([h in strength_pivot.index for h in handles])
    handles    = handles[valid_mask]
    X          = X[valid_mask]

    # Sample
    rng = np.random.default_rng(SEED)
    if N_SAMPLE and N_SAMPLE < len(handles):
        idx     = rng.choice(len(handles), N_SAMPLE, replace=False)
        handles = handles[idx]
        X       = X[idx]

    print(f"Evaluating {len(handles)} users with K={K}...")

    weakness_jaccards, weakness_recalls, tag_mses, tag_corrs = [], [], [], []

    for i, (handle, target_vec) in enumerate(zip(handles, X)):
        if i % 50 == 0:
            print(f"  {i}/{len(handles)}...")

        # Leave-one-out: build matrix excluding this user
        loo_handles = np.delete(handles, i)
        loo_X       = np.delete(X, i, axis=0)

        # KNN
        distances  = _compute_distances(loo_X, target_vec, "euclidean")
        k          = min(K, len(distances))
        nn_idx     = np.argsort(distances)[:k]
        nn_handles = loo_handles[nn_idx]

        if handle not in strength_pivot.index:
            continue

        target_strengths = strength_pivot.loc[handle].values
        nn_in_pivot      = [nh for nh in nn_handles if nh in strength_pivot.index]
        if not nn_in_pivot:
            continue

        neighbor_centroid = strength_pivot.loc[nn_in_pivot].values.mean(axis=0)

        # ── Metric 1 & 2: Tag weakness overlap ──────────────────────────────
        target_weak   = set(np.where(target_strengths   < WEAK_THRESHOLD)[0])
        neighbor_weak = set(np.where(neighbor_centroid  < WEAK_THRESHOLD)[0])

        intersection = target_weak & neighbor_weak
        union        = target_weak | neighbor_weak

        if union:
            weakness_jaccards.append(len(intersection) / len(union))
        if target_weak:
            weakness_recalls.append(len(intersection) / len(target_weak))

        # ── Metric 3 & 4: Tag strength similarity ───────────────────────────
        tag_mse = float(np.mean((target_strengths - neighbor_centroid) ** 2))
        corr, _ = spearmanr(target_strengths, neighbor_centroid)
        tag_mses.append(tag_mse)
        if not np.isnan(corr):
            tag_corrs.append(float(corr))

    print(f"\n{'='*50}")
    print(f"Leave-One-Out KNN Evaluation  (K={K}, N={len(handles)}, weak_threshold={WEAK_THRESHOLD})")
    print(f"{'='*50}")
    print(f"\nTag Weakness Overlap Metrics:")
    print(f"  Weakness Jaccard      : {np.mean(weakness_jaccards):.4f}  (1.0 = identical weak-tag sets)")
    print(f"  Weakness Recall       : {np.mean(weakness_recalls):.4f}  (1.0 = all user weak tags covered by neighbors)")

    print(f"\nTag Strength Metrics:")
    print(f"  Tag MSE               : {np.mean(tag_mses):.4f}  (0 = perfect match)")
    print(f"  Spearman Correlation  : {np.mean(tag_corrs):.4f}  (1.0 = identical tag ranking)")

    print(f"\nInterpretation:")
    print(f"  Jaccard   > 0.5   → neighbors share at least half of the user's weak-tag set")
    print(f"  Recall    > 0.7   → most of the user's weak tags appear in neighbors too")
    print(f"  Tag MSE   < 0.05  → neighbors have similar tag strength profiles")
    print(f"  Spearman  > 0.7   → neighbors share the same tag strengths/weaknesses ordering")
    print(f"{'='*50}")

    return {
        "weakness_jaccard":  round(float(np.mean(weakness_jaccards)), 4),
        "weakness_recall":   round(float(np.mean(weakness_recalls)), 4),
        "tag_mse":           round(float(np.mean(tag_mses)), 4),
        "tag_spearman":      round(float(np.mean(tag_corrs)), 4),
        "n_evaluated":       len(handles),
        "k":                 K,
        "weak_threshold":    WEAK_THRESHOLD,
    }


if __name__ == "__main__":
    evaluate()
