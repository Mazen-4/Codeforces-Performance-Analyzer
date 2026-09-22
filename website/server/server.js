import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync, statSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import cookieParser from "cookie-parser";
import { dbEnabled, ensureSchema, query } from "./db/pool.js";
import { attachUser, pruneExpired, requireAuth } from "./middleware/auth.js";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import paymentRoutes from "./routes/payments.js";
import {
  otherHandleWindow, waitMessage, OTHER_HANDLE_DAYS,
} from "./services/quotas.js";
import { resourceLinesFor } from "./services/resources.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Project root: use env var on Render, otherwise resolve from server.js location
const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "../../");

// Pick Python interpreter: prefer .venv (local dev), fall back to system python3 (Render)
const VENV_PYTHON = path.join(PROJECT_ROOT, ".venv", "bin", "python");
const PYTHON = existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3";

const app = express();
// Railway terminates TLS at its proxy; trust one hop so req.ip and secure
// cookies behave correctly.
app.set("trust proxy", 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Accounts are optional: without DATABASE_URL the analyzer still works
// anonymously, it just cannot sign anyone in.
const ACCOUNTS_ENABLED = dbEnabled();
if (ACCOUNTS_ENABLED) {
  app.use(attachUser);
  ensureSchema()
    .then(() => { console.log("Account schema ready."); return pruneExpired(); })
    .catch((err) => console.error("Account schema setup failed:", err.message));
  setInterval(pruneExpired, 6 * 60 * 60 * 1000).unref();
} else {
  console.warn("DATABASE_URL not set — accounts and admin are disabled.");
  app.use((req, _res, next) => { req.user = null; next(); });
}

// ─── Clock validation ───────────────────────────────────────────────────────
// Subscriptions depend on an accurate clock: a device that is hours or years
// off would compute the wrong billing period, show an expired plan as active,
// or let a lapsed one keep working. The server's time is the authority — the
// client sends its own clock and we compare.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

app.get("/api/time", (req, res) => {
  // No caching: a cached timestamp is worse than useless for this check.
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.json({ server_time: Date.now(), max_skew_ms: MAX_CLOCK_SKEW_MS });
});

/** Express guard for routes that must not run on a device with a bad clock. */
function requireAccurateClock(req, res, next) {
  const raw = req.get("X-Client-Time");
  if (!raw) return next();   // older clients: do not lock them out

  const clientTime = Number(raw);
  if (!Number.isFinite(clientTime)) return next();

  const skew = Math.abs(Date.now() - clientTime);
  if (skew > MAX_CLOCK_SKEW_MS) {
    return res.status(409).json({
      error: "Your device clock is wrong, so this action is paused. "
           + "Turn on automatic date and time, then try again.",
      code: "CLOCK_SKEW",
      server_time: Date.now(),
      client_time: clientTime,
      skew_ms: skew,
    });
  }
  return next();
}

app.get("/api/config", (_req, res) => {
  res.json({ accounts_enabled: ACCOUNTS_ENABLED });
});

if (ACCOUNTS_ENABLED) {
  // Coarse network-level limits. The per-account lockout in routes/auth.js is
  // the real credential-stuffing defence; this caps raw request volume.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 60,
    standardHeaders: "draft-7", legacyHeaders: false,
    message: { error: "Too many requests. Try again shortly." },
  });
  app.use("/api/auth/login",  authLimiter);
  app.use("/api/auth/signup", authLimiter);
  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);
}

// The ML pipeline spawns a Python process per call, so it must not be a free
// denial-of-service lever.
app.use("/api/ml/analyze", rateLimit({
  windowMs: 10 * 60 * 1000, limit: 20,
  standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "You have run a lot of analyses. Try again in a few minutes." },
}));

// ── Serve React frontend (production build) ───────────────────────────────────
const STATIC_DIR = path.join(PROJECT_ROOT, "website", "dist");
if (existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
}

// Health check for Render
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Count the distinct users the KNN model is trained on = unique handles in the
// tag-strengths CSV (one row per handle×tag). Streamed so a large file never
// loads fully into memory. Cached on (path, mtime) so we don't rescan per call.
const TAG_STRENGTHS_CSV = path.join(PROJECT_ROOT, "ML", "dataset", "06_user_tag_strengths.csv");
let _trainingUsersCache = null; // { mtimeMs, count }

