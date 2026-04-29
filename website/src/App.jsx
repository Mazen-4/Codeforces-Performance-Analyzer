import { useState, useCallback } from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from "recharts";
import reactSvg from "./assets/react.svg";

const C = {
  bg: "#07070f", surface: "#0f0f1a", card: "#13131f", border: "#1e1e30",
  accent: "#7c6dfa", accentSoft: "#7c6dfa18", danger: "#ff4560",
  success: "#00e396", warn: "#feb019", text: "#dde1f0", muted: "#5a5a7a",
};

const TAG_COLORS = ["#7c6dfa","#ff4560","#00e396","#feb019","#00b4d8","#f72585","#4cc9f0","#a78bfa","#fb5607","#06d6a0"];
const accColor = a => a >= 70 ? C.success : a >= 45 ? C.warn : C.danger;

// ── All external fetching is done through the Gemini API (server-side) ────────
// This completely avoids CORP/CORS issues in the artifact sandbox.

async function fetchCFData(handle) {
  const res = await fetch(`http://localhost:3000/api/cf/${handle}`);
  return res.json();
}

async function fetchCoachPlan(handle, estimatedRating, weakTags) {
  const res = await fetch("http://localhost:3000/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle,
      estimatedRating,
      weakTags: weakTags.map(t => t.tag),
    }),
  });

  const data = await res.json();
  return data.plan;
}

// ── Analysis engine ───────────────────────────────────────────────────────────

function analyzeData({ submissions, problems }) {
  const problemMap = {};
  problems.forEach(p => { problemMap[`${p.contestId}-${p.index}`] = p; });

  const tagStats = {}, ratingStats = {}, solvedSet = new Set();
  let maxRating = 0;

  submissions.forEach(s => {
    const key = `${s.problem.contestId}-${s.problem.index}`;
    const p = problemMap[key] || s.problem;
    const tags = p.tags || [];
    const rating = p.rating;

    if (s.verdict === "OK") {
      if (!solvedSet.has(key)) { solvedSet.add(key); if (rating > maxRating) maxRating = rating; }
      tags.forEach(t => {
        if (!tagStats[t]) tagStats[t] = { solved: new Set(), failed: new Set() };
        tagStats[t].solved.add(key);
      });
      if (rating) {
        const b = Math.round(rating / 100) * 100;
        if (!ratingStats[b]) ratingStats[b] = { solved: 0, failed: 0 };
        ratingStats[b].solved++;
      }
    } else {
      tags.forEach(t => {
        if (!tagStats[t]) tagStats[t] = { solved: new Set(), failed: new Set() };
        if (!solvedSet.has(key)) tagStats[t].failed.add(key);
      });
      if (rating) {
        const b = Math.round(rating / 100) * 100;
        if (!ratingStats[b]) ratingStats[b] = { solved: 0, failed: 0 };
        if (!solvedSet.has(key)) ratingStats[b].failed++;
      }
    }
  });

  const tagData = Object.entries(tagStats)
    .map(([tag, { solved, failed }]) => {
      const s = solved.size, f = failed.size, tot = s + f;
      return { tag, solved: s, failed: f, accuracy: tot ? Math.round(s / tot * 100) : 0 };
    })
    .filter(t => t.solved + t.failed >= 2)
    .sort((a, b) => a.accuracy - b.accuracy);

  const ratingData = Object.entries(ratingStats)
    .map(([r, { solved, failed }]) => ({
      rating: +r, solved, failed,
      accuracy: solved + failed ? Math.round(solved / (solved + failed) * 100) : 0,
    }))
    .sort((a, b) => a.rating - b.rating);

  const estimatedRating = maxRating || 1200;
  const weakTags = tagData.filter(t => t.accuracy < 50).map(t => t.tag);

  const recommendations = problems.filter(p => {
    const key = `${p.contestId}-${p.index}`;
    if (solvedSet.has(key) || !p.rating) return false;
    if (p.rating < estimatedRating - 300 || p.rating > estimatedRating + 100) return false;
    return p.tags.some(t => weakTags.includes(t));
  }).slice(0, 12);

  return {
    stats: { totalSolved: solvedSet.size, totalSubmissions: submissions.length, weakTagCount: weakTags.length, estimatedRating, maxRating },
    tagData, ratingData, recommendations,
  };
}

// ── UI components ─────────────────────────────────────────────────────────────

