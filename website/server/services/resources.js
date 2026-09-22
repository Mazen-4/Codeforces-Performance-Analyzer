// Learning resources per topic, curated rather than crawled.
//
// Why a fixed table and not retrieval: the space is ~20 topics with a handful
// of genuinely good references each. That is a curated list, not a search
// problem, and a hand-checked link beats a crawled one whose quality nothing
// verified. It also costs nothing at plan time.
//
// Each entry carries a rating band so a 1200-rated player is not sent to a
// treatment written for 2000+. `pickResources` filters on that band.
//
// Keeping these accurate is maintenance: if a link rots, fix it here and every
// future plan is corrected.

const A = (title, url, kind, min, max, note) =>
  ({ title, url, kind, min_rating: min, max_rating: max, note });

// kind: "article" | "video" | "practice"
export const RESOURCES = {
  tag_dp: [
    A("CP-Algorithms: Dynamic Programming", "https://cp-algorithms.com/dynamic_programming/intro-to-dp.html", "article", 0, 3500, "Reference for the standard forms."),
    A("Errichto — Dynamic Programming lessons", "https://www.youtube.com/playlist?list=PLl0KD3g-oDOHpWRyyGBUJ9jmul0lUOD80", "video", 1000, 2000, "Worked from scratch, slowly. Best starting point."),
    A("USACO Guide: Introduction to DP", "https://usaco.guide/gold/intro-dp", "article", 1200, 1900, "Structured, with problems attached."),
    A("Codeforces EDU: DP section", "https://codeforces.com/edu/courses", "practice", 1300, 2100, "Graded problems with editorial feedback."),
  ],
  tag_greedy: [
    A("USACO Guide: Greedy Algorithms", "https://usaco.guide/silver/greedy-sorting", "article", 900, 1700, "Focuses on when greedy is provably correct."),
    A("CP-Algorithms: Scheduling & exchange arguments", "https://cp-algorithms.com/schedules/schedule_two_machines.html", "article", 1400, 2400, "The proof style that separates guessing from knowing."),
    A("Codeforces: greedy problemset by rating", "https://codeforces.com/problemset?tags=greedy", "practice", 0, 3500, "Filter by your band and grind the tag."),
  ],
  tag_graphs: [
    A("CP-Algorithms: Graph algorithms", "https://cp-algorithms.com/graph/breadth-first-search.html", "article", 0, 3500, "BFS/DFS/Dijkstra reference implementations."),
    A("WilliamFiset — Graph Theory playlist", "https://www.youtube.com/playlist?list=PLDV1Zeh2NRsDGO4--qE8yH72HFL1Km93P", "video", 1000, 2000, "Clear animations for the standard traversals."),
    A("USACO Guide: Graph Traversal", "https://usaco.guide/silver/graph-traversal", "article", 1100, 1800, "Problem-first, good for building intuition."),
  ],
  tag_math: [
    A("CP-Algorithms: Algebra", "https://cp-algorithms.com/algebra/binary-exp.html", "article", 0, 3500, "Binary exponentiation, GCD, modular arithmetic."),
    A("USACO Guide: Math for CP", "https://usaco.guide/gold/intro-nt", "article", 1200, 2000, "The maths that actually appears in contests."),
  ],
  tag_strings: [
    A("CP-Algorithms: String processing", "https://cp-algorithms.com/string/string-hashing.html", "article", 1300, 3500, "Hashing, Z-function, prefix function."),
    A("Errichto — String hashing", "https://www.youtube.com/watch?v=rA1ZevamGDc", "video", 1300, 2000, "Why hashing works and how it breaks."),
    A("USACO Guide: String Algorithms", "https://usaco.guide/gold/string-hashing", "article", 1300, 2100, ""),
  ],
  tag_impl: [
    A("Codeforces: implementation problems", "https://codeforces.com/problemset?tags=implementation", "practice", 0, 3500, "The fix is volume and care, not theory."),
    A("Errichto — Speed and accuracy in contests", "https://www.youtube.com/watch?v=Bkm5ZfsMNzI", "video", 1000, 2200, "Habits that cut silly mistakes."),
  ],
  tag_binary_search: [
    A("CP-Algorithms: Binary search", "https://cp-algorithms.com/num_methods/binary_search.html", "article", 0, 2200, "Including binary search on the answer."),
    A("Errichto — Binary search", "https://www.youtube.com/watch?v=GU7DpgHINWQ", "video", 1000, 1900, "The predicate framing that makes it click."),
    A("USACO Guide: Binary Search", "https://usaco.guide/silver/binary-search", "article", 1000, 1800, ""),
  ],
  tag_data_structures: [
    A("CP-Algorithms: Data structures", "https://cp-algorithms.com/data_structures/fenwick.html", "article", 1300, 3500, "Fenwick and segment trees."),
    A("Codeforces EDU: Segment Tree course", "https://codeforces.com/edu/course/2", "practice", 1500, 2400, "The best structured segment tree material anywhere."),
    A("USACO Guide: Point Update Range Sum", "https://usaco.guide/gold/PURS", "article", 1400, 2100, ""),
  ],
  tag_number_theory: [
    A("CP-Algorithms: Number theory", "https://cp-algorithms.com/algebra/sieve-of-eratosthenes.html", "article", 1100, 3500, "Sieve, factorisation, modular inverse."),
    A("USACO Guide: Number Theory", "https://usaco.guide/gold/intro-nt", "article", 1300, 2100, ""),
  ],
  tag_combinatorics: [
    A("CP-Algorithms: Combinatorics", "https://cp-algorithms.com/combinatorics/binomial-coefficients.html", "article", 1300, 3500, "Binomials, inclusion-exclusion."),
    A("USACO Guide: Combinatorics", "https://usaco.guide/gold/combo", "article", 1400, 2200, ""),
  ],
  tag_geometry: [
    A("CP-Algorithms: Geometry", "https://cp-algorithms.com/geometry/basic-geometry.html", "article", 1500, 3500, "Cross products, convex hull."),
    A("USACO Guide: Geometry Primitives", "https://usaco.guide/plat/geo-pri", "article", 1700, 2600, ""),
  ],
  tag_trees: [
    A("CP-Algorithms: LCA and tree algorithms", "https://cp-algorithms.com/graph/lca.html", "article", 1400, 3500, ""),
    A("USACO Guide: Tree Basics", "https://usaco.guide/silver/tree-euler", "article", 1200, 2000, "DFS on trees, subtree sizes, Euler tour."),
    A("WilliamFiset — Tree algorithms", "https://www.youtube.com/playlist?list=PLDV1Zeh2NRsDGO4--qE8yH72HFL1Km93P", "video", 1200, 2000, ""),
  ],
  tag_sortings: [
    A("USACO Guide: Sorting & custom comparators", "https://usaco.guide/silver/sorting-custom", "article", 900, 1600, "Most sorting problems are really comparator problems."),
    A("Codeforces: sortings problemset", "https://codeforces.com/problemset?tags=sortings", "practice", 0, 3500, ""),
  ],
  tag_two_pointers: [
    A("USACO Guide: Two Pointers", "https://usaco.guide/silver/two-pointers", "article", 1000, 1800, ""),
    A("CP-Algorithms: Sliding window / two pointers", "https://cp-algorithms.com/others/sliding_window.html", "article", 1100, 2000, ""),
  ],
  tag_bitmasks: [
    A("CP-Algorithms: Bit manipulation", "https://cp-algorithms.com/algebra/bit-manipulation.html", "article", 1200, 3500, ""),
    A("USACO Guide: Bitmask DP", "https://usaco.guide/gold/dp-bitmasks", "article", 1600, 2400, "Where bitmasks earn their keep."),
    A("Errichto — Bitwise operations", "https://www.youtube.com/watch?v=xXKL9YBWgCY", "video", 1100, 1900, ""),
  ],
  tag_flows: [
    A("CP-Algorithms: Maximum flow", "https://cp-algorithms.com/graph/edmonds_karp.html", "article", 1900, 3500, "Only worth learning once the basics are solid."),
    A("USACO Guide: Maximum Flow", "https://usaco.guide/adv/max-flow", "article", 2000, 3000, ""),
  ],
  tag_fft: [
    A("CP-Algorithms: Fast Fourier Transform", "https://cp-algorithms.com/algebra/fft.html", "article", 2000, 3500, "Rare below 2000; safe to defer."),
  ],
  tag_games: [
    A("CP-Algorithms: Game theory (Sprague-Grundy)", "https://cp-algorithms.com/game_theory/sprague-grundy-nim.html", "article", 1600, 3500, ""),
    A("USACO Guide: Game Theory", "https://usaco.guide/plat/game-theory", "article", 1700, 2600, ""),
  ],
  tag_probabilities: [
    A("CP-Algorithms: Probability", "https://cp-algorithms.com/combinatorics/prob.html", "article", 1600, 3500, ""),
    A("USACO Guide: Probability & Expected Value", "https://usaco.guide/plat/expected-value", "article", 1700, 2600, "Linearity of expectation does most of the work."),
  ],
  tag_constructive: [
    A("Codeforces: constructive problemset", "https://codeforces.com/problemset?tags=constructive+algorithms", "practice", 0, 3500, "Pattern recognition built by volume."),
    A("Codeforces blog: Constructive algorithms", "https://codeforces.com/blog/entry/14185", "article", 1200, 2200, "How to search for a construction systematically."),
  ],
};