async function countTrainingUsers() {
  // Prefer the database: the web container no longer ships the dataset CSV,
  // because it is ~1.5 GB and now lives in Postgres.
  if (ACCOUNTS_ENABLED) {
    try {
      if (_trainingUsersCache?.fromDb
          && Date.now() - _trainingUsersCache.at < 6 * 60 * 60 * 1000) {
        return _trainingUsersCache.count;
      }
      const { rows } = await query(
        `SELECT count(DISTINCT handle)::int AS n FROM user_tag_strengths`);
      _trainingUsersCache = { fromDb: true, at: Date.now(), count: rows[0].n };
      return rows[0].n;
    } catch (err) {
      console.error("training_users from db failed:", err.message);
      // fall through to the CSV, which local runs still have
    }
  }
  if (!existsSync(TAG_STRENGTHS_CSV)) return null;
  const mtimeMs = statSync(TAG_STRENGTHS_CSV).mtimeMs;
  if (_trainingUsersCache && _trainingUsersCache.mtimeMs === mtimeMs) {
    return _trainingUsersCache.count;
  }
  const { createReadStream } = await import("node:fs");
  const { createInterface } = await import("node:readline");
  const handles = new Set();
  let isHeader = true;
  const rl = createInterface({
    input: createReadStream(TAG_STRENGTHS_CSV, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; }
    if (!line) continue;
    // handle is the first column; it may be quoted and contain escaped commas.
    const m = line.match(/^"((?:[^"]|"")*)"|^([^,]*)/);
    const handle = m ? (m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2]) : "";
    if (handle) handles.add(handle);
  }
  _trainingUsersCache = { mtimeMs, count: handles.size };
  return handles.size;
}

// Model fingerprint — verify which model build is live (new vs. old/committed).
// Reports each .pkl's SHA-256 and modified time so you can match it against the
// GitHub Release the weekly retrain published. Also reports training_users (the
// dynamic count the KNN model was trained on) and last_updated (newest model).
// Headline dataset figures for the homepage. Cached for six hours: these
// change only when the weekly retrain republishes, and the counts are a
// full scan of a 14M-row table.
let _statsCache = null;
app.get("/api/stats", async (_req, res) => {
  try {
    if (_statsCache && Date.now() - _statsCache.at < 6 * 60 * 60 * 1000) {
      return res.json(_statsCache.data);
    }
    if (!ACCOUNTS_ENABLED) return res.json({});
    const { rows } = await query(`
      SELECT
        (SELECT count(DISTINCT handle)::int FROM user_tag_strengths)  AS peers,
        (SELECT count(*)::bigint FROM submissions)                    AS submissions,
        (SELECT count(DISTINCT problem_id)::int FROM submissions)     AS problems`);
    const data = {
      peers: Number(rows[0].peers),
      submissions: Number(rows[0].submissions),
      problems: Number(rows[0].problems),
      topics: 20,
    };
    _statsCache = { at: Date.now(), data };
    res.json(data);
  } catch (err) {
    console.error("stats failed:", err.message);
    res.json({});          // the homepage has static fallbacks
  }
});

app.get("/api/ml/version", async (_req, res) => {
  const modelsDir = path.join(PROJECT_ROOT, "ML", "models");
  const files = ["success_model.pkl", "attempts_model.pkl", "rating_progression_model.pkl"];
  const models = files.map(name => {
    const p = path.join(modelsDir, name);
    if (!existsSync(p)) return { name, present: false };
    const buf = readFileSync(p);
    return {
      name,
      present: true,
      sha256: createHash("sha256").update(buf).digest("hex").slice(0, 16),
      size_bytes: buf.length,
      modified: statSync(p).mtime.toISOString(),
    };
  });

  const modifiedTimes = models.filter(m => m.present).map(m => m.modified).sort();
  const last_updated = modifiedTimes.length ? modifiedTimes[modifiedTimes.length - 1] : null;

  let training_users = null;
  try {
    training_users = await countTrainingUsers();
  } catch (err) {
    console.error("training_users count failed:", err.message);
  }

  res.json({ models, training_users, last_updated });
});

/* ───────────── Codeforces Fetch ───────────── */

app.get("/api/cf/:handle", async (req, res) => {
  const { handle } = req.params;

  try {
    // Paginate through all submissions (CF returns max 10000 per call)
    const allSubmissions = [];
    const batchSize = 10000;
    let from = 1;
    while (true) {
      const statusRes = await fetch(
        `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=${from}&count=${batchSize}`
      );
      const statusData = await statusRes.json();
      if (statusData.status !== "OK") {
        if (from === 1) return res.json({ status: "FAILED", submissions: [], problems: [] });
        break;
      }
      const batch = statusData.result;
      allSubmissions.push(...batch);
      if (batch.length < batchSize) break;
      from += batchSize;
    }

    const problemsRes = await fetch(`https://codeforces.com/api/problemset.problems`);
    const problemsData = await problemsRes.json();

    res.json({
      status: "OK",
      submissions: allSubmissions,
      problems: problemsData.result?.problems || [],
    });
  } catch (err) {
    res.status(500).json({ error: "Codeforces fetch failed" });
  }
});

