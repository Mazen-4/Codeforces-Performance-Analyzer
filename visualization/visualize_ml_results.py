"""
ML Results Visualization — Classification (KNN) + Regression (Success Rate)

Plots:
  Row 1 — Classification
    1a. KNN decision boundary (PCA 2D) with rank-colored dataset
    1b. Confusion matrix: predicted rank vs actual rank for dataset users
    1c. Feature importance: which tags drive cluster separation (PCA loadings)

  Row 2 — Regression
    2a. Predicted vs actual success rate (per user) with regression line
    2b. Residual distribution
    2c. Feature importance for success rate (Random Forest)

  Row 3 — o.khalifa focus
    3a. o.khalifa tag strength vs neighbor avg (bar chart)
    3b. Recommended problems: success_prob vs weakness_boost scatter
    3c. Success rate by problem rating bucket (o.khalifa vs dataset avg)
"""

import sys, os, json, warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import matplotlib.colors as mcolors
from matplotlib.lines import Line2D
from sklearn.decomposition import PCA
from sklearn.neighbors import KNeighborsClassifier
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.model_selection import cross_val_predict, StratifiedKFold, KFold
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import confusion_matrix, ConfusionMatrixDisplay, r2_score, mean_absolute_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

# ── Load data ─────────────────────────────────────────────────────────────────
TAG_COLS = [
    "tag_dp","tag_greedy","tag_graphs","tag_math","tag_strings","tag_impl",
    "tag_binary_search","tag_data_structures","tag_number_theory","tag_combinatorics",
    "tag_geometry","tag_trees","tag_sortings","tag_two_pointers","tag_bitmasks",
    "tag_flows","tag_fft","tag_games","tag_probabilities","tag_constructive",
]
TAG_LABELS = [t.replace("tag_","").replace("_"," ") for t in TAG_COLS]

profiles = pd.read_csv("ML/dataset/02_user_profiles.csv")
tag_str  = pd.read_csv("ML/dataset/06_user_tag_strengths.csv")
subs     = pd.read_csv("ML/dataset/04_filtered_submissions.csv")

with open("src/pipeline/logs/recommendations.json") as f:
    recs = json.load(f)

target_handle   = recs["target_user"]
neighbors_info  = recs["recommendation"]["neighbors"]
neighbor_handles= [n["user_handle"] for n in neighbors_info]
target_tag_raw  = recs["tag_strengths"]
recommended     = recs["recommended_problems"]

# Build feature matrix from tag strength pivot
pivot = (
    tag_str.pivot(index="handle", columns="tag", values="tag_strength")
           .reindex(columns=TAG_COLS).fillna(0.0)
)

# Merge with profiles to get rank labels
merged = pivot.join(profiles.set_index("handle")[["cf_rank","cf_rating","first_try_rate",
                                                    "total_ac","avg_attempts_to_ac"]], how="inner")
merged = merged.dropna(subset=["cf_rank"])

RANK_ORDER = ["newbie","pupil","specialist","expert",
              "candidate master","master","international master","grandmaster"]
merged = merged[merged["cf_rank"].isin(RANK_ORDER)]

X       = merged[TAG_COLS].values
y_rank  = merged["cf_rank"].values
y_rate  = merged["first_try_rate"].values   # regression target: success rate

le = LabelEncoder()
le.fit(RANK_ORDER)
y_enc = le.transform(y_rank)

RANK_COLORS = {
    "newbie":                "#808080",
    "pupil":                 "#008000",
    "specialist":            "#03a89e",
    "expert":                "#0000ff",
    "candidate master":      "#aa00aa",
    "master":                "#ff8c00",
    "international master":  "#ff8c00",
    "grandmaster":           "#ff0000",
}

# o.khalifa feature vector (from tag_strengths in recs, /100 to match CSV scale)
target_vec = np.array([
    target_tag_raw.get(tag, {}).get("strength", 0.0) / 100.0
    for tag in TAG_COLS
])

# ── Figure ────────────────────────────────────────────────────────────────────
fig = plt.figure(figsize=(22, 20))
fig.patch.set_facecolor("#0f0f1a")
gs  = gridspec.GridSpec(3, 3, figure=fig, hspace=0.52, wspace=0.38)

