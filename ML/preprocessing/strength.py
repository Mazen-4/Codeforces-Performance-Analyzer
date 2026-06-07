import pandas as pd
import numpy as np
import csv

# ─────────────────────────────────────────────────────────────────────────────
# LOAD & CLEAN DATASETS
# ─────────────────────────────────────────────────────────────────────────────
df_profiles    = pd.read_csv('../dataset/02_user_profiles.csv', dtype={'handle': str})

# Read only the columns needed — skipping problem_name etc. cuts RAM usage on an
# 8M-row dataset, keeping us within GitHub Actions' 7 GB limit.
_sub_header = pd.read_csv('../dataset/04_filtered_submissions.csv', nrows=0)
_tag_cols_present = [c for c in _sub_header.columns if c.startswith('tag_')]
_int_cols = ['is_ac', 'is_wa'] + _tag_cols_present
_needed_cols = ['handle', 'problem_id', 'problem_rating'] + _int_cols
# Only force dtypes that can't have NA. The int flag columns are read as float32
# (which tolerates NA from schema-mismatched merges, e.g. a released base that
# lacks columns the newer chunks have), then filled and downcast to int8 below —
# forcing int8 at read time raises "Integer column has NA values".
_dtypes = {'handle': str, 'problem_id': str, 'problem_rating': 'float32',
           **dict.fromkeys(_int_cols, 'float32')}
df_submissions = pd.read_csv('../dataset/04_filtered_submissions.csv',
                             usecols=_needed_cols, dtype=_dtypes)
# Empty flags mean "not observed" → 0. Downcast to int8 to reclaim memory.
df_submissions[_int_cols] = (
    df_submissions[_int_cols].fillna(0).astype('int8')
)


def clean_handles_inplace(df: pd.DataFrame, col: str = 'handle') -> pd.DataFrame:
    """Clean the handle column with minimal extra allocations.

    Avoids the full-frame .copy() and .astype(str) that previously held 2–3
    duplicates of an 8M-row frame in memory at once (the main OOM source).
    Operates on a boolean mask + in-place column assignment instead.
    """
    s = df[col]
    # Strip Excel formula-trigger chars; values are already str from the read.
    cleaned = s.str.strip().str.lstrip('=+-@')
    keep = (s != '#NAME?') & (cleaned.str.len() > 0)
    dropped = len(df) - int(keep.sum())
    if dropped:
        print(f"⚠ Dropped {dropped} corrupted '{col}' rows (#NAME?)")
    df = df.loc[keep].copy()
    df[col] = cleaned.loc[keep].values
    return df

df_profiles    = clean_handles_inplace(df_profiles)
df_submissions = clean_handles_inplace(df_submissions)

# Handles and problem_ids repeat across millions of rows but have only a few
# thousand unique values each. Categorical encoding collapses the per-row
# Python-string overhead (the single largest memory cost) to small int codes,
# and makes every downstream .copy()/groupby far cheaper.
df_submissions['handle']     = df_submissions['handle'].astype('category')
df_submissions['problem_id'] = df_submissions['problem_id'].astype('category')

# Damage report
print(f"✓ Profiles    — {len(df_profiles)} users remaining")
print(f"✓ Submissions — {len(df_submissions)} rows remaining")

TAG_COLS = [col for col in df_submissions.columns if col.startswith('tag_')]
MAX_RATING = 3500

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — Build per-(user, tag) aggregates FROM SUBMISSIONS
# Process one tag at a time to avoid the huge intermediate DataFrame that
# melt() produces (N_rows × N_tags), which OOMs on GitHub Actions runners.
# ─────────────────────────────────────────────────────────────────────────────
base_cols = ['handle', 'problem_id', 'problem_rating', 'is_ac', 'is_wa']
parts = []
for tag_col in TAG_COLS:
    tag_subs = df_submissions.loc[df_submissions[tag_col] == 1, base_cols]
    if tag_subs.empty:
        continue
    # observed=True is essential: a categorical 'handle' otherwise emits a row
    # per *unseen* category, exploding the result to N_handles × everything.
    grp = tag_subs.groupby('handle', observed=True)
    agg = grp.agg(
        total_attempts       = ('problem_id',     'count'),
        ac_count             = ('is_ac',          'sum'),
        wa_count             = ('is_wa',          'sum'),
        avg_rating_attempted = ('problem_rating', 'mean'),
    )
    ac_grp = (tag_subs[tag_subs['is_ac'] == 1]
              .groupby('handle', observed=True)['problem_rating'])
    agg['max_rating_solved'] = ac_grp.max().reindex(agg.index, fill_value=0)
    agg['avg_rating_solved'] = ac_grp.mean().reindex(agg.index, fill_value=0)
    agg['tag'] = tag_col
    parts.append(agg.reset_index())
    del tag_subs, grp, ac_grp, agg

# df_submissions is no longer needed; free ~1 GB before the heavier merge/pivot.
del df_submissions