/* ───────────── AI Coach (Claude) ───────────── */

// Models an admin may select. Restricting to a list means a typo in the admin
// UI cannot point production at a model that does not exist.
const COACH_MODELS = {
  "claude-opus-5":   { label: "Opus 5",   note: "Most capable. ~2¢ per plan." },
  "claude-sonnet-5": { label: "Sonnet 5", note: "Cheaper and faster. ~1¢ per plan." },
};
const DEFAULT_COACH_MODEL = "claude-opus-5";

// How many plans a free account may generate before Plus is required.
const FREE_COACH_PLANS = 2;

// Cached so a plan request does not hit the database first. Invalidated on
// write, so an admin change takes effect on the next request.
// 60s TTL rather than an explicit invalidation hook: an admin switching the
// model is rare, and a minute's lag is not worth coupling the two modules.
let _coachModelCache = null;
async function getCoachModel() {
  if (_coachModelCache && Date.now() - _coachModelCache.at < 60_000) {
    return _coachModelCache.model;
  }
  let model = process.env.COACH_MODEL || DEFAULT_COACH_MODEL;
  try {
    if (ACCOUNTS_ENABLED) {
      const { rows } = await query(
        `SELECT value FROM app_settings WHERE key = 'coach_model'`);
      if (rows.length && COACH_MODELS[rows[0].value]) model = rows[0].value;
    }
  } catch { /* fall back to the default rather than failing the request */ }
  if (!COACH_MODELS[model]) model = DEFAULT_COACH_MODEL;
  _coachModelCache = { at: Date.now(), model };
  return model;
}
app.get("/api/coach/config", async (req, res) => {
  const model = await getCoachModel();
  res.json({
    available: Boolean(process.env.ANTHROPIC_API_KEY),
    model,
    label: COACH_MODELS[model]?.label ?? model,
  });
});

/**
 * Strip repeated Codeforces problem IDs from a generated plan.
 *
 * The first appearance of an ID is kept; any later one is swapped for a
 * generic instruction, because a student who has already solved a problem
 * gains nothing from being sent back to it. Operates only on the text inside
 * list items, so it cannot damage the surrounding markup.
 */
function dedupeProblemIds(html) {
  const seen = new Set();
  // Codeforces IDs as the prompt emits them: digits, underscore, index.
  return String(html).replace(/\b(\d+[A-Za-z0-9]*_[A-Z][0-9]*)\b(\s*\(\d{3,4}\))?/g,
    (match, id, rating) => {
      const key = id.toUpperCase();
      if (!seen.has(key)) { seen.add(key); return match; }
      const band = rating ? rating.trim().slice(1, -1) : "";
      return band
        ? `another problem of the same tag rated around ${band}`
        : "another problem of the same tag";
    });
}