BG    = "#16213e"
SPINE = "#2a2a4a"
WHITE = "#e8e8f0"
GREY  = "#8888aa"

def style_ax(ax):
    ax.set_facecolor(BG)
    for spine in ax.spines.values():
        spine.set_edgecolor(SPINE)
    ax.tick_params(colors=GREY, labelsize=8)
    ax.xaxis.label.set_color(GREY)
    ax.yaxis.label.set_color(GREY)

def title(ax, text):
    ax.set_title(text, color=WHITE, fontsize=11, fontweight="bold", pad=10)

# ═══════════════════════════════════════════════════════════════════
# 1a — KNN decision boundary in PCA 2D, colored by rank
# ═══════════════════════════════════════════════════════════════════
ax1a = fig.add_subplot(gs[0, 0])
style_ax(ax1a)
title(ax1a, "KNN Classification\n(PCA 2D · colored by CF rank)")

pca    = PCA(n_components=2, random_state=42)
X2     = pca.fit_transform(X)
var    = pca.explained_variance_ratio_ * 100

# Decision boundary mesh
x_min, x_max = X2[:,0].min()-0.2, X2[:,0].max()+0.2
y_min, y_max = X2[:,1].min()-0.2, X2[:,1].max()+0.2
xx, yy = np.meshgrid(np.linspace(x_min, x_max, 200),
                     np.linspace(y_min, y_max, 200))
knn_2d = KNeighborsClassifier(n_neighbors=50)
knn_2d.fit(X2, y_enc)
Z = knn_2d.predict(np.c_[xx.ravel(), yy.ravel()]).reshape(xx.shape)

cmap_ranks = mcolors.ListedColormap([RANK_COLORS[r] for r in RANK_ORDER])
ax1a.contourf(xx, yy, Z, alpha=0.15, cmap=cmap_ranks, levels=np.arange(-0.5, len(RANK_ORDER)))

for rank in RANK_ORDER:
    mask = y_rank == rank
    ax1a.scatter(X2[mask,0], X2[mask,1], c=RANK_COLORS[rank],
                 s=12, alpha=0.6, linewidths=0, label=rank)

# o.khalifa
t2 = pca.transform(target_vec.reshape(1,-1))[0]
ax1a.scatter(*t2, c="#ff0066", s=200, marker="*", zorder=5,
             edgecolors="white", linewidths=0.8, label=f"{target_handle}")

# neighbors
nb_idx = [list(merged.index).index(h) if h in list(merged.index) else -1
          for h in neighbor_handles]
nb_idx = [i for i in nb_idx if i >= 0]
if nb_idx:
    ax1a.scatter(X2[nb_idx,0], X2[nb_idx,1], s=50, facecolors="none",
                 edgecolors="white", linewidths=0.8, zorder=4, alpha=0.7)

ax1a.set_xlabel(f"PC1 ({var[0]:.1f}% var)", fontsize=8)
ax1a.set_ylabel(f"PC2 ({var[1]:.1f}% var)", fontsize=8)
legend = ax1a.legend(fontsize=6.5, facecolor="#0f0f1a", edgecolor=SPINE,
                     labelcolor=WHITE, markerscale=1.5,
                     loc="upper left", ncol=1)

# ═══════════════════════════════════════════════════════════════════
# 1b — Confusion matrix: KNN cross-validated rank prediction
# ═══════════════════════════════════════════════════════════════════
ax1b = fig.add_subplot(gs[0, 1])
style_ax(ax1b)
title(ax1b, "KNN Rank Classification\nConfusion Matrix (5-fold CV)")

knn_full = KNeighborsClassifier(n_neighbors=50)
cv       = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
y_pred   = cross_val_predict(knn_full, X, y_enc, cv=cv)

short_names = ["newbie","pupil","spec.","expert","cand.M","master","intl.M","GM"]
cm = confusion_matrix(y_enc, y_pred)
# Normalize row-wise
cm_norm = cm.astype(float) / cm.sum(axis=1, keepdims=True)

