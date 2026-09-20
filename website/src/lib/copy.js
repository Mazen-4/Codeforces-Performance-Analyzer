// Human-facing copy for every metric and topic.
//
// Rule for this file: say what a number MEANS and what to DO about it. Never
// how it is computed, never the model, never the math. If a sentence would only
// make sense to someone who has read the source, it does not belong here.

export const TAG_INFO = {
  tag_dp: {
    name: "Dynamic Programming",
    blurb: "Breaking a hard problem into overlapping smaller ones.",
    why: "The single biggest divider between mid and high ratings. Most contests have at least one.",
  },
  tag_greedy: {
    name: "Greedy",
    blurb: "Taking the best immediate choice and proving it stays best.",
    why: "Fast to write when it works. Knowing when it fails saves you hours.",
  },
  tag_graphs: {
    name: "Graphs",
    blurb: "Problems about things connected to other things.",
    why: "Shows up constantly, and the same handful of traversals solve most of them.",
  },
  tag_math: {
    name: "Math",
    blurb: "Number sense, formulas and counting arguments.",
    why: "Often turns a long simulation into three lines of code.",
  },
  tag_strings: {
    name: "Strings",
    blurb: "Pattern matching and text manipulation.",
    why: "A reliable source of mid-difficulty points once the standard tools click.",
  },
  tag_impl: {
    name: "Implementation",
    blurb: "Careful, exact coding of a clearly stated process.",
    why: "Pure execution. Cleaning this up removes the losses that feel avoidable.",
  },
  tag_binary_search: {
    name: "Binary Search",
    blurb: "Halving the search space until the answer is pinned down.",
    why: "Quietly converts many impossible-looking limits into easy ones.",
  },
  tag_data_structures: {
    name: "Data Structures",
    blurb: "Choosing the right container so operations stay fast.",
    why: "The difference between a solution that passes and one that times out.",
  },
  tag_number_theory: {
    name: "Number Theory",
    blurb: "Divisors, primes and modular arithmetic.",
    why: "Concentrated in harder problems, and highly learnable.",
  },
  tag_combinatorics: {
    name: "Combinatorics",
    blurb: "Counting possibilities without listing them.",
    why: "Unlocks a whole class of problems that look intractable at first.",
  },
  tag_geometry: {
    name: "Geometry",
    blurb: "Points, lines, shapes and the precision they demand.",
    why: "Less frequent, but nearly free points when others skip it.",
  },
  tag_trees: {
    name: "Trees",
    blurb: "Hierarchies and the paths through them.",
    why: "A favourite of problem setters, with very repeatable techniques.",
  },
  tag_sortings: {
    name: "Sorting",
    blurb: "Ordering data to make the next step obvious.",
    why: "The cheapest simplification in competitive programming.",
  },
  tag_two_pointers: {
    name: "Two Pointers",
    blurb: "Sweeping a window across sorted data.",
    why: "Turns quadratic brute force into something that comfortably passes.",
  },
  tag_bitmasks: {
    name: "Bitmasks",
    blurb: "Packing states into bits to move through them quickly.",
    why: "Essential once small-input exhaustive search appears.",
  },
  tag_flows: {
    name: "Flows",
    blurb: "Routing capacity through a network.",
    why: "Rare but decisive. Recognising one is most of the battle.",
  },
  tag_fft: {
    name: "Fast Transforms",
    blurb: "Multiplying and convolving at scale.",
    why: "Advanced territory. Worth it once the fundamentals are solid.",
  },
  tag_games: {
    name: "Game Theory",
    blurb: "Two players, perfect play, who wins.",
    why: "Small, self-contained theory that pays off immediately.",
  },
  tag_probabilities: {
    name: "Probability",
    blurb: "Expected values and random processes.",
    why: "Appears in harder rounds and rewards clear thinking over code.",
  },
  tag_constructive: {
    name: "Constructive",
    blurb: "Building an answer that satisfies every constraint.",
    why: "Tests insight rather than knowledge. Pure problem-solving practice.",
  },
};

export function tagInfo(key) {
  return TAG_INFO[key] || {
    name: key.replace(/^tag_/, "").replace(/_/g, " "),
    blurb: "",
    why: "",
  };
}

// Metric explanations shown in tooltips and info cards.
export const METRICS = {
  score: {
    label: "Topic score",
    short: "How strong you are in this topic, compared with competitors at your level.",
    long: "Scores run from 0 to 100. A high score means you handle this topic at least as well as others around your rating. A low score points to a gap you can close, which is usually where the fastest progress is available.",
  },
  coverage: {
    label: "Practice volume",
    short: "How much you have actually attempted in this topic.",
    long: "A low score backed by very little practice is not really a weakness yet, it is an unknown. Topics with real attempts behind them give you a much more reliable read.",
  },
  difficulty: {
    label: "Comfort range",
    short: "The problem difficulty where you currently succeed most often.",
    long: "Working just above this range is where improvement happens fastest. Far below it is revision; far above it usually costs time without teaching much.",
  },
  accuracy: {
    label: "Solve rate",
    short: "How often your attempts in this topic end in a solve.",
    long: "A high solve rate with a low score often means you are only attempting the easier problems in this topic. Pushing the difficulty is the next step.",
  },
  priority: {
    label: "Why this problem",
    short: "Picked to match your level and target a topic worth improving.",
    long: "Each suggestion balances two things: hard enough to teach you something, close enough to your current level that you can realistically finish it.",
  },
};

// Rotating lines for the landing hero.
export const TAGLINES = [
  "Know exactly what to practise next.",
  "Your rating is a number. This is the reason behind it.",
  "Stop guessing which topic is holding you back.",
];

/** Turn a weakest-topic key into a short headline sentence. */
export function weakestHeadline(tagKey) {
  const t = tagInfo(tagKey);
  return `${t.name} is where you have the most to gain right now.`;
}