app.post("/api/coach", async (req, res) => {
  const { handle, estimatedRating, weakTags, strongTags, recommendedProblems,
          totalSolved, tagImpact, runId } = req.body;

  // A plan belongs to one analysis. If this run already has one, return it
  // instead of writing another: a second plan would cost another model call
  // and would replace the one the user already has, which is not a thing a
  // "generate" button should do silently.
  //
  // This runs BEFORE the API-key and entitlement guards on purpose. Handing
  // back a stored plan calls no model and costs nothing, so it must not fail
  // because the key is missing or a free trial is used up -- the user has
  // already paid for this plan and it is simply being read back.
  const runKey = Number(runId);
  if (ACCOUNTS_ENABLED && req.user && Number.isInteger(runKey) && runKey > 0) {
    try {
      const { rows } = await query(
        `SELECT coach_plan, coach_model, coach_written_at
           FROM searches WHERE id = $1 AND account_id = $2`,
        [runKey, req.user.id]);
      if (rows.length && rows[0].coach_plan) {
        return res.json({
          plan: rows[0].coach_plan,
          model: rows[0].coach_model,
          saved: true,
          written_at: rows[0].coach_written_at,
        });
      }
    } catch (err) {
      // A read failure must not block a genuine request; the worst case is
      // regenerating a plan, which is what used to happen every time.
      console.error("coach plan lookup failed:", err.message);
    }
  }

  // Ahead of the key check: an unverified user's problem is verification, and
  // saying "not configured" would send them to fix the wrong thing.
  if (ACCOUNTS_ENABLED && req.user && req.user.email_verified === false) {
    return res.status(403).json({
      error: "Confirm your email address first.", code: "EMAIL_UNVERIFIED",
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: "The AI Coach is not configured yet.", code: "NO_KEY",
    });
  }
  // Entitlement: Plus gets the coach; Free gets a limited trial. Enforced here
  // rather than only in the UI, because the endpoint is reachable directly.
  if (ACCOUNTS_ENABLED) {
    if (!req.user) {
      return res.status(401).json({ error: "Sign in to use the AI Coach" });
    }
    if (req.user.plan !== "pro") {
      try {
        const { rows } = await query(
          `SELECT count(*)::int AS n FROM coach_uses WHERE account_id = $1`,
          [req.user.id]);
        if (rows[0].n >= FREE_COACH_PLANS) {
          return res.status(402).json({
            error: `Your free trial of the AI Coach is used up (${FREE_COACH_PLANS} plans). `
                 + "Plus includes it in full.",
            code: "TRIAL_USED",
          });
        }
      } catch { /* never block on the counter failing */ }
    }
  }

    try {
        const coachModel = await getCoachModel();
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        // Weak tags: peer-benchmarked strength + solve counts
        const weakSection = (weakTags || [])
          .map(t => `  - ${t.tag}: peer-benchmarked strength ${t.strength}/100, ${t.solved} solved / ${t.attempted} attempted`)
          .join("\n");

        // Strong tags: skip these in the plan
        const strongSection = (strongTags || [])
          .map(t => `  - ${t.tag}: strength ${t.strength}/100`)
          .join("\n");

        // ML-ranked recommended problems with all three model signals:
        // difficulty_match = how well the problem fits the user (success model)
        // weakness_boost   = how much it targets the user's weakest tags vs. peers
        // estimated_attempts + difficulty_label = predicted solve difficulty (attempts model)
        const recsSection = (recommendedProblems || [])
          .map(p => {
            const match   = Math.round((p.difficulty_match ?? 0) * 100);
            const boost   = Math.round((p.weakness_boost  ?? 0) * 100);
            const tries   = p.estimated_attempts != null ? `~${p.estimated_attempts.toFixed(1)} tries (${p.difficulty_label})` : "";
            return `  - ${p.id} | rating ${p.rating} | tags: [${p.tags.join(", ")}] | ${match}% difficulty match | ${boost}% weakness boost | ${tries}`;
          })
          .join("\n");

        // Counterfactual tag impact: which tags give the most rating gain if improved
        // These come from the success model simulating a +20% strength boost on each tag
        const impactSection = (tagImpact || [])
          .map(t => `  - ${t.label}: current strength ${Math.round((t.current_strength ?? t.strength ?? 0) * 100)}%, improving it unlocks +${t.delta_problems} problems → est. +${t.est_rating_gain ?? t.estimated_rating_gain ?? 0} rating pts`)
          .join("\n");

        // Only the tags this plan can draw on, so the prompt stays small and
        // the model cannot cite a resource for a topic it was told to skip.
        const planTags = [
          ...(tagImpact || []).map(t => t.tag || t.label),
          ...(weakTags || []).map(t => t.tag),
        ].filter(Boolean);
        const uniqueTags = [...new Set(planTags)].slice(0, 10);
        const resourceSection = resourceLinesFor(uniqueTags, estimatedRating)
          || "  (none available — tell the student to go straight to the problems)";

        const comfortFloor = Math.max(800,  estimatedRating - 300);
        const comfortCeil  = Math.min(3500, estimatedRating + 100);
        const stretchCeil  = Math.min(3500, estimatedRating + 300);

        const prompt = `You are a Codeforces coach writing a personalized 7-day training plan grounded in ML model outputs. Output HTML only — no markdown, no extra text, nothing outside the divs.

USER PROFILE
Handle: ${handle} | Max rating: ${estimatedRating} | Total problems solved: ${totalSolved}

WEAK TAGS (peer-benchmarked — these are where the user falls behind similar-rated players):
${weakSection}

STRONG TAGS (skip these — user already outperforms peers here):
${strongSection}

ML-RANKED RECOMMENDED PROBLEMS (ranked by our LightGBM success model):
Each problem was selected because neighbors solved it and the model predicts it's in the user's "sweet spot".
- difficulty_match: how cleanly the model predicts the user will solve it (higher = easier)
- weakness_boost: how much the problem targets the user's weak tags vs. their peer group (higher = more impactful for growth)
- tries: estimated attempts before AC from the attempts model
${recsSection}

COUNTERFACTUAL TAG IMPACT (from the success model — which tags unlock the most problems if improved):
${impactSection}

LEARNING RESOURCES (curated — use ONLY these, never invent a link):
${resourceSection}

PLAN RULES — follow every one strictly:
1. Prioritize tags from the counterfactual impact list first — these are the tags the model says will unlock the most rating gain.
2. ONE tag per day. Do not mix topics in one day. Never assign a tag the user is already strong at.
3. For each day's tag, assign recommended problems from the list above that match that tag and have high weakness_boost. Include each problem's ID and rating exactly as given — never invent an ID.
3a. NEVER assign the same problem ID twice anywhere in the plan. Each problem appears on exactly one day. If you run out of listed problems for a tag, append the shortfall to the SAME "Then:" line as plain text — e.g. "Then: 580_C (1500), plus 1 more graphs problem rated 1450–1550 from the Codeforces problemset". Do NOT write the word "Then:" twice in one day. A repeated problem is worse than no problem, because the student has already solved it.
3b. The plan is ALWAYS exactly seven days, Day 1 through Day 7. Never stop early. If the recommended list runs out, keep going with "pick N <tag> problems rated XXXX-YYYY from the Codeforces problemset" — the student can always find more problems, but a four-day plan tells them the week is over when it is not.
3c. Prefer giving a high-priority tag two or three days over introducing a tag the model did not flag. Repeating a TAG across days is good; repeating a PROBLEM is not.
4. Every day must open with ONE warm-up problem clearly easier than the rest of that day (roughly 100–200 below the day's band), then step up. Someone who stalls on the first problem usually abandons the plan.
5. Day 1–2: main problems rated ${comfortFloor}–${comfortCeil}.
   Day 3–5: ${comfortCeil}–${stretchCeil}.
   Day 6–7: ${stretchCeil}–${Math.min(3500, estimatedRating + 400)}.
6. 3–5 problems per day including the warm-up.
7. TIME must be realistic and specific, not a flat figure. Estimate from the problems you assigned: a problem near the user's rating takes roughly 25–40 minutes including reading and debugging; a stretch problem 45–70. Add 15–20 minutes when the day has a resource to read or watch. Give a range like "1h 45m – 2h 15m". Days 6–7 should show HIGHER time for fewer problems — that is the honest picture, and a plan that pretends otherwise gets abandoned.
8. Each day names exactly ONE resource from the curated list above, matching that day's tag. Use its exact title and URL. If the list has nothing for that tag, write "No resource needed — go straight to the problems." Never invent or guess a link.
9. FOCUS = one concrete micro-skill (e.g. "spot when a problem reduces to prefix sums", not "study arrays").
10. CHECK = a verifiable thing the student can test on themselves by the end of the day, phrased so the answer is yes or no. Good: "You can write a 1D DP from an empty file in under 10 minutes without looking anything up." Bad: "Understand DP better."
11. Write to the student as "you". Be direct and encouraging without inflating what a week achieves.

Output SEVEN day divs, Day 1 to Day 7. A plan with fewer than seven days is wrong.

Format each day exactly like this — nothing else, no markdown, no text outside the divs:
<div class="day"><span class="day-label">Day N</span> – <strong>Topic</strong><ul><li><b>Warm-up:</b> problem ID (rating)</li><li><b>Then:</b> problem IDs with ratings</li><li><b>Time:</b> realistic range</li><li><b>Focus:</b> one concrete micro-skill</li><li><b>Resource:</b> <a href="URL" target="_blank" rel="noopener noreferrer">Exact Title</a> — why this one, in a few words</li><li><b>Check:</b> a yes/no test the student can run on themselves</li><li><b>Why:</b> one sentence on why the model flagged this tag for this user</li></ul></div>`;

        const message = await anthropic.messages.create({
            model: coachModel,
            // max_tokens covers thinking AND the answer. At 4000 with adaptive
            // thinking the model spent 3999 tokens reasoning and emitted an
            // empty plan -- the richer prompt gives it more to weigh, so the
            // ceiling has to leave room for the output itself.
            max_tokens: 10000,
            // The plan is a judgement task over ML signals, so let the model
            // think; "low" keeps reasoning proportionate to a 7-day schedule
            // and the cost near a cent per plan.
            thinking: { type: "adaptive" },
            // "low" is the floor the API accepts (low/medium/high/xhigh/max).
            // Thinking is about 70% of the cost here, so this is as cheap as
            // the plan gets without dropping adaptive thinking entirely --
            // which is what keeps the day-to-day progression coherent.
            output_config: { effort: "low" },
            messages: [{ role: "user", content: prompt }],
        });

        if (message.stop_reason === "refusal") {
            console.error("coach refused:", message.stop_details?.category);
            return res.status(502).json({ error: "Could not generate a plan. Try again." });
        }

        let plan = message.content
            .filter(b => b.type === "text").map(b => b.text).join("").trim();

        // The prompt forbids repeating a problem and usually obeys, but about
        // one plan in three slips a duplicate onto a later day. An instruction
        // cannot guarantee this; a pass over the output can. Later mentions
        // are replaced with a generic prompt so the day still has work in it.
        plan = dedupeProblemIds(plan);

        if (!plan) {
            // Distinguish "ran out of room" from "said nothing": they need
            // different fixes and the log should not conflate them.
            const truncated = message.stop_reason === "max_tokens";
            console.error("coach produced no plan. stop_reason:", message.stop_reason,
                          "blocks:", JSON.stringify(message.content?.map(b => b.type)),
                          "output_tokens:", message.usage?.output_tokens,
                          "thinking_tokens:", message.usage?.output_tokens_details?.thinking_tokens);
            return res.status(502).json({
                error: truncated
                    ? "That plan was cut short. Try again."
                    : "The coach returned an empty plan.",
            });
        }

        // Count the use only once a plan actually came back, so a failure does
        // not burn someone's trial.
        if (ACCOUNTS_ENABLED && req.user && req.user.plan !== "pro") {
            query(`INSERT INTO coach_uses (account_id, model) VALUES ($1, $2)`,
                  [req.user.id, coachModel])
              .catch(e => console.error("coach_uses insert failed:", e.message));
        }

        // Save the plan against the run it was written from, and await it:
        // responding first would lose the plan for anyone who reloads straight
        // away, and the user has already been charged for it.
        //
        // `coach_plan IS NULL` makes this a no-op if two requests raced, so
        // the first plan written is the one that is kept rather than the last.
        let saved = false;
        if (ACCOUNTS_ENABLED && req.user && Number.isInteger(runKey) && runKey > 0) {
            try {
                const r = await query(
                    `UPDATE searches
                        SET coach_plan = $3, coach_model = $4,
                            coach_written_at = now()
                      WHERE id = $1 AND account_id = $2 AND coach_plan IS NULL`,
                    [runKey, req.user.id, plan, coachModel]);
                saved = r.rowCount > 0;
            } catch (err) {
                // The user still gets the plan they paid for; it just will not
                // survive a reload. Better than failing the whole request.
                console.error("coach plan save failed:", err.message);
            }
        }

        res.json({
            plan,
            model: coachModel,
            saved,
            usage: {
                input_tokens: message.usage?.input_tokens,
                output_tokens: message.usage?.output_tokens,
            },
        });

    } catch (err) {
        console.error("coach failed:", err.message);
        const status = err?.status === 401 ? 503 : 502;
        res.status(status).json({
            error: err?.status === 401
                ? "The AI Coach key is not valid."
                : "Could not generate a plan. Try again.",
        });
    }
});

