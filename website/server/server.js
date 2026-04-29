import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

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
  const { handle, estimatedRating, weakTags } = req.body;

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash"
        });
        const prompt = `You are a Codeforces coach. Output HTML only, no markdown, no extra text.
            Handle: ${handle} | Rating: ${estimatedRating} | Weak: ${weakTags.join(", ")}

            Format each day exactly like this:
            <div class="day"><span class="day-label">Day N</span> – <strong>Topic</strong><ul><li>Difficulty: XXXX–YYYY</li><li>Problems: X problems</li><li>Time: Xhr</li></ul></div>

            7 days total. Tailor topics to weak tags and rating. Nothing outside the divs.`;

        const result = await model.generateContent(prompt);

        const plan = result.response.text(); // ✅ THIS IS YOUR FINAL STRING

        console.log("Plan:", plan);

        res.json({ plan }); // ✅ send to frontend

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Gemini failed" });
    }
});

app.listen(3000, () => console.log("Server running on port 3000"));