"""
KNN Visualization — Codeforces Performance Analyzer

Reads logs/recommendations.json and ML/dataset/06_user_tag_strengths.csv
and produces 4 plots:

  1. Radar chart   — target user tag strength profile vs. neighbor average
  2. PCA scatter   — full dataset in 2D, neighbors highlighted
  3. Distance bar  — how close each neighbor is (lower = more similar)
  4. Heatmap       — per-tag strength for target + top 10 neighbors side-by-side
"""

import sys, os, json
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib.patches import FancyArrowPatch
from sklearn.decomposition import PCA

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
sys.path.insert(0, os.path.dirname(__file__))

# ── Config ────────────────────────────────────────────────────────────────────
RECS_FILE      = "src/pipeline/logs/recommendations.json"
TAG_STRENGTHS  = "ML/dataset/06_user_tag_strengths.csv"

TAG_COLS = [
    "tag_dp", "tag_greedy", "tag_graphs", "tag_math", "tag_strings",
    "tag_impl", "tag_binary_search", "tag_data_structures", "tag_number_theory",
    "tag_combinatorics", "tag_geometry", "tag_trees", "tag_sortings",
    "tag_two_pointers", "tag_bitmasks", "tag_flows", "tag_fft",
    "tag_games", "tag_probabilities", "tag_constructive",
]
TAG_LABELS = [t.replace("tag_", "").replace("_", " ") for t in TAG_COLS]

COLORS = {
    "target":    "#e74c3c",
    "neighbor":  "#3498db",
    "other":     "#bdc3c7",
    "avg":       "#2ecc71",
}

# ── Load data ─────────────────────────────────────────────────────────────────
with open(RECS_FILE) as f:
    recs = json.load(f)

target_handle = recs["target_user"]

# Support both old layout (neighbors at top level) and new (nested under recommendation)
if "recommendation" in recs and isinstance(recs["recommendation"], dict) and "neighbors" in recs["recommendation"]:
    neighbors_info = recs["recommendation"]["neighbors"]
elif "neighbors" in recs:
    neighbors_info = recs["neighbors"]
else:
    print("ERROR: no neighbors found in recommendations.json — run `python main.py <handle>` first.")
    sys.exit(1)

neighbor_handles = [n["user_handle"] for n in neighbors_info]
distances        = [n["distance"]    for n in neighbors_info]

# Tag strength pivot (dataset users)
raw = pd.read_csv(TAG_STRENGTHS)
pivot = (
    raw.pivot(index="handle", columns="tag", values="tag_strength")
       .reindex(columns=TAG_COLS)
       .fillna(0.0)
)

# Target tag strengths from recommendations.json (computed live by TagAnalyzer)
target_tag_strengths_raw = recs.get("tag_strengths", {})
if target_tag_strengths_raw:
    target_vec = np.array(
        [target_tag_strengths_raw.get(tag, {}).get("strength", 0.0) / 100.0
         for tag in TAG_COLS]
    )
else:
    # Fall back to CSV if target is in the dataset
    if target_handle in pivot.index:
        target_vec = pivot.loc[target_handle].values.astype(float)
    else:
        target_vec = np.zeros(len(TAG_COLS))

# Neighbor vectors (from CSV)
neighbor_vecs = {}
for h in neighbor_handles:
    if h in pivot.index:
        neighbor_vecs[h] = pivot.loc[h].values.astype(float)
    else:
        neighbor_vecs[h] = np.zeros(len(TAG_COLS))

neighbor_matrix = np.array([neighbor_vecs[h] for h in neighbor_handles])
neighbor_avg    = neighbor_matrix.mean(axis=0)

# ── Figure layout ─────────────────────────────────────────────────────────────
fig = plt.figure(figsize=(20, 18))
fig.patch.set_facecolor("#1a1a2e")
gs  = gridspec.GridSpec(2, 2, figure=fig, hspace=0.4, wspace=0.35)

title_kw  = dict(color="white", fontsize=13, fontweight="bold", pad=12)
label_kw  = dict(color="#cccccc", fontsize=9)


# ── Plot 1: Radar chart ───────────────────────────────────────────────────────
ax_radar = fig.add_subplot(gs[0, 0], polar=True)
ax_radar.set_facecolor("#16213e")

N      = len(TAG_COLS)
angles = np.linspace(0, 2 * np.pi, N, endpoint=False).tolist()
angles += angles[:1]  # close the polygon

def radar_plot(ax, values, color, label, alpha=0.25, lw=2):
    v = list(values) + [values[0]]
    ax.plot(angles, v, color=color, linewidth=lw, label=label)
    ax.fill(angles, v, color=color, alpha=alpha)

radar_plot(ax_radar, target_vec,   COLORS["target"],   f"{target_handle} (you)")
radar_plot(ax_radar, neighbor_avg, COLORS["avg"],       "Neighbor average")

ax_radar.set_xticks(angles[:-1])
ax_radar.set_xticklabels(TAG_LABELS, size=7.5, color="#dddddd")
ax_radar.set_yticklabels([])
ax_radar.set_ylim(0, 1)
ax_radar.spines["polar"].set_color("#444466")
ax_radar.tick_params(colors="#aaaaaa")
ax_radar.set_title("Tag Strength Profile\n(you vs. neighbor average)", **title_kw)
ax_radar.legend(loc="upper right", bbox_to_anchor=(1.35, 1.15),
                labelcolor="white", facecolor="#1a1a2e", edgecolor="#444466", fontsize=9)


# ── Plot 2: PCA scatter ───────────────────────────────────────────────────────
ax_pca = fig.add_subplot(gs[0, 1])
ax_pca.set_facecolor("#16213e")

# Build matrix: all dataset users + target
all_handles = list(pivot.index)
all_matrix  = pivot.values.astype(float)

