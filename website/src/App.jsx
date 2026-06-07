import { useState, useCallback, useEffect } from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from "recharts";

const C = {
  bg: "#07070f", surface: "#0f0f1a", card: "#13131f", border: "#1e1e30",
  accent: "#7c6dfa", accentSoft: "#7c6dfa18", danger: "#ff4560",
  success: "#00e396", warn: "#feb019", text: "#dde1f0", muted: "#5a5a7a",
};

const TAG_COLORS = ["#7c6dfa","#ff4560","#00e396","#feb019","#00b4d8","#f72585","#4cc9f0","#a78bfa","#fb5607","#06d6a0"];
const accColor = a => a >= 70 ? C.success : a >= 45 ? C.warn : C.danger;

async function fetchCFData(handle) {
  const res = await fetch(`/api/cf/${handle}`);
  return res.json();
}

async function fetchMLAnalysis(handle) {
  const res = await fetch(`/api/ml/analyze/${handle}`);
  if (!res.ok) throw new Error("ML pipeline failed");
  return res.json();
}

async function fetchCoachPlan(handle, estimatedRating, weakTags, strongTags, recommendedProblems, totalSolved, tagImpact) {
  const res = await fetch("/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle, estimatedRating, weakTags, strongTags, recommendedProblems, totalSolved, tagImpact }),
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

  return {
    stats: { totalSolved: solvedSet.size, totalSubmissions: submissions.length, estimatedRating, maxRating },
    tagData, ratingData,
  };
}

// ── UI components ─────────────────────────────────────────────────────────────
function Spinner({ label = "Loading…" }) {
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

// ── Main ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [input, setInput]               = useState("");
  const [handle, setHandle]             = useState("");
  const [phase, setPhase]               = useState("idle");
  const [phaseMsg, setPhaseMsg]         = useState("");
  const [error, setError]               = useState("");
  const [stats, setStats]               = useState(null);
  const [tagData, setTagData]           = useState([]);
  const [ratingData, setRatingData]     = useState([]);
  const [tab, setTab]                   = useState("overview");
  const [aiPlan, setAiPlan]             = useState("");
  const [aiLoading, setAiLoading]       = useState(false);
  const [mlData, setMlData]             = useState(null);
  const [mlLoading, setMlLoading]       = useState(false);
  const [coachUnlocked, setCoachUnlocked] = useState(false);
  const [coachPwInput, setCoachPwInput]   = useState("");
  const [coachPwError, setCoachPwError]   = useState(false);
  const [mlVersion, setMlVersion]         = useState(null);

  // Fetch model metadata once on mount: how many users the KNN model was
  // trained on (dynamic) and when the model was last updated.
  useEffect(() => {
    fetch("/api/ml/version")
      .then(r => (r.ok ? r.json() : null))
      .then(v => v && setMlVersion(v))
      .catch(() => {});
  }, []);

  // KNN training-set size, formatted with thousands separators. Falls back to a
  // neutral label if the version endpoint hasn't responded yet.
  const trainingUsers = mlVersion?.training_users ?? null;
  const trainingUsersLabel = trainingUsers != null ? trainingUsers.toLocaleString() : "…";
  const modelUpdatedLabel = mlVersion?.last_updated
    ? new Date(mlVersion.last_updated).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  // Derived ML values (safe defaults when ML hasn't loaded yet)
  const mlTagStrengths   = mlData?.tag_strengths || {};
  const mlNeighbors      = [...(mlData?.recommendation?.recommendation?.neighbors || [])].sort((a, b) => (b.display_similarity ?? b.similarity ?? 0) - (a.display_similarity ?? a.similarity ?? 0));
  const mlProblems       = mlData?.recommended_problems || [];
  const mlTagsSorted     = Object.entries(mlTagStrengths)
    .filter(([, v]) => v.attempted > 0)
    .sort((a, b) => a[1].strength - b[1].strength);
  const weakTagCount     = mlTagsSorted.filter(([, v]) => v.strength < 70).length;
  const tagImpact = (mlData?.tag_impact || []).filter(t => t.delta_problems > 0).slice(0, 8);

  const run = useCallback(async h => {
    setPhase("loading"); setPhaseMsg("Fetching Codeforces data…");
    setError(""); setStats(null); setTagData([]); setRatingData([]);
    setAiPlan(""); setMlData(null); setMlLoading(true);

    try {
      // Fire both requests in parallel
      const [raw, ml] = await Promise.allSettled([
        fetchCFData(h),
        fetchMLAnalysis(h),
      ]);

      // CF data (required)
      if (raw.status === "rejected") throw new Error(raw.reason?.message || "CF fetch failed");
      const cfData = raw.value;
      if (cfData.status !== "OK") throw new Error(`Handle "${h}" not found on Codeforces`);

      setPhaseMsg("Analyzing…");
      const result = analyzeData(cfData);
      setStats(result.stats);
      setTagData(result.tagData);
      setRatingData(result.ratingData);

      // ML data (optional — show without it if it fails)
      if (ml.status === "fulfilled" && ml.value?.success) {
        setMlData(ml.value);
      }

      setPhase("done");
    } catch (e) {
      setError(e.message || "Something went wrong");
      setPhase("error");
    } finally {
      setMlLoading(false);
    }
  }, []);

  const genPlan = async () => {
    setAiLoading(true);
    try {
      const weakTags = mlTagsSorted.length
        ? mlTagsSorted.slice(0, 8).map(([tag, v]) => ({
            tag: tag.replace("tag_", "").replace(/_/g, " "),
            strength: Math.round(v.strength),
            solved: v.solved,
            attempted: v.attempted,
          }))
        : tagData.filter(t => t.accuracy < 70).slice(0, 8).map(t => ({
            tag: t.tag, strength: t.accuracy, solved: t.solved, attempted: t.solved + t.failed,
          }));

      const strongTags = mlTagsSorted.length
        ? [...mlTagsSorted].reverse().slice(0, 3).map(([tag, v]) => ({
            tag: tag.replace("tag_", "").replace(/_/g, " "),
            strength: Math.round(v.strength),
          }))
        : [];

      const recommendedProblems = mlProblems.slice(0, 10).map(p => ({
        id: p.id,
        rating: p.rating,
        tags: (p.tags || []).map(t => t.replace("tag_", "").replace(/_/g, " ")),
        difficulty_match: p.difficulty_match ?? 0,
        weakness_boost: p.weakness_boost ?? 0,
        estimated_attempts: p.estimated_attempts ?? null,
        difficulty_label: p.difficulty_label ?? null,
      }));

      const plan = await fetchCoachPlan(
        handle, stats.estimatedRating, weakTags, strongTags, recommendedProblems, stats.totalSolved, tagImpact
      );
      setAiPlan(plan);
    } catch (err) {
      setAiPlan("Could not generate plan. Please try again.");
    } finally {
      setAiLoading(false);
    }
  };

  const Tab = ({ id, icon, label, badge }) => (
    <button onClick={() => setTab(id)} style={{
      background: tab === id ? C.accent : "transparent", color: tab === id ? "#fff" : C.muted,
      border: `1px solid ${tab === id ? C.accent : C.border}`, borderRadius: 7, padding: "7px 14px",
      cursor: "pointer", fontSize: 11, fontFamily: "'Space Mono',monospace", letterSpacing: .5,
      transition: "all .2s", position: "relative",
    }}>
      {icon} {label}
      {badge != null && (
        <span style={{ marginLeft: 6, background: tab === id ? "rgba(255,255,255,0.25)" : C.accentSoft, color: tab === id ? "#fff" : C.accent, fontSize: 9, padding: "1px 5px", borderRadius: 10, fontFamily: "'Space Mono',monospace" }}>
          {badge}
        </span>
      )}
    </button>
  );

  // Radar uses ML tag strengths (0–100 scale) when available, else CF accuracy
  const radarData = mlTagsSorted.length
    ? mlTagsSorted.slice(-10).map(([tag, v]) => ({
        tag: tag.replace("tag_","").replace(/_/g," ").slice(0,10),
        accuracy: Math.round(v.strength),
      }))
    : tagData.slice(-8).map(t => ({
        tag: t.tag.length > 10 ? t.tag.slice(0, 10) + "…" : t.tag,
        accuracy: t.accuracy,
      }));

  // Merged tag rows: CF accuracy + ML strength side by side
  const mergedTagData = tagData
    .map(t => {
      const key = "tag_" + t.tag.replace(/ /g,"_");
      const mlInfo = mlTagStrengths[key] || mlTagStrengths[t.tag] || null;
      return { ...t, mlStrength: mlInfo ? Math.round(mlInfo.strength) : null, mlAttempted: mlInfo?.attempted ?? 0 };
    })
    .sort((a, b) => mlData
      ? (a.mlStrength ?? 101) - (b.mlStrength ?? 101)
      : a.accuracy - b.accuracy
    );

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
          <div style={{ width: 28, height: 28, borderRadius: 7, background: `linear-gradient(135deg,${C.accent},#a855f7)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⚡</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>CF Performance Analyzer</div>
            <div style={{ fontSize: 10, color: C.muted, fontFamily: "'Space Mono',monospace" }}>
              {mlData ? "✦ ML model active" : "Codeforces · KNN · Tag Strength"}
            </div>
          </div>
        </div>
        {handle && phase === "done" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {mlLoading && <span style={{ fontSize: 10, color: C.warn, fontFamily: "'Space Mono',monospace" }}>⟳ ML running…</span>}
            {mlData && <span style={{ fontSize: 10, color: C.success, fontFamily: "'Space Mono',monospace" }}>✦ ML ready</span>}
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 12, color: C.accent }}>@{handle}</div>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 1060, margin: "0 auto", padding: "36px 20px" }}>

        {/* Search */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "32px 28px", marginBottom: 28, textAlign: "center", boxShadow: `0 0 80px ${C.accentSoft}` }}>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -1, marginBottom: 6 }}>
            Diagnose Your <span style={{ color: C.accent }}>CP Weaknesses</span>
          </div>
          <div style={{ color: C.muted, fontSize: 13, marginBottom: 26 }}>
            Combines Codeforces data with a KNN model trained on {trainingUsersLabel} users
            {modelUpdatedLabel && (
              <span style={{ display: "block", fontSize: 11, color: C.muted, marginTop: 4, opacity: 0.75 }}>
                Model last updated {modelUpdatedLabel}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, maxWidth: 440, margin: "0 auto" }}>
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && input.trim()) { setHandle(input.trim()); run(input.trim()); } }}
              placeholder="e.g. tourist, Um_nik, o.khalifa"
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
            {/* Stat cards — weak topics count from ML when available */}
            <div style={{ display: "flex", gap: 14, marginBottom: 22, flexWrap: "wrap" }}>
              <StatCard label="Problems Solved" value={stats.totalSolved} sub="unique AC problems" color={C.success} />
              <StatCard label="Hardest Solved"  value={stats.maxRating || "—"} sub="highest-rated AC" color={C.accent} />
              <StatCard label="Weak Topics"     value={mlData ? weakTagCount : tagData.filter(t => t.accuracy < 70).length} sub={mlData ? "tags behind your peers" : "topics below 70% accuracy"} color={C.danger} />
              <StatCard label="Total Submissions" value={stats.totalSubmissions} sub="all attempts ever" />
              {tagImpact.length > 0 && (
                <StatCard
                  label="Biggest Lever"
                  value={`+${tagImpact[0].estimated_rating_gain} pts`}
                  sub={`improve ${tagImpact[0].label} → most rating gain`}
                  color={C.warn}
                />
              )}
              {mlData && tagImpact.length === 0 && <StatCard label="KNN Neighbors" value={mlNeighbors.length} sub="similar users found" color={C.accent} />}
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
              <Tab id="overview" icon="📊" label="Overview" />
              <Tab id="tags"     icon="🏷"  label="Tag Analysis" />
              <Tab id="ratings"  icon="📈"  label="Ratings" />
              <Tab id="recs"     icon="🎯"  label="Recs" badge={mlData ? mlProblems.length : null} />
              <Tab id="peers"    icon="👥"  label="Peers" badge={mlData ? mlNeighbors.length : null} />
              <Tab id="ai"       icon="🤖"  label="AI Coach" />
            </div>

            {/* ── OVERVIEW ── */}
            {tab === "overview" && (
              <div className="up" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>

                {/* Radar — ML strengths when available */}
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                  <div style={{ fontSize: 10, color: C.muted, fontFamily: "'Space Mono',monospace", marginBottom: 4, letterSpacing: 1 }}>
                    {mlData ? "ML TAG STRENGTH (PEER-BENCHMARKED)" : "TAG ACCURACY RADAR"}
                  </div>
                  {mlData
                    ? <div style={{ fontSize: 9, color: C.accent, fontFamily: "'Space Mono',monospace", marginBottom: 6 }}>✦ powered by KNN model · 0–100 scale</div>
                    : <div style={{ fontSize: 9, color: C.accent, fontFamily: "'Space Mono',monospace", marginBottom: 6 }}>✦ based on your solve rate per topic</div>
                  }
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
                    {mlData
                      ? <>Each axis is a topic. Your score is <span style={{ color: C.text }}>compared against ~50 similar-rated users</span> — so 60 means you're weaker here than your peers, not just that you solve 60% of attempts.</>
                      : <>Each axis shows how often you successfully solve problems tagged with that topic. A fuller shape means more balanced coverage.</>
                    }
                  </div>
                  <ResponsiveContainer width="100%" height={230}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke={C.border} />
                      <PolarAngleAxis dataKey="tag" tick={{ fill: C.muted, fontSize: 9, fontFamily: "Space Mono" }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: C.muted, fontSize: 8 }} tickCount={4} />
                      <Radar dataKey="accuracy" stroke={mlData ? C.success : C.accent} fill={mlData ? C.success : C.accent} fillOpacity={0.22} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                {/* Weakest tags — ML strengths when available */}
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                  <div style={{ fontSize: 10, color: C.muted, fontFamily: "'Space Mono',monospace", marginBottom: 4, letterSpacing: 1 }}>
                    WEAKEST TAGS (TOP 7)
                  </div>
                  {mlData
                    ? <div style={{ fontSize: 9, color: C.accent, fontFamily: "'Space Mono',monospace", marginBottom: 6 }}>✦ ML peer-benchmarked strength</div>
                    : <div style={{ fontSize: 9, color: C.accent, fontFamily: "'Space Mono',monospace", marginBottom: 6 }}>✦ sorted by solve accuracy</div>
                  }
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 14, lineHeight: 1.5 }}>
                    {mlData
                      ? <>These are the topics where you fall <span style={{ color: C.danger }}>behind others at your rating</span>. A low score means peers solve these more reliably — prioritize them for the biggest gains.</>
                      : <>Topics where your solve rate is lowest. Under <span style={{ color: C.warn }}>70%</span> is a meaningful weakness worth targeting.</>
                    }
                  </div>
                  {(mlData ? mlTagsSorted.slice(0, 7) : tagData.slice(0, 7).map(t => [t.tag, { strength: t.accuracy, solved: t.solved, attempted: t.solved + t.failed }])).map(([tag, info], i) => {
                    const label = mlData ? tag.replace("tag_","").replace(/_/g," ") : tag;
                    const pct   = mlData ? Math.min(info.strength, 100) : info.strength;
                    const color = accColor(pct);
                    return (
                      <div key={i} style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ fontSize: 11, fontFamily: "'Space Mono',monospace", color: C.text, textTransform: "capitalize" }}>{label}</span>
                          <span style={{ fontSize: 11, color, fontFamily: "'Space Mono',monospace" }}>{Math.round(pct)}{mlData ? "" : "%"}</span>
                        </div>
                        <div style={{ height: 5, background: C.border, borderRadius: 3 }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Counterfactual Tag Impact card */}
                {tagImpact.length > 0 && (
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, gridColumn: "1/-1" }}>
                    <div style={{ fontSize: 10, color: C.muted, fontFamily: "'Space Mono',monospace", marginBottom: 4, letterSpacing: 1 }}>WHERE TO FOCUS FOR MAXIMUM RATING GAIN</div>
                    <div style={{ fontSize: 9, color: C.accent, fontFamily: "'Space Mono',monospace", marginBottom: 8 }}>✦ ML counterfactual simulation — each tag boosted by +20% strength in isolation</div>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 16, lineHeight: 1.6, maxWidth: 720 }}>
                      The model asks: <span style={{ color: C.text }}>"If this user improved at tag X by 20%, how many more problems from their peer group would they be able to solve?"</span> The bar shows extra solvable problems; the number on the right estimates the rating points that unlocks. <span style={{ color: C.warn }}>Top-ranked tags are your highest-leverage training targets.</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {tagImpact.map((t, i) => {
                        const barPct = Math.min(100, (t.delta_problems / Math.max(...tagImpact.map(x => x.delta_problems))) * 100);
                        const color  = i === 0 ? C.warn : i < 3 ? C.accent : C.muted;
                        return (
                          <div key={t.tag} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{ width: 130, fontSize: 11, fontFamily: "'Space Mono',monospace", color: C.text, textTransform: "capitalize", flexShrink: 0 }}>
                              {i === 0 && <span style={{ color: C.warn, marginRight: 4 }}>★</span>}{t.label}
                            </div>
                            <div style={{ fontSize: 10, fontFamily: "'Space Mono',monospace", color: C.muted, width: 42, flexShrink: 0 }} title="Current peer-benchmarked strength">{Math.round(t.strength * 100)}%</div>
                            <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${barPct}%`, height: "100%", background: color, borderRadius: 3, transition: "width .4s" }} />
                            </div>
                            <div style={{ width: 90, textAlign: "right", fontFamily: "'Space Mono',monospace", fontSize: 11, color, flexShrink: 0 }}>
                              +{t.delta_problems} problems
                            </div>
                            <div style={{ width: 80, textAlign: "right", fontFamily: "'Space Mono',monospace", fontSize: 11, color: C.warn, flexShrink: 0 }}>
                              ~+{t.estimated_rating_gain} pts
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: 14, display: "flex", gap: 20, fontSize: 10, color: C.muted, fontFamily: "'Space Mono',monospace" }}>
                      <span>current strength %</span>
                      <span>→ extra solvable problems if improved</span>
                      <span>→ estimated rating gain</span>
                    </div>
                  </div>
                )}

                {/* Solved by rating bucket */}
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, gridColumn: "1/-1" }}>
                  <div style={{ fontSize: 10, color: C.muted, fontFamily: "'Space Mono',monospace", marginBottom: 4, letterSpacing: 1 }}>SOLVED COUNT BY RATING BUCKET</div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 14, lineHeight: 1.5 }}>
                    How many problems you've solved at each difficulty level. Bar color reflects your accuracy at that rating —{" "}
                    <span style={{ color: C.success }}>green</span> means high success rate,{" "}
                    <span style={{ color: C.warn }}>yellow</span> means mixed,{" "}
                    <span style={{ color: C.danger }}>red</span> means you often attempt but don't solve.{" "}
                    <span style={{ color: C.text }}>Your comfort zone is where the green bars are tallest.</span>
                  </div>
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

            {/* ── TAG ANALYSIS ── */}
            {tab === "tags" && (
              <div className="up" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                {mlData && (
                  <div style={{ padding: "10px 16px", background: `${C.accent}0a`, borderBottom: `1px solid ${C.accent}22`, fontSize: 10, color: C.accent, fontFamily: "'Space Mono',monospace" }}>
                    ✦ ML STRENGTH column = peer-benchmarked score from KNN model (0–100)
                  </div>
                )}
                <div style={{ padding: "13px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 12 }}>
                  {["#", "TAG", "SOLVED", "FAILED", ...(mlData ? ["ML STRENGTH"] : [])].map((h, i) => (
                    <span key={i} style={{ fontSize: 9, color: C.muted, fontFamily: "'Space Mono',monospace", flex: i === 0 ? "0 0 22px" : i === 1 ? 2 : i === 4 ? 2 : 1, textAlign: i > 1 ? "center" : "left" }}>{h}</span>
                  ))}
                </div>
                {mergedTagData.map((t, i) => {
                  const mlColor = t.mlStrength != null ? accColor(t.mlStrength) : C.muted;
                  return (
                    <div key={t.tag} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${C.border}`, background: (mlData ? t.mlStrength < 70 : t.accuracy < 70) ? `${C.danger}09` : "transparent" }}>
                      <div style={{ width: 22, color: C.muted, fontSize: 11, fontFamily: "'Space Mono',monospace", textAlign: "right" }}>{i + 1}</div>
                      <div style={{ flex: 2, color: C.text, fontSize: 12, fontFamily: "'Space Mono',monospace" }}>{t.tag}</div>
                      <div style={{ flex: 1, color: C.muted, fontSize: 11, textAlign: "center" }}>{t.solved}✓</div>
                      <div style={{ flex: 1, color: C.muted, fontSize: 11, textAlign: "center" }}>{t.failed}✗</div>
                      {/* ML strength bar */}
                      {mlData && (
                        <div style={{ flex: 2, display: "flex", alignItems: "center", gap: 6 }}>
                          {t.mlStrength != null ? (
                            <>
                              <div style={{ flex: 1, height: 5, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                                <div style={{ width: `${Math.min(t.mlStrength, 100)}%`, height: "100%", background: mlColor, borderRadius: 3 }} />
                              </div>
                              <span style={{ width: 30, color: mlColor, fontSize: 10, fontFamily: "'Space Mono',monospace", textAlign: "right" }}>{t.mlStrength}</span>
                              {t.mlStrength < 70 && <span style={{ color: C.danger, fontSize: 9, fontFamily: "'Space Mono',monospace", background: `${C.danger}20`, padding: "2px 5px", borderRadius: 3 }}>WEAK</span>}
                            </>
                          ) : (
                            <span style={{ fontSize: 10, color: C.muted, fontFamily: "'Space Mono',monospace" }}>—</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── RATINGS ── */}
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
                      <Bar dataKey="failed" name="Failed" fill={C.danger}  radius={[4, 4, 0, 0]} />
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

            {/* ── RECS — ML problems when available ── */}
            {tab === "recs" && (
              <div className="up">
                {mlData ? (
                  <>
                    <div style={{ background: `${C.accent}0f`, border: `1px solid ${C.accent}30`, borderRadius: 9, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: C.muted }}>
                      ✦ ML-ranked · sourced from 50 nearest neighbors · scored by <span style={{ color: C.success }}>difficulty match</span> + <span style={{ color: C.warn }}>weakness boost</span>
                    </div>
                    {mlProblems.length === 0
                      ? <div style={{ textAlign: "center", padding: 40, color: C.muted }}>No recommendations found.</div>
                      : (
                        <div style={{ columns: 2, columnGap: 14 }}>
                          {mlProblems.slice(0, 20).map((p, i) => {
                            const [contestId, idx] = p.id.split("_");
                            return (
                              <a key={i}
                                href={`https://codeforces.com/problemset/problem/${contestId}/${idx}`}
                                target="_blank" rel="noopener noreferrer"
                                style={{ display: "block", textDecoration: "none", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "13px 16px", marginBottom: 8, transition: "border-color .2s,transform .15s", breakInside: "avoid" }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.transform = "translateX(4px)"; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = "none"; }}>
                                <div style={{ color: C.accent, fontSize: 10, fontFamily: "'Space Mono',monospace", marginBottom: 4 }}>
                                  {p.id} · ★{p.rating}
                                </div>
                                <div style={{ display: "flex", gap: 10, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
                                  <span style={{ fontSize: 10, color: C.success, fontFamily: "'Space Mono',monospace" }}>◈ {Math.round(p.difficulty_match * 100)}% match</span>
                                  <span style={{ fontSize: 10, color: C.warn,    fontFamily: "'Space Mono',monospace" }}>↑ {(p.weakness_boost * 100).toFixed(0)}% growth</span>
                                  {p.estimated_attempts != null && (
                                    <span style={{
                                      fontSize: 9, fontFamily: "'Space Mono',monospace",
                                      padding: "2px 7px", borderRadius: 4,
                                      background: p.difficulty_label === "easy" ? `${C.success}20` : p.difficulty_label === "moderate" ? `${C.warn}20` : `${C.danger}20`,
                                      color:      p.difficulty_label === "easy" ? C.success      : p.difficulty_label === "moderate" ? C.warn      : C.danger,
                                    }}>
                                      ~{p.estimated_attempts.toFixed(1)} tries
                                    </span>
                                  )}
                                </div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                  {(p.tags || []).slice(0, 4).map((t, j) => (
                                    <span key={j} style={{ background: `${TAG_COLORS[j % TAG_COLORS.length]}22`, color: TAG_COLORS[j % TAG_COLORS.length], fontSize: 9, padding: "2px 6px", borderRadius: 20, fontFamily: "'Space Mono',monospace" }}>
                                      {t.replace("tag_","").replace(/_/g," ")}
                                    </span>
                                  ))}
                                </div>
                              </a>
                            );
                          })}
                        </div>
                      )
                    }
                  </>
                ) : (
                  <div style={{ textAlign: "center", padding: 40, color: C.muted, fontFamily: "'Space Mono',monospace", fontSize: 12 }}>
                    ML model did not load for this handle — recommendations unavailable.
                  </div>
                )}
              </div>
            )}

            {/* ── PEERS — KNN nearest neighbors ── */}
            {tab === "peers" && (
              <div className="up">
                {!mlData ? (
                  <div style={{ textAlign: "center", padding: 40, color: C.muted, fontFamily: "'Space Mono',monospace", fontSize: 12 }}>
                    ML model did not load — peer data unavailable.
                  </div>
                ) : (
                  <>
                    <div style={{ background: `${C.accent}0f`, border: `1px solid ${C.accent}30`, borderRadius: 9, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: C.muted }}>
                      👥 50 most similar users from a dataset of {trainingUsersLabel} · ranked by Euclidean distance in 82-dimensional tag-strength space
                    </div>
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                      {/* Header */}
                      <div style={{ display: "grid", gridTemplateColumns: "40px 1fr 120px 80px", gap: 12, padding: "11px 18px", borderBottom: `1px solid ${C.border}` }}>
                        {["RANK", "HANDLE", "SIMILARITY", "DISTANCE"].map((h, i) => (
                          <span key={i} style={{ fontSize: 9, color: C.muted, fontFamily: "'Space Mono',monospace", textAlign: i > 1 ? "center" : "left" }}>{h}</span>
                        ))}
                      </div>
                      {mlNeighbors.map((n, i) => {
                        const sim     = n.display_similarity ?? n.similarity ?? Math.max(0, Math.round((1 - n.distance / ((mlNeighbors[mlNeighbors.length - 1]?.distance || 1) + 0.01)) * 100));
                        const rowBg   = i % 2 === 0 ? "transparent" : `${C.surface}80`;
                        return (
                          <div key={n.user_handle} style={{ display: "grid", gridTemplateColumns: "40px 1fr 120px 80px", gap: 12, padding: "10px 18px", borderBottom: `1px solid ${C.border}`, background: rowBg, alignItems: "center" }}>
                            <span style={{ fontSize: 12, color: i < 3 ? C.accent : C.muted, fontFamily: "'Space Mono',monospace", fontWeight: i < 3 ? 700 : 400 }}>#{n.rank}</span>
                            <a href={`https://codeforces.com/profile/${n.user_handle}`} target="_blank" rel="noopener noreferrer"
                              style={{ color: C.text, fontSize: 13, fontFamily: "'Space Mono',monospace", textDecoration: "none", transition: "color .15s" }}
                              onMouseEnter={e => e.target.style.color = C.accent}
                              onMouseLeave={e => e.target.style.color = C.text}>
                              {n.user_handle}
                            </a>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <div style={{ flex: 1, height: 5, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                                <div style={{ width: `${sim}%`, height: "100%", background: sim > 70 ? C.success : sim > 40 ? C.warn : C.accent, borderRadius: 3 }} />
                              </div>
                              <span style={{ fontSize: 10, color: C.muted, fontFamily: "'Space Mono',monospace", width: 28, textAlign: "right" }}>{sim}%</span>
                            </div>
                            <span style={{ fontSize: 10, color: C.muted, fontFamily: "'Space Mono',monospace", textAlign: "center" }}>{n.distance.toFixed(3)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── AI COACH ── */}
            {tab === "ai" && (
              <div className="up">

                {/* Password gate */}
                {!coachUnlocked && (
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 36, marginBottom: 16, textAlign: "center" }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>AI Coach is Access-Restricted</div>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 24 }}>Enter the access code to generate your personalized coaching plan</div>
                    <div style={{ display: "flex", gap: 10, maxWidth: 340, margin: "0 auto" }}>
                      <input
                        type="password"
                        value={coachPwInput}
                        onChange={e => { setCoachPwInput(e.target.value); setCoachPwError(false); }}
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            if (coachPwInput === "free12345") { setCoachUnlocked(true); setCoachPwInput(""); }
                            else setCoachPwError(true);
                          }
                        }}
                        placeholder="Access code"
                        style={{ flex: 1, background: C.surface, border: `1px solid ${coachPwError ? C.danger : C.border}`, borderRadius: 9, padding: "11px 14px", color: C.text, fontSize: 13, fontFamily: "'Space Mono',monospace", outline: "none", transition: "border-color .2s" }}
                        onFocus={e => e.target.style.borderColor = coachPwError ? C.danger : C.accent}
                        onBlur={e => e.target.style.borderColor = coachPwError ? C.danger : C.border}
                      />
                      <button
                        onClick={() => {
                          if (coachPwInput === "free12345") { setCoachUnlocked(true); setCoachPwInput(""); }
                          else setCoachPwError(true);
                        }}
                        style={{ background: `linear-gradient(135deg,${C.accent},#a855f7)`, color: "#fff", border: "none", borderRadius: 9, padding: "11px 18px", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'Space Mono',monospace" }}>
                        Unlock
                      </button>
                    </div>
                    {coachPwError && (
                      <div style={{ marginTop: 10, fontSize: 11, color: C.danger, fontFamily: "'Space Mono',monospace" }}>
                        ✗ Incorrect access code
                      </div>
                    )}
                  </div>
                )}

                {/* Unlocked: plan generator + weakness snapshot */}
                {coachUnlocked && (
                  <>
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginBottom: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>AI Coaching Plan</div>
                          <div style={{ fontSize: 12, color: C.muted }}>
                            7-day study plan · {mlData ? "based on ML tag strengths" : "based on CF accuracy"}
                          </div>
                        </div>
                        <button onClick={genPlan} disabled={aiLoading}
                          style={{ background: `linear-gradient(135deg,${C.accent},#a855f7)`, color: "#fff", border: "none", borderRadius: 9, padding: "11px 18px", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Space Mono',monospace", opacity: aiLoading ? 0.5 : 1 }}>
                          {aiLoading ? "Thinking…" : "🤖 Generate Plan"}
                        </button>
                      </div>
                      {aiLoading && <Spinner label="Gemini is building your plan…" />}
                      {!aiPlan && !aiLoading && (
                        <div style={{ textAlign: "center", padding: "32px 0", color: C.muted, fontSize: 12 }}>
                          Click "Generate Plan" to get your coaching analysis
                        </div>
                      )}
                      {aiPlan && (
                        <div style={{ background: C.surface, borderRadius: 10, padding: "18px 22px", borderLeft: `3px solid ${C.accent}`, fontSize: 13, lineHeight: 1.85 }}>
                          <style>{`
                            .day{padding:10px 0;border-bottom:1px solid ${C.border}}.day:last-child{border-bottom:none}
                            .day-label{color:${C.accent};font-family:'Space Mono',monospace;font-size:11px;letter-spacing:1px}
                            .day strong{color:${C.text};font-size:13px}
                            .day ul{margin:6px 0 0 16px}.day ul li{color:${C.muted};font-size:12px;font-family:'Space Mono',monospace;margin-bottom:2px}
                          `}</style>
                          <div dangerouslySetInnerHTML={{ __html: aiPlan }} />
                        </div>
                      )}
                    </div>

                    {/* Weakness snapshot */}
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>📉 Weakness Snapshot</div>
                      {mlData && <div style={{ fontSize: 10, color: C.accent, fontFamily: "'Space Mono',monospace", marginBottom: 14 }}>✦ ML peer-benchmarked scores</div>}
                      {(mlData
                        ? mlTagsSorted.filter(([, v]) => v.strength < 70).slice(0, 6).map(([tag, v]) => ({
                            tag: tag.replace("tag_", "").replace(/_/g, " "),
                            solved: v.solved ?? 0,
                            failed: (v.attempted ?? 0) - (v.solved ?? 0),
                            strength: Math.round(v.strength),
                          }))
                        : tagData.filter(t => t.accuracy < 70).slice(0, 6).map(t => ({
                            tag: t.tag, solved: t.solved, failed: t.failed, strength: t.accuracy,
                          }))
                      ).map((t, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
                          <div>
                            <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 12, textTransform: "capitalize" }}>{t.tag}</span>
                            <span style={{ fontSize: 10, color: C.muted, marginLeft: 10 }}>{t.solved}✓ {t.failed}✗</span>
                          </div>
                          <div style={{ background: `${C.danger}18`, color: C.danger, padding: "3px 9px", borderRadius: 5, fontSize: 10, fontFamily: "'Space Mono',monospace" }}>
                            {t.strength}%
                          </div>
                        </div>
                      ))}
                      {(mlData ? mlTagsSorted.filter(([, v]) => v.strength < 70).length === 0 : tagData.filter(t => t.accuracy < 70).length === 0) && (
                        <div style={{ color: C.success, fontSize: 13 }}>🎉 No significant weaknesses detected — great work!</div>
                      )}
                    </div>
                  </>
                )}

              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {phase === "idle" && (
          <div style={{ textAlign: "center", padding: "64px 0", color: C.muted }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🏆</div>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 13, marginBottom: 6 }}>Enter a Codeforces handle above</div>
            <div style={{ fontSize: 12 }}>Try: <span style={{ color: C.accent }}>tourist</span> · <span style={{ color: C.accent }}>Petr</span> · <span style={{ color: C.accent }}>o.khalifa</span></div>
            <div style={{ marginTop: 20, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, color: C.muted, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 16px" }}>
              <span style={{ color: C.success }}>✓</span> CF data + KNN model run in parallel on analyze
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