im = ax1b.imshow(cm_norm, cmap="Blues", vmin=0, vmax=1, aspect="auto")
ax1b.set_xticks(range(len(short_names)))
ax1b.set_yticks(range(len(short_names)))
ax1b.set_xticklabels(short_names, rotation=35, ha="right", fontsize=7, color=GREY)
ax1b.set_yticklabels(short_names, fontsize=7, color=GREY)
ax1b.set_xlabel("Predicted rank", fontsize=8)
ax1b.set_ylabel("Actual rank", fontsize=8)
for i in range(len(RANK_ORDER)):
    for j in range(len(RANK_ORDER)):
        v = cm_norm[i,j]
        ax1b.text(j, i, f"{v:.2f}", ha="center", va="center",
                  fontsize=6.5, color="white" if v > 0.5 else GREY)

overall_acc = (y_pred == y_enc).mean()
ax1b.text(0.5, -0.18, f"Overall accuracy: {overall_acc:.1%}",
          transform=ax1b.transAxes, ha="center", color=WHITE, fontsize=9)
plt.colorbar(im, ax=ax1b, fraction=0.04, pad=0.02).ax.yaxis.set_tick_params(color=GREY)

# ═══════════════════════════════════════════════════════════════════
# 1c — PCA loadings: which tags separate the clusters most
# ═══════════════════════════════════════════════════════════════════
ax1c = fig.add_subplot(gs[0, 2])
style_ax(ax1c)
title(ax1c, "Tag Contribution to PC1\n(cluster separation driver)")

loadings = pca.components_[0]
order    = np.argsort(np.abs(loadings))[::-1]
colors_l = ["#e74c3c" if loadings[i] > 0 else "#3498db" for i in order]
ax1c.barh(range(len(TAG_COLS)), loadings[order], color=colors_l, edgecolor=SPINE, height=0.7)
ax1c.set_yticks(range(len(TAG_COLS)))
ax1c.set_yticklabels([TAG_LABELS[i] for i in order], fontsize=8, color=GREY)
ax1c.axvline(0, color=SPINE, linewidth=1)
ax1c.set_xlabel("PC1 loading (contribution to separation)", fontsize=8)
legend_el = [Line2D([0],[0], color="#e74c3c", lw=8, label="pushes right"),
             Line2D([0],[0], color="#3498db", lw=8, label="pushes left")]
ax1c.legend(handles=legend_el, fontsize=7.5, facecolor="#0f0f1a",
            edgecolor=SPINE, labelcolor=WHITE)

# ═══════════════════════════════════════════════════════════════════
# 2a — Regression: predicted vs actual success rate
# ═══════════════════════════════════════════════════════════════════
ax2a = fig.add_subplot(gs[1, 0])
style_ax(ax2a)
title(ax2a, "Success Rate Regression\nPredicted vs Actual (Random Forest, 5-fold CV)")

rf_reg  = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
kf      = KFold(n_splits=5, shuffle=True, random_state=42)
y_pred_rate = cross_val_predict(rf_reg, X, y_rate, cv=kf)

ax2a.scatter(y_rate, y_pred_rate, s=8, alpha=0.35, c="#3498db",
             linewidths=0, rasterized=True)
lo, hi = y_rate.min(), y_rate.max()
ax2a.plot([lo,hi],[lo,hi], color="#e74c3c", lw=1.5, label="Perfect prediction")

# Regression line through predictions
m, b  = np.polyfit(y_rate, y_pred_rate, 1)
xs    = np.linspace(lo, hi, 100)
ax2a.plot(xs, m*xs+b, color="#2ecc71", lw=1.5, linestyle="--", label="Model fit")

r2  = r2_score(y_rate, y_pred_rate)
mae = mean_absolute_error(y_rate, y_pred_rate)
ax2a.set_xlabel("Actual first-try success rate", fontsize=8)
ax2a.set_ylabel("Predicted success rate", fontsize=8)
ax2a.text(0.04, 0.93, f"R² = {r2:.3f}\nMAE = {mae:.3f}",
          transform=ax2a.transAxes, color=WHITE, fontsize=9,
          bbox=dict(facecolor=SPINE, alpha=0.7, edgecolor="none", pad=4))
