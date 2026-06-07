import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

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