/**
 * Resources for one tag, filtered to the user's rating band and ranked so the
 * most approachable comes first.
 *
 * The band is widened by 200 points each way before giving up: an exact-match
 * filter would leave some tag/rating pairs with nothing, and a slightly
 * mismatched resource beats none at all.
 */
export function pickResources(tag, rating, limit = 2) {
  const all = RESOURCES[tag] || [];
  if (!all.length) return [];

  const r = Number(rating) || 1200;
  const inBand = all.filter(x => r >= x.min_rating && r <= x.max_rating);
  const chosen = inBand.length
    ? inBand
    : all.filter(x => r >= x.min_rating - 200 && r <= x.max_rating + 200);
  const finalList = chosen.length ? chosen : all;

  // A video first when one fits: for a topic someone is weak at, being talked
  // through it beats reading a reference.
  const rank = { video: 0, article: 1, practice: 2 };
  return [...finalList]
    .sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3))
    .slice(0, limit);
}

/** Compact lines for the prompt: the model picks from these, never invents. */
export function resourceLinesFor(tags, rating) {
  const out = [];
  for (const tag of tags) {
    for (const r of pickResources(tag, rating, 2)) {
      out.push(`  - [${tag}] ${r.title} (${r.kind}) -> ${r.url}${r.note ? ` | ${r.note}` : ""}`);
    }
  }
  return out.join("\n");
}