# Append target if not in dataset
if target_handle not in pivot.index:
    all_handles = all_handles + [target_handle]
    all_matrix  = np.vstack([all_matrix, target_vec])

pca        = PCA(n_components=2, random_state=42)
coords_2d  = pca.fit_transform(all_matrix)
var_exp    = pca.explained_variance_ratio_ * 100

handle_to_idx = {h: i for i, h in enumerate(all_handles)}

# Plot all users (grey)
ax_pca.scatter(coords_2d[:, 0], coords_2d[:, 1],
               c=COLORS["other"], s=8, alpha=0.4, linewidths=0, zorder=1)

# Plot neighbors (blue)
nb_coords = np.array([coords_2d[handle_to_idx[h]] for h in neighbor_handles if h in handle_to_idx])
if len(nb_coords):
    ax_pca.scatter(nb_coords[:, 0], nb_coords[:, 1],
                   c=COLORS["neighbor"], s=60, alpha=0.9,
                   edgecolors="white", linewidths=0.5, zorder=3, label="Neighbors")

# Plot target (red star)
t_idx    = handle_to_idx.get(target_handle)
t_coords = coords_2d[t_idx]
ax_pca.scatter(*t_coords, c=COLORS["target"], s=180, marker="*",
               edgecolors="white", linewidths=0.8, zorder=4, label=f"{target_handle} (you)")

# Draw lines from target to each neighbor
for h in neighbor_handles:
    if h in handle_to_idx:
        nc = coords_2d[handle_to_idx[h]]
        ax_pca.plot([t_coords[0], nc[0]], [t_coords[1], nc[1]],
                    color=COLORS["neighbor"], alpha=0.25, linewidth=0.8, zorder=2)

# Label top 5 neighbors
for n in neighbors_info[:5]:
    h = n["user_handle"]
    if h in handle_to_idx:
        nc = coords_2d[handle_to_idx[h]]
        ax_pca.annotate(h, nc, color="white", fontsize=7,
                        xytext=(4, 4), textcoords="offset points")

ax_pca.set_xlabel(f"PC1 ({var_exp[0]:.1f}% variance)", **label_kw)
ax_pca.set_ylabel(f"PC2 ({var_exp[1]:.1f}% variance)", **label_kw)
ax_pca.set_title("PCA of Tag Strength Space\n(why these users are nearest)", **title_kw)
ax_pca.tick_params(colors="#aaaaaa")
for spine in ax_pca.spines.values():
    spine.set_edgecolor("#444466")
ax_pca.legend(facecolor="#1a1a2e", edgecolor="#444466", labelcolor="white", fontsize=9)


# ── Plot 3: Distance bar chart ────────────────────────────────────────────────
ax_dist = fig.add_subplot(gs[1, 0])
ax_dist.set_facecolor("#16213e")

top_n   = min(20, len(neighbor_handles))
labels  = neighbor_handles[:top_n]
dists   = distances[:top_n]
bar_colors = [COLORS["neighbor"]] * top_n

bars = ax_dist.barh(range(top_n), dists, color=bar_colors, edgecolor="#1a1a2e", height=0.7)
ax_dist.set_yticks(range(top_n))
ax_dist.set_yticklabels(labels, color="#dddddd", fontsize=8)
ax_dist.invert_yaxis()
ax_dist.set_xlabel("Euclidean distance in tag-strength space\n(lower = more similar)", **label_kw)
ax_dist.set_title(f"Neighbor Distance Ranking\n(top {top_n} of {len(neighbor_handles)})", **title_kw)
ax_dist.tick_params(colors="#aaaaaa")
ax_dist.xaxis.label.set_color("#cccccc")
for spine in ax_dist.spines.values():
    spine.set_edgecolor("#444466")

# Annotate bars with distance value
for i, (bar, d) in enumerate(zip(bars, dists)):
    ax_dist.text(d + max(dists) * 0.01, i, f"{d:.4f}",
                 va="center", color="#aaaaaa", fontsize=7)


# ── Plot 4: Tag strength heatmap ──────────────────────────────────────────────
ax_heat = fig.add_subplot(gs[1, 1])
ax_heat.set_facecolor("#16213e")

top_heat    = min(10, len(neighbor_handles))
heat_handles = [target_handle] + neighbor_handles[:top_heat]
heat_matrix  = np.vstack([
    target_vec,
    *[neighbor_vecs[h] for h in neighbor_handles[:top_heat]]
])

im = ax_heat.imshow(heat_matrix, aspect="auto", cmap="YlOrRd", vmin=0, vmax=1)

ax_heat.set_xticks(range(len(TAG_COLS)))
ax_heat.set_xticklabels(TAG_LABELS, rotation=45, ha="right", fontsize=7, color="#dddddd")
ax_heat.set_yticks(range(len(heat_handles)))
ax_heat.set_yticklabels(
    [f"★ {target_handle}" if h == target_handle else h for h in heat_handles],
    fontsize=8, color="#dddddd"
)
# Highlight target row
ax_heat.add_patch(plt.Rectangle((-0.5, -0.5), len(TAG_COLS), 1,
                                 fill=False, edgecolor=COLORS["target"], linewidth=2))

plt.colorbar(im, ax=ax_heat, fraction=0.03, pad=0.02).ax.yaxis.set_tick_params(color="white")
ax_heat.set_title(f"Tag Strength Heatmap\n(you + top {top_heat} neighbors)", **title_kw)
for spine in ax_heat.spines.values():
    spine.set_edgecolor("#444466")


# ── Save & show ───────────────────────────────────────────────────────────────
out_path = "logs/knn_visualization.png"
os.makedirs("logs", exist_ok=True)
plt.savefig(out_path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
print(f"Saved → {out_path}")
plt.show()
