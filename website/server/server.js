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

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Project root: use env var on Render, otherwise resolve from server.js location
const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "../../");

// Pick Python interpreter: prefer .venv (local dev), fall back to system python3 (Render)
const VENV_PYTHON = path.join(PROJECT_ROOT, ".venv", "bin", "python");
const PYTHON = existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3";

const app = express();
app.use(cors());
app.use(express.json());

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

app.get("/api/ml/analyze/:handle", async (req, res) => {
  const { handle } = req.params;

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
    res.json(result);
  } catch (err) {
    console.error("ML pipeline error:", err.message);
    res.status(500).json({ error: err.message });
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