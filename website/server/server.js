import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

/* ───────────── Codeforces Fetch ───────────── */

app.get("/api/cf/:handle", async (req, res) => {
  const { handle } = req.params;

  try {
    const statusRes = await fetch(
      `https://codeforces.com/api/user.status?handle=${handle}&from=1&count=500`
    );
    const problemsRes = await fetch(
      `https://codeforces.com/api/problemset.problems`
    );

    const statusData = await statusRes.json();
    const problemsData = await problemsRes.json();

    if (statusData.status !== "OK")
      return res.json({ status: "FAILED", submissions: [], problems: [] });

    res.json({
      status: "OK",
      submissions: statusData.result,
      problems: problemsData.result.problems,
    });
  } catch (err) {
    res.status(500).json({ error: "Codeforces fetch failed" });
  }
});

/* ───────────── Claude Coaching Plan ───────────── */

app.post("/api/coach", async (req, res) => {
  const { handle, estimatedRating, weakTags, strongTags, recommendedProblems, totalSolved } = req.body;

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash"
        });

        const weakSection = (weakTags || [])
          .map(t => `  - ${t.tag}: strength ${t.strength}/100, ${t.solved} solved / ${t.attempted} attempted`)
          .join("\n");

        const strongSection = (strongTags || [])
          .map(t => `  - ${t.tag}: strength ${t.strength}/100`)
          .join("\n");

        const recsSection = (recommendedProblems || [])
          .map(p => `  - ${p.id} (rating ${p.rating}, ${p.success_prob}% success chance) [${p.tags.join(", ")}]`)
          .join("\n");

        const comfortFloor = Math.max(800,  estimatedRating - 300);
        const comfortCeil  = Math.min(3500, estimatedRating + 100);
        const stretchCeil  = Math.min(3500, estimatedRating + 300);

        const prompt = `You are a Codeforces coach writing a beginner-friendly 7-day plan. Output HTML only — no markdown, no extra text, nothing outside the divs.

          User: ${handle} | Max rating: ${estimatedRating} | Total solved: ${totalSolved}

          Weak tags to fix (weakest first):
          ${weakSection}

          Strong tags (skip these — user is already comfortable):
          ${strongSection}

          Problems our model says this user can realistically solve:
          ${recsSection}

          Rules — follow every one strictly:
          1. ONE tag per day. Do not mix topics.
          2. Day 1–2: problems rated ${comfortFloor}–${comfortCeil} only. Build confidence first.
          3. Day 3–5: problems rated ${comfortCeil}–${stretchCeil}. Slight stretch.
          4. Day 6–7: problems rated ${stretchCeil}–${Math.min(3500, estimatedRating + 400)}. Push the limit.
          5. 3–5 problems per day maximum. This is a focused 1–2 hour session, not a marathon.
          6. Focus line = ONE concrete micro-skill to practice that day (e.g. "identify when a problem reduces to prefix sums", not just "study arrays").
          7. Never suggest a tag the user is already strong at.

          Format each day exactly like this — nothing else:
          <div class="day"><span class="day-label">Day N</span> – <strong>Topic</strong><ul><li>Difficulty: XXXX–YYYY</li><li>Problems: X problems</li><li>Time: Xhr</li><li>Focus: one concrete micro-skill to drill</li></ul></div>`;

        const result = await model.generateContent(prompt);

        const plan = result.response.text(); // ✅ THIS IS YOUR FINAL STRING

        console.log("Plan:", plan);

        res.json({ plan }); // ✅ send to frontend

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Gemini failed" });
    }
});

/* ───────────── ML Pipeline ───────────── */

app.get("/api/ml/analyze/:handle", async (req, res) => {
  const { handle } = req.params;
  const projectRoot = path.resolve(__dirname, "../../");
  const venvPython = path.join(projectRoot, ".venv", "bin", "python");

  const script = `
import sys, os, json
sys.path.insert(0, os.path.join('${projectRoot}', 'src'))
sys.path.insert(0, '${projectRoot}')
from main import main
result = main('${handle}', verbose=False)
# strip non-serializable numpy types
import numpy as np
def convert(o):
    if isinstance(o, (np.integer,)): return int(o)
    if isinstance(o, (np.floating,)): return float(o)
    if isinstance(o, np.ndarray): return o.tolist()
    raise TypeError(repr(o) + " is not JSON serializable")
# drop profiling to keep payload small
result.pop('profiling', None)
print(json.dumps(result, default=convert))
`;

  try {
    const output = await new Promise((resolve, reject) => {
      const proc = spawn(venvPython, ["-c", script], {
        cwd: projectRoot,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
      let stdout = "", stderr = "";
      proc.stdout.on("data", d => { stdout += d.toString(); });
      proc.stderr.on("data", d => { stderr += d.toString(); });
      proc.on("close", code => {
        if (code !== 0) return reject(new Error(stderr.slice(-1000)));
        resolve(stdout.trim());
      });
    });

    const result = JSON.parse(output);
    res.json(result);
  } catch (err) {
    console.error("ML pipeline error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));