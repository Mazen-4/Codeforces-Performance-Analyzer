// Classifying, labelling and selecting recommended problems.
//
// Kept out of the component so the selection rules can be tested directly and
// so the same labels are used by the list and the filters.

import { tagInfo } from "./copy.js";

/** Normalize one recommendation from the pipeline into a flat shape. */
export function normalize(p, i = 0) {
  const id = String(p.id ?? p.problem_id ?? "");
  const [contest, index] = id.split("_");
  const rating = Number(p.rating ?? p.problem_rating) || null;
  return {
    id,
    key: id || `p${i}`,
    name: p.problem_name || p.name || id,
    rating,
    // tags arrive as "tag_dp"; keep the raw key for filtering and a readable
    // name for display.
    tagKeys: (p.tags || []).map(String),
    tagNames: (p.tags || []).map((t) => tagInfo(t).name).filter(Boolean),
    priority: Number(p.final_score ?? p.score ?? 0),
    popularity: Number(p.problem_score ?? 0),
    weaknessBoost: Number(p.weakness_boost ?? 0),
    url: contest && index
      ? `https://codeforces.com/problemset/problem/${contest}/${index}`
      : null,
  };
}

/**
 * Difficulty relative to the user, not in absolute terms: a 1600 problem is
 * "hard" for a newcomer and "easy" for a candidate master. Falls back to
 * absolute bands when the rating is unknown.
 */
export function difficultyBand(rating, userRating) {
  if (!rating) return null;
  const base = userRating && userRating > 0 ? userRating : 1400;
  const diff = rating - base;
  if (diff <= -150) return "easy";
  if (diff >= 250) return "hard";
  return "mid";
}

const DIFFICULTY_LABEL = {
  easy: { label: "Warm-up",  hint: "Comfortably within your range. Good for building rhythm." },
  mid:  { label: "Stretch",  hint: "Just beyond where you are now. This is where progress happens." },
  hard: { label: "Reach",    hint: "Deliberately hard. Expect to struggle, and learn from it." },
};

/**
 * Attach display labels. `pool` is the full candidate list, used to work out
 * what counts as widely-solved or high-priority relative to everything else.
 */
export function withLabels(problems, userRating) {
  if (!problems.length) return [];

  const pops = problems.map((p) => p.popularity).filter((x) => x > 0).sort((a, b) => a - b);
  const popCut = pops.length ? pops[Math.floor(pops.length * 0.7)] : Infinity;

  const pris = problems.map((p) => p.priority).sort((a, b) => b - a);
  const priCut = pris.length ? pris[Math.min(4, pris.length - 1)] : -Infinity;

  return problems.map((p) => {
    const band = difficultyBand(p.rating, userRating);
    const labels = [];

    if (p.priority >= priCut && p.priority > 0) {
      labels.push({
        id: "priority", text: "Top priority", tone: "priority",
        hint: "Targets a topic where you have the most to gain.",
      });
    }
    if (p.popularity >= popCut && p.popularity > 0) {
      labels.push({
        id: "common", text: "Commonly solved", tone: "common",
        hint: "Most competitors at your level have solved this one.",
      });
    }
    if (band) {
      const d = DIFFICULTY_LABEL[band];
      labels.push({ id: band, text: d.label, tone: band, hint: d.hint });
    }
    if (p.weaknessBoost >= 0.5) {
      labels.push({
        id: "weakness", text: "Weak spot", tone: "weakness",
        hint: "Hits a topic scoring below your peers.",
      });
    }
    return { ...p, band, labels };
  });
}

/**
 * Pick the headline set: 3 top priority, 1 warm-up, 1 stretch, 1 reach,
 * 3 commonly solved, then fill to `total` with the next best by priority.
 * Never repeats a problem across buckets.
 */
export function selectHeadline(labelled, total = 12) {
  const picked = [];
  const seen = new Set();
  const take = (list, n) => {
    for (const p of list) {
      if (picked.length >= total) return;
      if (n <= 0) return;
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      picked.push(p);
      n -= 1;
    }
  };

  const byPriority = [...labelled].sort((a, b) => b.priority - a.priority);
  const byPopular  = [...labelled].sort((a, b) => b.popularity - a.popularity);

  take(byPriority, 3);
  take(byPriority.filter((p) => p.band === "easy"), 1);
  take(byPriority.filter((p) => p.band === "mid"),  1);
  take(byPriority.filter((p) => p.band === "hard"), 1);
  take(byPopular, 3);
  take(byPriority, total - picked.length);   // fill the remainder

  return picked;
}

export const SORTS = {
  priority:  { label: "Highest priority", fn: (a, b) => b.priority - a.priority },
  easiest:   { label: "Lowest rating",    fn: (a, b) => (a.rating ?? 1e9) - (b.rating ?? 1e9) },
  common:    { label: "Most common",      fn: (a, b) => b.popularity - a.popularity },
  hardest:   { label: "Highest rating",   fn: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) },
};

/** Apply topic and rating filters. */
export function applyFilters(problems, { topic, minRating, maxRating }) {
  return problems.filter((p) => {
    if (topic && !p.tagKeys.includes(topic)) return false;
    if (minRating && (p.rating ?? 0) < minRating) return false;
    if (maxRating && (p.rating ?? 0) > maxRating) return false;
    return true;
  });
}

/** Topics present in the candidate list, for the filter dropdown. */
export function availableTopics(problems) {
  const counts = new Map();
  for (const p of problems) {
    for (const t of p.tagKeys) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, n]) => ({ key, name: tagInfo(key).name, count: n }))
    .sort((a, b) => b.count - a.count);
}