/* ───────────── ML Pipeline ───────────── */

// Record one analysis for history and admin review. Never fails the request.
async function logSearch(req, handle, info) {
  if (!ACCOUNTS_ENABLED || !req.user) return null;
  try {
    return await query(
      `INSERT INTO searches
         (account_id, cf_handle, ok, duration_ms, cf_rating, weakest_tag,
          error, scores, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [req.user.id, handle, info.ok, info.duration_ms ?? null,
       info.cf_rating ?? null, info.weakest_tag ?? null,
       info.error ? String(info.error).slice(0, 400) : null,
       info.scores ? JSON.stringify(info.scores) : null,
       info.result ? JSON.stringify(info.result) : null]
    ).then(r => r.rows?.[0]?.id ?? null);
  } catch (err) {
    console.error("search log failed:", err.message);
    return null;
  }
}

/* ── Discount redemption ─────────────────────────────────────────────────── */

// Look up a code without claiming it, so the UI can show what it is worth
// before the user commits.
app.get("/api/discounts/:code", async (req, res) => {
  if (!ACCOUNTS_ENABLED) return res.status(404).json({ error: "Not available" });
  const code = String(req.params.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Enter a code" });
  try {
    const { rows } = await query(
      `SELECT percent_off, max_uses, used_count, expires_at, active, applies_to
         FROM discount_codes WHERE code_upper = $1`, [code]);
    if (!rows.length) {
      return res.status(404).json({ error: "That code does not exist.", code: "NOT_FOUND" });
    }
    const d = rows[0];
    const expired = new Date(d.expires_at).getTime() <= Date.now();
    const exhausted = d.used_count >= d.max_uses;
    if (!d.active) return res.status(410).json({ error: "That code is no longer active.", code: "INACTIVE" });
    if (expired)   return res.status(410).json({ error: "That code has expired.", code: "EXPIRED" });
    if (exhausted) return res.status(410).json({ error: "That code has been fully claimed.", code: "EXHAUSTED" });

    res.json({
      valid: true,
      percent_off: d.percent_off,
      remaining: d.max_uses - d.used_count,
      max_uses: d.max_uses,
      expires_at: d.expires_at,
      applies_to: d.applies_to,
    });
  } catch (err) {
    console.error("discount lookup failed:", err.message);
    res.status(500).json({ error: "Could not check that code." });
  }
});

// Claiming a code ahead of time is gone: promos are entered during checkout
// and consumed only when a purchase completes, so an abandoned checkout no
// longer burns one of a limited run. The lookup above stays for the "is this
// code real?" case; redemption lives in routes/payments.js.

// Re-open a past analysis from storage. No model run, no database egress:
// this is the same payload the user already saw.
app.get("/api/me/searches/:id", async (req, res) => {
  if (!ACCOUNTS_ENABLED || !req.user) {
    return res.status(401).json({ error: "Sign in to view past analyses" });
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Not a valid analysis id" });
  }
  try {
    // Scoped to the signed-in account: one user must never read another's run.
    const { rows } = await query(
      `SELECT id, cf_handle, searched_at, cf_rating, result,
              coach_plan, coach_model, coach_written_at
         FROM searches
        WHERE id = $1 AND account_id = $2`, [id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: "Analysis not found" });
    const row = rows[0];
    if (!row.result) {
      return res.status(410).json({
        error: "This analysis was run before results were saved. "
             + "Run it again to see the full report.",
        code: "NO_STORED_RESULT",
      });
    }
    res.json({
      ...row.result,
      run_id: row.id,
      cached: true,
      searched_at: row.searched_at,
      // The plan written for this exact run, so reopening an analysis shows
      // the coaching the user already has rather than an empty panel.
      coach_plan: row.coach_plan ?? null,
      coach_model: row.coach_model ?? null,
      coach_written_at: row.coach_written_at ?? null,
    });
  } catch (err) {
    console.error("stored analysis failed:", err.message);
    res.status(500).json({ error: "Could not load that analysis." });
  }
});

app.get("/api/ml/analyze/:handle", requireAccurateClock, async (req, res) => {
  let { handle } = req.params;
  const startedAt = Date.now();

  // An unverified address cannot run the model. Verification is what ties an
  // account to a person; without it one address could become any number of
  // accounts, each with its own free allowance.
  if (ACCOUNTS_ENABLED && req.user && req.user.email_verified === false) {
    return res.status(403).json({
      error: "Confirm your email address before running an analysis. "
           + "We sent you a 6-digit code.",
      code: "EMAIL_UNVERIFIED",
    });
  }

  // Analysing the linked handle is unlimited. Analysing someone else's is
  // metered — once every 3 months on free, once a week on Plus — because each
  // run costs real compute and an unmetered version is a free public API.
  // Admins are exempt. Enforced here, not only in the UI, because the endpoint
  // is reachable directly.
  let spendOtherHandleRun = false;
  if (ACCOUNTS_ENABLED && req.user && req.user.role !== "admin") {
    if (handle.toLowerCase() !== String(req.user.cf_handle).toLowerCase()) {
      const w = otherHandleWindow(req.user);
      if (!w.allowed) {
        const upsell = w.plan === "pro" ? "" :
          " Plus raises this to once a week.";
        return res.status(429).json({
          error: `Analysing a handle other than your own is limited to once `
               + `every ${w.plan === "pro" ? "week" : "3 months"}. `
               + `You can run another ${waitMessage(w.days_remaining)}.${upsell}`,
          code: "OTHER_HANDLE_LOCKED",
          next_at: w.next_at,
          days_remaining: w.days_remaining,
          plan: w.plan,
        });
      }
      spendOtherHandleRun = true;
    } else {
      // Use the stored spelling so history rows stay consistent.
      handle = req.user.cf_handle;
    }
  }

  // Claim the allowance BEFORE running the model. Doing it afterwards would
  // let two concurrent requests both pass the check above and both run. The
  // condition repeats the window inside the UPDATE, so exactly one of them
  // wins; the loser is refused without spending any compute.
  if (spendOtherHandleRun) {
    const days = OTHER_HANDLE_DAYS[otherHandleWindow(req.user).plan];
    const claim = await query(
      `UPDATE accounts SET other_handle_run_at = now()
        WHERE id = $1
          AND (other_handle_run_at IS NULL
               OR other_handle_run_at < now() - ($2 || ' days')::interval)
        RETURNING id`, [req.user.id, String(days)]);
    if (!claim.rowCount) {
      return res.status(429).json({
        error: "Another analysis just used this allowance.",
        code: "OTHER_HANDLE_LOCKED",
      });
    }
  }

  const script = `
import sys, os, json, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.join(${JSON.stringify(PROJECT_ROOT)}, 'src'))
sys.path.insert(0, ${JSON.stringify(PROJECT_ROOT)})
from main import main
result = main(${JSON.stringify(handle)}, verbose=False)
import numpy as np
def convert(o):
    if isinstance(o, (np.integer,)): return int(o)
    if isinstance(o, (np.floating,)): return float(o)
    if isinstance(o, np.ndarray): return o.tolist()
    raise TypeError(repr(o) + " is not JSON serializable")
result.pop('profiling', None)
print(json.dumps(result, default=convert))
`;

  try {
    const output = await new Promise((resolve, reject) => {
      const proc = spawn(PYTHON, ["-c", script], {
        cwd: PROJECT_ROOT,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
      let stdout = "", stderr = "";
      proc.stdout.on("data", d => { stdout += d.toString(); });
      proc.stderr.on("data", d => { stderr += d.toString(); });
      proc.on("close", code => {
        if (code !== 0) {
          const detail = [stderr, stdout].filter(Boolean).join("\n--- stdout ---\n") || "(no output)";
          return reject(new Error(detail));
        }
        resolve(stdout.trim());
      });

      // Kill the process if it takes more than 60 seconds
      setTimeout(() => {
        proc.kill();
        reject(new Error("ML pipeline timed out after 120s"));
      }, 120_000);
    });

    let result;
    try {
      result = JSON.parse(output);
    } catch (parseErr) {
      console.error("ML pipeline JSON parse error. stdout:", output);
      return res.status(500).json({ error: `JSON parse failed: ${parseErr.message}`, output });
    }
    // Flatten tag_strengths to {tag: number} once: used for the weakest-tag
    // column and stored so a later run can be compared against this one.
    let weakest = null, rating = null, scores = null;
    try {
      const ts = result?.tag_strengths || {};
      const entries = Object.entries(ts)
        .map(([k, v]) => [k, typeof v === "object"
          ? (v?.strength ?? v?.user_strength ?? v?.score)
          : v])
        .filter(([, v]) => typeof v === "number" && Number.isFinite(v));
      if (entries.length) {
        scores = Object.fromEntries(
          entries.map(([k, v]) => [k, Math.round(v * 10) / 10]));
        const sorted = [...entries].sort((a, b) => a[1] - b[1]);
        weakest = sorted[0][0];
      }
      rating = result?.recommendation?.recommendation?.cf_rating
            ?? result?.cf_rating ?? null;
    } catch { /* logging must never break the response */ }

    // Keep the full result so the user can reopen this run without paying
    // for the model again. Diagnostics are dropped: they are not rendered and
    // would roughly double the row.
    const { profiling, problem_attempts, ...storable } = result || {};
    const runId = await logSearch(req, handle, {
      ok: true, duration_ms: Date.now() - startedAt,
      cf_rating: rating, weakest_tag: weakest, scores, result: storable,
    });
    // The client uses this to exclude the run it is displaying from the
    // "compare with an earlier run" list.
    res.json({ ...result, run_id: runId });
  } catch (err) {
    console.error("ML pipeline error:", err.message);
    await logSearch(req, handle, {
      ok: false, duration_ms: Date.now() - startedAt, error: err.message,
    });
    res.status(500).json({ error: err.message });
  }
});

// A signed-in user's own analysis history.
app.get("/api/me/searches", requireAuth, async (req, res) => {
  try {
    // Only successful runs that captured scores are useful for comparison,
    // but the caller may want the full list, so return both flags.
    const { rows } = await query(
      `SELECT id, cf_handle, searched_at, ok, duration_ms, cf_rating,
              weakest_tag, scores
         FROM searches
        WHERE account_id = $1
        ORDER BY searched_at DESC LIMIT 30`, [req.user.id]);
    res.json({
      searches: rows.map(r => ({ ...r, comparable: Boolean(r.scores && r.ok) })),
    });
  } catch (err) {
    console.error("history failed:", err.message);
    res.status(500).json({ error: "Could not load your history" });
  }
});

// Catch-all: serve React app for any non-API route
if (existsSync(STATIC_DIR)) {
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(STATIC_DIR, "index.html"));
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));