function Spinner({ label = "Fetching via Gemini…" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "48px 0" }}>
      <div style={{ width: 28, height: 28, border: `2px solid ${C.border}`, borderTop: `2px solid ${C.accent}`, borderRadius: "50%", animation: "spin .7s linear infinite" }} />
      <span style={{ color: C.muted, fontFamily: "'Space Mono',monospace", fontSize: 12 }}>{label}</span>
    </div>
  );
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 22px", flex: 1, minWidth: 130, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,transparent,${color || C.accent},transparent)` }} />
      <div style={{ color: C.muted, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Space Mono',monospace", marginBottom: 8 }}>{label}</div>
      <div style={{ color: color || C.text, fontSize: 30, fontWeight: 700, fontFamily: "'Space Mono',monospace", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ color: C.muted, fontSize: 11, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function TagRow({ tag, solved, failed, accuracy, rank }) {
  const color = accColor(accuracy);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${C.border}`, background: accuracy < 50 ? `${C.danger}09` : "transparent" }}>
      <div style={{ width: 22, color: C.muted, fontSize: 11, fontFamily: "'Space Mono',monospace", textAlign: "right" }}>{rank}</div>
      <div style={{ flex: 2, color: C.text, fontSize: 12, fontFamily: "'Space Mono',monospace" }}>{tag}</div>
      <div style={{ flex: 1, color: C.muted, fontSize: 11, textAlign: "center" }}>{solved}✓</div>
      <div style={{ flex: 1, color: C.muted, fontSize: 11, textAlign: "center" }}>{failed}✗</div>
      <div style={{ flex: 2, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, height: 5, background: C.border, borderRadius: 3, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(accuracy, 100)}%`, height: "100%", background: color, borderRadius: 3 }} />
        </div>
        <div style={{ width: 36, color, fontSize: 11, fontFamily: "'Space Mono',monospace", textAlign: "right" }}>{accuracy}%</div>
      </div>
      {accuracy < 50 && <div style={{ color: C.danger, fontSize: 9, fontFamily: "'Space Mono',monospace", background: `${C.danger}20`, padding: "2px 5px", borderRadius: 3 }}>WEAK</div>}
    </div>
  );
}

function ProblemCard({ p }) {
  return (
    <a href={`https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`} target="_blank" rel="noopener noreferrer"
      style={{ display: "block", textDecoration: "none", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "13px 16px", marginBottom: 8, transition: "border-color .2s,transform .15s" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.transform = "translateX(4px)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = "translateX(0)"; }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: C.accent, fontSize: 10, fontFamily: "'Space Mono',monospace", marginBottom: 4 }}>{p.contestId}{p.index} · ★{p.rating}</div>
          <div style={{ color: C.text, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{p.name}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {p.tags.slice(0, 4).map((t, i) => (
              <span key={i} style={{ background: `${TAG_COLORS[i % TAG_COLORS.length]}22`, color: TAG_COLORS[i % TAG_COLORS.length], fontSize: 9, padding: "2px 6px", borderRadius: 20, fontFamily: "'Space Mono',monospace" }}>{t}</span>
            ))}
          </div>
        </div>
        <span style={{ color: C.muted, fontSize: 16 }}>→</span>
      </div>
    </a>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [input, setInput] = useState("");
  const [handle, setHandle] = useState("");
  const [phase, setPhase] = useState("idle");
  const [phaseMsg, setPhaseMsg] = useState("");
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);
  const [tagData, setTagData] = useState([]);
  const [ratingData, setRatingData] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [tab, setTab] = useState("overview");
  const [aiPlan, setAiPlan] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const run = useCallback(async h => {
    setPhase("loading"); setPhaseMsg("Asking Gemini to fetch Codeforces data…");
    setError(""); setStats(null); setTagData([]); setRatingData([]); setRecommendations([]); setAiPlan("");
    try {
      const raw = await fetchCFData(h);
      if (raw.status !== "OK") throw new Error(`Handle "${h}" not found on Codeforces`);
      setPhaseMsg("Analyzing weaknesses…");
      const result = analyzeData(raw);
      setStats(result.stats); setTagData(result.tagData);
      setRatingData(result.ratingData); setRecommendations(result.recommendations);
      setPhase("done");
    } catch (e) {
      setError(e.message || "Something went wrong"); setPhase("error");
    }
  }, []);

  const genPlan = async () => {
    setAiLoading(true);
    try {
      const weak = tagData.filter(t => t.accuracy < 50).slice(0, 5);
      const plan = await fetchCoachPlan(handle, stats.estimatedRating, weak);
      console.log("Gemini plan:", plan);
      setAiPlan(plan);
    } catch (err) {
      console.error(err);
      setAiPlan("Could not generate plan. Please try again.");
    } finally {
      setAiLoading(false); // stop loading in both success and error cases
    }
  };

  const Tab = ({ id, icon, label }) => (
    <button onClick={() => setTab(id)} style={{
      background: tab === id ? C.accent : "transparent", color: tab === id ? "#fff" : C.muted,
      border: `1px solid ${tab === id ? C.accent : C.border}`, borderRadius: 7, padding: "7px 14px",
      cursor: "pointer", fontSize: 11, fontFamily: "'Space Mono',monospace", letterSpacing: .5, transition: "all .2s",
    }}>{icon} {label}</button>
  );

  const radarData = tagData.slice(-8).map(t => ({ tag: t.tag.length > 10 ? t.tag.slice(0, 10) + "…" : t.tag, accuracy: t.accuracy }));

  return (
    <div style={{ minHeight: "100%", width: "100%", background: C.bg, color: C.text, fontFamily: "'Sora','Segoe UI',sans-serif", paddingBottom: 60 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Sora:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html,body,#root{width:100%;height:100%;background:${C.bg}}
        body{overflow-y:auto}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        .up{animation:up .4s ease forwards}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${C.bg}}::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
        strong{color:${C.accent}}
      `}</style>

      {/* Nav */}
      <div style={{ borderBottom: `1px solid ${C.border}`, background: `${C.surface}ee`, backdropFilter: "blur(14px)", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 20, height: 20, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}><img src={reactSvg} alt="React" style={{ width: 30, height: 30, borderRadius: 7 }} /></div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>CF Performance Analyzer</div>
            <div style={{ fontSize: 10, color: C.muted, fontFamily: "'Space Mono',monospace" }}>API fetches Codeforces data</div>
          </div>
        </div>
        {handle && phase === "done" && <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 12, color: C.accent }}>@{handle}</div>}
      </div>

      <div style={{ maxWidth: 1060, margin: "0 auto", padding: "36px 20px" }}>

        {/* Search hero */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "32px 28px", marginBottom: 28, textAlign: "center", boxShadow: `0 0 80px ${C.accentSoft}` }}>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -1, marginBottom: 6 }}>
            Diagnose Your <span style={{ color: C.accent }}>CP Weaknesses</span>
          </div>
          <div style={{ color: C.muted, fontSize: 13, marginBottom: 26 }}>
            API fetches Codeforces data server-side — no CORP/CORS issues
          </div>
          <div style={{ display: "flex", gap: 10, maxWidth: 440, margin: "0 auto" }}>
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && input.trim()) { setHandle(input.trim()); run(input.trim()); } }}
              placeholder="e.g. tourist, Um_nik, neal_wu"
              style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9, padding: "11px 14px", color: C.text, fontSize: 13, fontFamily: "'Space Mono',monospace", outline: "none", transition: "border-color .2s" }}
              onFocus={e => e.target.style.borderColor = C.accent}
              onBlur={e => e.target.style.borderColor = C.border}
            />
            <button onClick={() => { if (input.trim()) { setHandle(input.trim()); run(input.trim()); } }}
              disabled={phase === "loading" || !input.trim()}
              style={{ background: `linear-gradient(135deg,${C.accent},#a855f7)`, color: "#fff", border: "none", borderRadius: 9, padding: "11px 20px", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'Space Mono',monospace", opacity: phase === "loading" || !input.trim() ? 0.5 : 1 }}
              onMouseDown={e => e.currentTarget.style.transform = "scale(.96)"}
              onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
            >{phase === "loading" ? "…" : "Analyze →"}</button>
          </div>
        </div>

        {phase === "loading" && <Spinner label={phaseMsg} />}

        {phase === "error" && (
          <div style={{ background: `${C.danger}12`, border: `1px solid ${C.danger}`, borderRadius: 10, padding: "16px 20px", color: C.danger, fontFamily: "'Space Mono',monospace", fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}

        {phase === "done" && stats && (
          <div className="up">
            {/* Stats */}
            <div style={{ display: "flex", gap: 14, marginBottom: 22, flexWrap: "wrap" }}>
              <StatCard label="Problems Solved" value={stats.totalSolved} sub="unique problems" color={C.success} />
              <StatCard label="Max Rating Hit" value={stats.maxRating || "—"} sub="hardest solved" color={C.accent} />
              <StatCard label="Weak Topics" value={stats.weakTagCount} sub="< 50% accuracy" color={C.danger} />
              <StatCard label="Submissions" value={stats.totalSubmissions} sub="last 500" />
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
              <Tab id="overview" icon="📊" label="Overview" />
              <Tab id="tags" icon="🏷" label="Tag Analysis" />
              <Tab id="ratings" icon="📈" label="Ratings" />
              <Tab id="recs" icon="🎯" label="Recs" />
              <Tab id="ai" icon="🤖" label="AI Coach" />
            </div>

            {/* OVERVIEW */}
            {tab === "overview" && (
              <div className="up" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                  <div style={{ fontSize: 10, color: C.muted, fontFamily: "'Space Mono',monospace", marginBottom: 12, letterSpacing: 1 }}>TAG ACCURACY RADAR</div>
                  <ResponsiveContainer width="100%" height={250}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke={C.border} />
                      <PolarAngleAxis dataKey="tag" tick={{ fill: C.muted, fontSize: 9, fontFamily: "Space Mono" }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: C.muted, fontSize: 8 }} tickCount={4} />
                      <Radar dataKey="accuracy" stroke={C.accent} fill={C.accent} fillOpacity={0.22} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                  <div style={{ fontSize: 10, color: C.muted, fontFamily: "'Space Mono',monospace", marginBottom: 12, letterSpacing: 1 }}>WEAKEST TAGS (TOP 7)</div>
                  {tagData.slice(0, 7).map((t, i) => (
                    <div key={i} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ fontSize: 11, fontFamily: "'Space Mono',monospace", color: C.text }}>{t.tag}</span>
                        <span style={{ fontSize: 11, color: accColor(t.accuracy), fontFamily: "'Space Mono',monospace" }}>{t.accuracy}%</span>
                      </div>
                      <div style={{ height: 5, background: C.border, borderRadius: 3 }}>
                        <div style={{ width: `${t.accuracy}%`, height: "100%", background: accColor(t.accuracy), borderRadius: 3 }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, gridColumn: "1/-1" }}>
                  <div style={{ fontSize: 10, color: C.muted, fontFamily: "'Space Mono',monospace", marginBottom: 12, letterSpacing: 1 }}>SOLVED COUNT BY RATING BUCKET</div>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={ratingData}>
                      <XAxis dataKey="rating" tick={{ fill: C.muted, fontSize: 9, fontFamily: "Space Mono" }} />
                      <YAxis tick={{ fill: C.muted, fontSize: 9 }} />
                      <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontFamily: "Space Mono", fontSize: 10 }} />
                      <Bar dataKey="solved" radius={[4, 4, 0, 0]}>
                        {ratingData.map((r, i) => <Cell key={i} fill={accColor(r.accuracy)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* TAGS */}
            {tab === "tags" && (
              <div className="up" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "13px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 12 }}>
                  {["#", "TAG", "SOLVED", "FAILED", "ACCURACY"].map((h, i) => (
                    <span key={i} style={{ fontSize: 9, color: C.muted, fontFamily: "'Space Mono',monospace", flex: i === 0 ? "0 0 22px" : i === 1 ? 2 : i === 4 ? 2 : 1, textAlign: i > 1 ? "center" : "left" }}>{h}</span>
                  ))}
                </div>
                {tagData.map((t, i) => <TagRow key={t.tag} {...t} rank={i + 1} />)}
              </div>
            )}

            {/* RATINGS */}
            {tab === "ratings" && (
              <div className="up">
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22, marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: C.muted, fontFamily: "'Space Mono',monospace", marginBottom: 12, letterSpacing: 1 }}>SOLVED vs FAILED BY RATING</div>
                  <ResponsiveContainer width="100%" height={230}>
                    <BarChart data={ratingData} barGap={3}>
                      <XAxis dataKey="rating" tick={{ fill: C.muted, fontSize: 9, fontFamily: "Space Mono" }} />
                      <YAxis tick={{ fill: C.muted, fontSize: 9 }} />
                      <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontFamily: "Space Mono", fontSize: 10 }} />
                      <Bar dataKey="solved" name="Solved" fill={C.success} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="failed" name="Failed" fill={C.danger} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(155px,1fr))", gap: 10 }}>
                  {ratingData.filter(r => r.failed > 0).map(r => (
                    <div key={r.rating} style={{ background: C.card, border: `1px solid ${r.accuracy < 50 ? C.danger : C.border}`, borderRadius: 9, padding: "13px 15px" }}>
                      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Space Mono',monospace", color: C.accent }}>{r.rating}</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{r.solved} solved · {r.failed} failed</div>
                      <div style={{ fontSize: 12, color: accColor(r.accuracy), fontFamily: "'Space Mono',monospace", marginTop: 4 }}>{r.accuracy}% acc</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* RECOMMENDATIONS */}
            {tab === "recs" && (
              <div className="up">
                <div style={{ background: `${C.accent}0f`, border: `1px solid ${C.accent}30`, borderRadius: 9, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: C.muted }}>
                  🎯 Unsolved problems in your weak tags · targeting ~{stats.estimatedRating} rating
                </div>
                {recommendations.length === 0
                  ? <div style={{ textAlign: "center", padding: 40, color: C.muted }}>No recommendations found — solve more problems first!</div>
                  : <div style={{ columns: "2", columnGap: 14 }}>
                    {recommendations.map((p, i) => <ProblemCard key={i} p={p} />)}
                  </div>}
              </div>
            )}

            {/* AI COACH */}
            {tab === "ai" && (
              <div className="up">
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>AI Coaching Plan</div>
                      <div style={{ fontSize: 12, color: C.muted }}>Personalized 7-day study plan based on your weak areas</div>
                    </div>
                    <button onClick={genPlan} disabled={aiLoading}
                      style={{ background: `linear-gradient(135deg,${C.accent},#a855f7)`, color: "#fff", border: "none", borderRadius: 9, padding: "11px 18px", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Space Mono',monospace", opacity: aiLoading ? 0.5 : 1 }}>
                      {aiLoading ? "Thinking…" : "🤖 Generate Plan"}
                    </button>
                  </div>
                  {aiLoading && <Spinner label="Gemini is building your plan…" />}
                  {!aiPlan && !aiLoading && <div style={{ textAlign: "center", padding: "32px 0", color: C.muted, fontSize: 12 }}>Click "Generate Plan" to get your coaching analysis</div>}
                  {aiPlan && (
                    <div style={{ background: C.surface, borderRadius: 10, padding: "18px 22px", borderLeft: `3px solid ${C.accent}`, fontSize: 13, lineHeight: 1.85 }}>
                      <style>{`
                        .day { padding: 10px 0; border-bottom: 1px solid ${C.border}; }
                        .day:last-child { border-bottom: none; }
                        .day-label { color: ${C.accent}; font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: 1px; }
                        .day strong { color: ${C.text}; font-size: 13px; }
                        .day ul { margin: 6px 0 0 16px; }
                        .day ul li { color: ${C.muted}; font-size: 12px; font-family: 'Space Mono', monospace; margin-bottom: 2px; }
                      `}</style>
                      <div dangerouslySetInnerHTML={{ __html: aiPlan }} />
                    </div>
                  )}
                </div>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>📉 Weakness Snapshot</div>
                  {tagData.filter(t => t.accuracy < 50).slice(0, 6).map((t, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
                      <div>
                        <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 12 }}>{t.tag}</span>
                        <span style={{ fontSize: 10, color: C.muted, marginLeft: 10 }}>{t.solved}✓ {t.failed}✗</span>
                      </div>
                      <div style={{ background: `${C.danger}18`, color: C.danger, padding: "3px 9px", borderRadius: 5, fontSize: 10, fontFamily: "'Space Mono',monospace" }}>{t.accuracy}%</div>
                    </div>
                  ))}
                  {tagData.filter(t => t.accuracy < 50).length === 0 && <div style={{ color: C.success, fontSize: 13 }}>🎉 No significant weaknesses detected — great work!</div>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {phase === "idle" && (
          <div style={{ textAlign: "center", padding: "64px 0", color: C.muted }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🏆</div>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 13, marginBottom: 6 }}>Enter a Codeforces handle above</div>
            <div style={{ fontSize: 12 }}>Try: <span style={{ color: C.accent }}>tourist</span> · <span style={{ color: C.accent }}>Petr</span> · <span style={{ color: C.accent }}>Um_nik</span></div>
            <div style={{ marginTop: 20, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, color: C.muted, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 16px" }}>
              <span style={{ color: C.success }}>✓</span> No CORS/CORP issues — Gemini fetches all data server-side via web_search tool
            </div>
          </div>
        )}
      </div>
    </div>
  );
}