ax2a.legend(fontsize=7.5, facecolor="#0f0f1a", edgecolor=SPINE, labelcolor=WHITE)

# ═══════════════════════════════════════════════════════════════════
# 2b — Residuals distribution
# ═══════════════════════════════════════════════════════════════════
ax2b = fig.add_subplot(gs[1, 1])
style_ax(ax2b)
title(ax2b, "Regression Residuals\n(predicted − actual success rate)")

residuals = y_pred_rate - y_rate
ax2b.hist(residuals, bins=60, color="#9b59b6", edgecolor=SPINE, alpha=0.85)
ax2b.axvline(0, color="#e74c3c", linewidth=1.5, label="Zero error")
ax2b.axvline(residuals.mean(), color="#f39c12", linewidth=1.5,
             linestyle="--", label=f"Mean = {residuals.mean():.3f}")
ax2b.set_xlabel("Residual", fontsize=8)
ax2b.set_ylabel("Count", fontsize=8)
ax2b.legend(fontsize=7.5, facecolor="#0f0f1a", edgecolor=SPINE, labelcolor=WHITE)
ax2b.text(0.97, 0.93, f"Std = {residuals.std():.3f}",
          transform=ax2b.transAxes, ha="right", color=WHITE, fontsize=9,
          bbox=dict(facecolor=SPINE, alpha=0.7, edgecolor="none", pad=4))

# ═══════════════════════════════════════════════════════════════════
# 2c — Feature importance for success rate (Random Forest)
# ═══════════════════════════════════════════════════════════════════
ax2c = fig.add_subplot(gs[1, 2])
style_ax(ax2c)
title(ax2c, "Tag Importance for Success Rate\n(Random Forest feature importance)")

rf_full = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
rf_full.fit(X, y_rate)
imp     = rf_full.feature_importances_
order_i = np.argsort(imp)
bar_c   = plt.cm.RdYlGn(imp[order_i] / imp.max())

ax2c.barh(range(len(TAG_COLS)), imp[order_i], color=bar_c,
          edgecolor=SPINE, height=0.7)
ax2c.set_yticks(range(len(TAG_COLS)))
ax2c.set_yticklabels([TAG_LABELS[i] for i in order_i], fontsize=8, color=GREY)
ax2c.set_xlabel("Feature importance (Gini)", fontsize=8)

# ═══════════════════════════════════════════════════════════════════
# 3a — o.khalifa tag strength vs neighbor average
# ═══════════════════════════════════════════════════════════════════
ax3a = fig.add_subplot(gs[2, 0])
style_ax(ax3a)
title(ax3a, f"{target_handle} Tag Strength\nvs. 50 Nearest Neighbors Average")

# Neighbor average from CSV
nb_in_csv = [h for h in neighbor_handles if h in pivot.index]
nb_avg    = pivot.loc[nb_in_csv].mean(axis=0).reindex(TAG_COLS).fillna(0).values

order_t   = np.argsort(target_vec)
x_pos     = np.arange(len(TAG_COLS))
w         = 0.38
ax3a.barh(x_pos - w/2, target_vec[order_t],  w, color="#e74c3c", alpha=0.85, label=target_handle)
ax3a.barh(x_pos + w/2, nb_avg[order_t],       w, color="#3498db", alpha=0.85, label="Neighbor avg")
ax3a.set_yticks(x_pos)
ax3a.set_yticklabels([TAG_LABELS[i] for i in order_t], fontsize=8, color=GREY)
ax3a.set_xlabel("Tag strength (0–1)", fontsize=8)
ax3a.legend(fontsize=8, facecolor="#0f0f1a", edgecolor=SPINE, labelcolor=WHITE)

# ═══════════════════════════════════════════════════════════════════
# 3b — Recommended problems: success_prob vs weakness_boost
# ═══════════════════════════════════════════════════════════════════
ax3b = fig.add_subplot(gs[2, 1])
style_ax(ax3b)
title(ax3b, f"Recommended Problems for {target_handle}\n(success probability vs. weakness boost)")