user_tag_df = pd.concat(parts, ignore_index=True)
del parts
# 'handle' came out of the groupby as a categorical; downstream merges/pivots on
# it are fine, but make it a plain string to avoid category-alignment surprises.
user_tag_df['handle'] = user_tag_df['handle'].astype(str)
user_tag_df[['max_rating_solved', 'avg_rating_solved']] = (
    user_tag_df[['max_rating_solved', 'avg_rating_solved']].fillna(0)
)

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — Merge user-level profile signals
# ─────────────────────────────────────────────────────────────────────────────
profile_cols = ['handle', 'cf_rating', 'cf_max_rating', 'first_try_rate',
                'avg_attempts_to_ac', 'tag_coverage_pct']
user_tag_df = user_tag_df.merge(df_profiles[profile_cols], on='handle', how='left')

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Compute component scores
# ─────────────────────────────────────────────────────────────────────────────
SMOOTHING = 2

user_tag_df['acceptance_rate']  = ((user_tag_df['ac_count'] + SMOOTHING * 0.5) / (user_tag_df['total_attempts'] + SMOOTHING))
user_tag_df['difficulty_score'] = (user_tag_df['avg_rating_solved'] / MAX_RATING).clip(0, 1)
user_tag_df['rating_boost']     = ((user_tag_df['cf_rating'] + user_tag_df['cf_max_rating']) / (2 * MAX_RATING)).clip(0, 1)
user_tag_df['efficiency_score'] = user_tag_df['first_try_rate'].clip(0, 1)
user_tag_df['volume_score']     = (np.log1p(user_tag_df['ac_count']) / np.log1p(50)).clip(0, 1)

# specialization_score = tag_ac / total_solved_by_user
# Measures how focused the user is on this tag relative to their overall activity.
# Uses total_ac from the profiles table (merged in step 2 as a proxy via tag_coverage_pct).
# We merge total_ac directly from profiles for accuracy.
user_tag_df = user_tag_df.merge(
    df_profiles[['handle', 'total_ac']], on='handle', how='left'
)
user_tag_df['specialization_score'] = (
    user_tag_df['ac_count'] / user_tag_df['total_ac'].replace(0, np.nan)
).fillna(0).clip(0, 1)

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — Weighted combination  (weights must sum to 1.0)
# ─────────────────────────────────────────────────────────────────────────────
WEIGHTS = {
    'acceptance_rate':      0.30,
    'difficulty_score':     0.30,
    'rating_boost':         0.20,
    'specialization_score': 0.10,
    'efficiency_score':     0.075,
    'volume_score':         0.075,
}
# Profile-derived components (rating_boost, efficiency_score, ...) are NaN for any
# handle present in submissions but missing from profiles (left-join). Fill those
# component NaNs with 0 so tag_strength is always defined — otherwise an entire
# handle group can be all-NA and idxmax/idxmin raise in pandas >= 2.1.
for col in WEIGHTS:
    user_tag_df[col] = user_tag_df[col].fillna(0)

user_tag_df['tag_strength'] = sum(
    user_tag_df[col] * w for col, w in WEIGHTS.items()
).clip(0, 1)

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — Strongest / weakest tag per user → merge back to profiles
# ─────────────────────────────────────────────────────────────────────────────
tag_pivot = user_tag_df.pivot_table(
    index='handle', columns='tag', values='tag_strength'
).reset_index()
tag_pivot.columns = [
    'handle' if c == 'handle' else f'strength_{c}' for c in tag_pivot.columns
]

strongest = (
    user_tag_df.loc[user_tag_df.groupby('handle')['tag_strength'].idxmax(), ['handle', 'tag', 'tag_strength']]
    .rename(columns={'tag': 'strongest_tag_computed', 'tag_strength': 'strongest_tag_score'})
)
weakest = (
    user_tag_df[user_tag_df['ac_count'] > 0]
    .loc[lambda d: d.groupby('handle')['tag_strength'].idxmin(), ['handle', 'tag', 'tag_strength']]
    .rename(columns={'tag': 'weakest_tag_computed', 'tag_strength': 'weakest_tag_score'})
)

df_profiles_enriched = (
    df_profiles
    .merge(tag_pivot, on='handle', how='left')
    .merge(strongest, on='handle', how='left')
    .merge(weakest,   on='handle', how='left')
)

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6 — Export (QUOTE_ALL prevents Excel from corrupting handles again)
# ─────────────────────────────────────────────────────────────────────────────
user_tag_df.to_csv('../dataset/06_user_tag_strengths.csv',    index=False, quoting=csv.QUOTE_ALL)
df_profiles_enriched.to_csv('../dataset/07_enriched_user_profiles.csv', index=False, quoting=csv.QUOTE_ALL)

print("\n✓ user_tag_df shape:          ", user_tag_df.shape)
print("✓ df_profiles_enriched shape: ", df_profiles_enriched.shape)
print("\nSample tag strengths:")
print(
    user_tag_df[['handle', 'tag', 'acceptance_rate', 'difficulty_score',
                 'rating_boost', 'specialization_score', 'efficiency_score', 'volume_score', 'tag_strength']]
    .sort_values(['handle', 'tag_strength'], ascending=[True, False])
    .head(15)
    .to_string(index=False)
)