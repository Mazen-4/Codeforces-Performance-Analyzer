import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
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

/* ───────────── Claude Coaching Plan ───────────── */

app.post("/api/coach", async (req, res) => {
  const { handle, estimatedRating, weakTags, strongTags, recommendedProblems, totalSolved, tagImpact } = req.body;

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash"
        });

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

PLAN RULES — follow every one strictly:
1. Prioritize tags from the counterfactual impact list first — these are the tags the model says will unlock the most rating gain.
2. For each day's tag, prefer assigning recommended problems from the list above that match that tag and have high weakness_boost.
3. For each recommended problem you assign, include its ID and rating — don't invent problem IDs.
4. Day 1–2: problems rated ${comfortFloor}–${comfortCeil} only. Build confidence with problems the model says are easy/moderate.
5. Day 3–5: problems rated ${comfortCeil}–${stretchCeil}. Use moderate-difficulty problems from the recommendations.
6. Day 6–7: problems rated ${stretchCeil}–${Math.min(3500, estimatedRating + 400)}. Harder problems; it's fine if there are no exact matches.
7. ONE tag per day. Do not mix topics in one day.
8. 3–5 problems per day. This is a focused 1–2 hour session.
9. Focus line = ONE concrete micro-skill for that tag (e.g. "identify when a problem reduces to prefix sums", not just "study arrays").
10. Never assign a tag the user is already strong at.

Format each day exactly like this — nothing else:
<div class="day"><span class="day-label">Day N</span> – <strong>Topic</strong><ul><li>Difficulty: XXXX–YYYY</li><li>Problems: X problems (include IDs from the recommended list where available, e.g. 1234_A, 1234_B)</li><li>Time: Xhr</li><li>Focus: one concrete micro-skill to drill</li><li>Why: one sentence explaining why the model flagged this tag for this user</li></ul></div>`;

        const result = await model.generateContent(prompt);

        const plan = result.response.text(); // ✅ THIS IS YOUR FINAL STRING

        res.json({ plan });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Gemini failed" });
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
      `SELECT percent_off, max_uses, used_count, expires_at, active
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
    });
  } catch (err) {
    console.error("discount lookup failed:", err.message);
    res.status(500).json({ error: "Could not check that code." });
  }
});

app.post("/api/discounts/:code/redeem", async (req, res) => {
  if (!ACCOUNTS_ENABLED || !req.user) {
    return res.status(401).json({ error: "Sign in to claim a discount" });
  }
  const code = String(req.params.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Enter a code" });

  try {
    // Claim the use atomically. The WHERE clause carries every condition, so
    // two people racing for the last use cannot both win: exactly one UPDATE
    // matches a row.
    const { rows } = await query(
      `UPDATE discount_codes
          SET used_count = used_count + 1
        WHERE code_upper = $1
          AND active
          AND expires_at > now()
          AND used_count < max_uses
        RETURNING id, percent_off, max_uses, used_count, expires_at`,
      [code]);

    if (!rows.length) {
      // Distinguish "never existed" from "no longer claimable".
      const { rows: probe } = await query(
        `SELECT active, expires_at, used_count, max_uses
           FROM discount_codes WHERE code_upper = $1`, [code]);
      if (!probe.length) {
        return res.status(404).json({ error: "That code does not exist.", code: "NOT_FOUND" });
      }
      const d = probe[0];
      if (!d.active) return res.status(410).json({ error: "That code is no longer active.", code: "INACTIVE" });
      if (new Date(d.expires_at).getTime() <= Date.now()) {
        return res.status(410).json({ error: "That code has expired.", code: "EXPIRED" });
      }
      return res.status(410).json({ error: "That code has been fully claimed.", code: "EXHAUSTED" });
    }

    const d = rows[0];
    try {
      await query(
        `INSERT INTO discount_redemptions (code_id, account_id, percent_off)
         VALUES ($1, $2, $3)`, [d.id, req.user.id, d.percent_off]);
    } catch (dupErr) {
      if (dupErr.code === "23505") {
        // Already claimed by this account: give the use back and say so.
        await query(
          `UPDATE discount_codes SET used_count = used_count - 1 WHERE id = $1`,
          [d.id]);
        return res.status(409).json({
          error: "You have already claimed this code.", code: "ALREADY_CLAIMED",
        });
      }
      throw dupErr;
    }

    res.json({
      ok: true,
      percent_off: d.percent_off,
      remaining: d.max_uses - d.used_count,
      max_uses: d.max_uses,
      expires_at: d.expires_at,
    });
  } catch (err) {
    console.error("discount redeem failed:", err.message);
    res.status(500).json({ error: "Could not claim that code." });
  }
});

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
      `SELECT id, cf_handle, searched_at, cf_rating, result
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
    });
  } catch (err) {
    console.error("stored analysis failed:", err.message);
    res.status(500).json({ error: "Could not load that analysis." });
  }
});

app.get("/api/ml/analyze/:handle", requireAccurateClock, async (req, res) => {
  let { handle } = req.params;
  const startedAt = Date.now();

  // A signed-in user may only analyse the handle linked to their account.
  // Admins may analyse anyone. Enforced here rather than only in the UI,
  // because the endpoint is reachable directly.
  if (ACCOUNTS_ENABLED && req.user && req.user.role !== "admin") {
    if (handle.toLowerCase() !== String(req.user.cf_handle).toLowerCase()) {
      return res.status(403).json({
        error: "You can only analyse the Codeforces handle linked to your "
             + "account. Change it on your profile page.",
      });
    }
    // Use the stored spelling so history rows stay consistent.
    handle = req.user.cf_handle;
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