if recommended:
    sp  = [p["success_prob"]   for p in recommended]
    wb  = [p["weakness_boost"] for p in recommended]
    rat = [p["rating"]         for p in recommended]
    fs  = [p["final_score"]    for p in recommended]

    sc = ax3b.scatter(sp, wb, c=rat, cmap="YlOrRd", s=[f*300+30 for f in fs],
                      alpha=0.75, edgecolors=SPINE, linewidths=0.5, zorder=3)
    cb = plt.colorbar(sc, ax=ax3b, fraction=0.04, pad=0.02)
    cb.set_label("Problem rating", color=GREY, fontsize=8)
    cb.ax.yaxis.set_tick_params(color=GREY)
    plt.setp(cb.ax.yaxis.get_ticklabels(), color=GREY, fontsize=7)

    # label top 5 by final_score
    top5 = sorted(recommended, key=lambda p: p["final_score"], reverse=True)[:5]
    for p in top5:
        ax3b.annotate(p["id"], (p["success_prob"], p["weakness_boost"]),
                      color=WHITE, fontsize=6.5,
                      xytext=(4, 4), textcoords="offset points")

    # quadrant lines
    ax3b.axvline(0.5, color=SPINE, linewidth=0.8, linestyle="--")
    ax3b.axhline(np.median(wb), color=SPINE, linewidth=0.8, linestyle="--")
    ax3b.text(0.52, max(wb)*0.97, "Sweet spot →", color="#2ecc71", fontsize=7)

ax3b.set_xlabel("Success probability (difficulty fit)", fontsize=8)
ax3b.set_ylabel("Weakness boost (growth potential)", fontsize=8)

# ═══════════════════════════════════════════════════════════════════
# 3c — Success rate by problem rating bucket: o.khalifa vs dataset
# ═══════════════════════════════════════════════════════════════════
ax3c = fig.add_subplot(gs[2, 2])
style_ax(ax3c)
title(ax3c, f"Acceptance Rate by Problem Rating\n{target_handle} vs. Dataset Average")

bins   = [0, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500, 9999]
blabels= ["≤800","801-\n1000","1001-\n1200","1201-\n1400","1401-\n1600",
          "1601-\n1800","1801-\n2000","2001-\n2200","2201-\n2500",">2500"]

subs2 = subs[subs["problem_rating"] > 0].copy()
subs2["bucket"] = pd.cut(subs2["problem_rating"], bins=bins, labels=blabels)

dataset_acc = subs2.groupby("bucket", observed=True)["is_ac"].mean()

# o.khalifa submissions from API (stored in recs as target_user_submissions via TagAnalyzer)
# Approximate from tag_strengths acceptance_rate weighted by tag
# Better: re-read from the pipeline's raw submission rows if available
# We compute from the filtered subs for neighbor comparison as proxy
# Use the tag_strengths acceptance_rate for target user per tag as a bar
target_tags_acc = {
    tag: target_tag_raw.get(tag, {}).get("acceptance_rate", 0)
    for tag in TAG_COLS
}
overall_target_acc = np.mean(list(target_tags_acc.values()))

x    = np.arange(len(blabels))
w    = 0.38
bars = ax3c.bar(x, dataset_acc.values, w, color="#3498db", alpha=0.8,
                label="Dataset average", edgecolor=SPINE)
ax3c.axhline(overall_target_acc, color="#e74c3c", linewidth=2,
             linestyle="--", label=f"{target_handle} avg acc ({overall_target_acc:.2f})")

ax3c.set_xticks(x)
ax3c.set_xticklabels(blabels, fontsize=7, color=GREY)
ax3c.set_ylabel("Acceptance rate", fontsize=8)
ax3c.set_xlabel("Problem rating bucket", fontsize=8)
ax3c.set_ylim(0, 1.05)
ax3c.legend(fontsize=7.5, facecolor="#0f0f1a", edgecolor=SPINE, labelcolor=WHITE)

# ── Save ──────────────────────────────────────────────────────────────────────
out = "logs/ml_results.png"
plt.savefig(out, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
print(f"Saved → {out}")
plt.show()
