import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis,
  Radar, Tooltip as RTooltip,
} from "recharts";
import { T, band, font } from "../lib/theme.js";
import { tagInfo, METRICS, weakestHeadline } from "../lib/copy.js";
import { Card, Badge, Info, fadeUp } from "./ui.jsx";

/* Normalize whatever the pipeline returns into a flat [{key,name,score}] list.
   The backend has carried a few shapes over time, so be forgiving here. */
function useTags(data) {
  return useMemo(() => {
    const raw = data?.tag_strengths || {};
    const rows = Object.entries(raw).map(([key, v]) => {
      let score = typeof v === "number" ? v : (v?.user_strength ?? v?.score ?? 0);
      if (score <= 1.0001) score *= 100;           // some paths emit 0–1
      return { key, ...tagInfo(key), score: Math.max(0, Math.min(100, score)) };
    });
    return rows.sort((a, b) => a.score - b.score);
  }, [data]);
}

export default function Results({ data, handle }) {
  const tags = useTags(data);
  if (!tags.length) return null;

  const weakest = tags.slice(0, 4);
  const strongest = [...tags].reverse().slice(0, 3);
  const avg = tags.reduce((s, t) => s + t.score, 0) / tags.length;

  const problems = (data?.recommended_problems || []).slice(0, 12);

  return (
    <div style={{ display: "grid", gap: 22 }}>
      <Headline handle={handle} weakest={weakest[0]} avg={avg} />

      <div style={{
        display: "grid", gap: 22,
        gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
      }}>
        <FocusList tags={weakest} />
        <ShapeCard tags={tags} />
      </div>

      <StrengthsRow tags={strongest} />
      <AllTopics tags={tags} />
      {problems.length > 0 && <Problems problems={problems} />}
    </div>
  );
}

function Headline({ handle, weakest, avg }) {
  const b = band(avg);
  return (
    <Card style={{ padding: 28 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20,
                    alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ minWidth: 260, flex: 1 }}>
          <div style={{ fontSize: 12, color: T.textFaint, letterSpacing: 1,
                        textTransform: "uppercase", marginBottom: 8,
                        display: "flex", gap: 8, alignItems: "center" }}>
            Your focus right now
            {handle && (
              <span style={{ color: T.textDim, letterSpacing: 0,
                             textTransform: "none", fontFamily: font.mono }}>
                · {handle}
              </span>
            )}
          </div>
          <h2 style={{ fontSize: 26, lineHeight: 1.25, margin: 0,
                       fontWeight: 700, letterSpacing: -0.4 }}>
            {weakest ? weakestHeadline(weakest.key) : "Your profile looks balanced."}
          </h2>
          <p style={{ color: T.textDim, fontSize: 14.5, lineHeight: 1.65,
                      margin: "12px 0 0", maxWidth: 560 }}>
            {weakest?.why || "Keep pushing difficulty in the topics you already enjoy."}
          </p>
        </div>
        <div style={{ textAlign: "center", minWidth: 130 }}>
          <div style={{
            fontSize: 52, fontWeight: 800, color: b.color,
            fontFamily: font.mono, lineHeight: 1, letterSpacing: -2,
          }}>
            {Math.round(avg)}
          </div>
          <div style={{ fontSize: 12, color: T.textDim, marginTop: 8,
                        display: "flex", gap: 6, justifyContent: "center",
                        alignItems: "center" }}>
            Overall · {b.label}
            <Info text={METRICS.score.long} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function FocusList({ tags }) {
  return (
    <Card>
      <CardTitle
        title="Where to spend your next sessions"
        info={METRICS.score.long}
      />
      <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
        {tags.map((t, i) => {
          const b = band(t.score);
          return (
            <motion.div
              key={t.key} custom={i} variants={fadeUp}
              initial="hidden" animate="visible"
            >
              <div style={{ display: "flex", justifyContent: "space-between",
                            alignItems: "baseline", marginBottom: 6, gap: 12 }}>
                <span style={{ fontWeight: 650, fontSize: 15 }}>{t.name}</span>
                <span style={{ fontFamily: font.mono, fontSize: 13,
                               color: b.color, fontWeight: 700 }}>
                  {Math.round(t.score)}
                </span>
              </div>
              <div style={{ height: 7, background: T.bgAlt, borderRadius: 999,
                            overflow: "hidden" }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${t.score}%` }}
                  transition={{ duration: 0.9, delay: 0.1 + i * 0.08,
                                ease: [0.22, 1, 0.36, 1] }}
                  style={{ height: "100%", borderRadius: 999,
                           background: `linear-gradient(90deg, ${b.color}99, ${b.color})` }}
                />
              </div>
              <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 7,
                            lineHeight: 1.5 }}>
                {t.blurb}
              </div>
            </motion.div>
          );
        })}
      </div>
    </Card>
  );
}

function ShapeCard({ tags }) {
  // Show the eight most informative topics so the shape stays readable.
  const shown = useMemo(() => {
    const sorted = [...tags].sort((a, b) => a.score - b.score);
    const picked = [...sorted.slice(0, 5), ...sorted.slice(-3)];
    return picked.map((t) => ({ tag: t.name, score: Math.round(t.score) }));
  }, [tags]);

  return (
    <Card>
      <CardTitle
        title="The shape of your skills"
        info="A quick read on where you are even, and where one topic lags behind the rest. Balanced profiles tend to climb more steadily."
      />
      <div style={{ height: 290, marginTop: 10 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={shown} outerRadius="72%">
            <PolarGrid stroke={T.border} />
            <PolarAngleAxis
              dataKey="tag"
              tick={{ fill: T.textDim, fontSize: 11 }}
            />
            <RTooltip
              contentStyle={{
                background: T.surfaceHi, border: `1px solid ${T.borderHi}`,
                borderRadius: 10, fontSize: 13, color: T.text,
              }}
              formatter={(v) => [`${v} / 100`, "Score"]}
            />
            <Radar
              dataKey="score" stroke={T.accent}
              fill={T.accent} fillOpacity={0.22} strokeWidth={2}
              isAnimationActive animationDuration={900}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function StrengthsRow({ tags }) {
  return (
    <Card>
      <CardTitle
        title="What you are already good at"
        info="Keep these sharp, but they are not where your next rating points come from."
      />
      <div style={{ display: "grid", gap: 12, marginTop: 16,
                    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
        {tags.map((t) => {
          const b = band(t.score);
          return (
            <div key={t.key} style={{
              padding: 16, borderRadius: T.radiusSm,
              background: T.bgAlt, border: `1px solid ${T.border}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                            alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 650, fontSize: 14.5 }}>{t.name}</span>
                <Badge color={b.color}>{Math.round(t.score)}</Badge>
              </div>
              <div style={{ fontSize: 12.5, color: T.textFaint, lineHeight: 1.5 }}>
                {t.blurb}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AllTopics({ tags }) {
  const ordered = [...tags].sort((a, b) => b.score - a.score);
  return (
    <Card>
      <CardTitle
        title="Every topic, scored"
        info={METRICS.score.long}
      />
      <div style={{ display: "grid", gap: 9, marginTop: 16 }}>
        {ordered.map((t, i) => {
          const b = band(t.score);
          return (
            <motion.div
              key={t.key}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.025, 0.5), duration: 0.35 }}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(140px, 1.3fr) 1fr auto",
                alignItems: "center", gap: 14,
                padding: "10px 12px", borderRadius: 9,
                background: i % 2 ? "transparent" : T.bgAlt + "80",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 550 }}>{t.name}</span>
              <div style={{ height: 5, background: T.bgAlt, borderRadius: 999 }}>
                <motion.div
                  initial={{ width: 0 }} animate={{ width: `${t.score}%` }}
                  transition={{ duration: 0.7, delay: 0.15 + Math.min(i * 0.02, 0.4) }}
                  style={{ height: "100%", background: b.color, borderRadius: 999 }}
                />
              </div>
              <span style={{
                fontFamily: font.mono, fontSize: 12.5, color: b.color,
                fontWeight: 700, minWidth: 58, textAlign: "right",
              }}>
                {Math.round(t.score)} · {b.label}
              </span>
            </motion.div>
          );
        })}
      </div>
    </Card>
  );
}

function Problems({ problems }) {
  return (
    <Card>
      <CardTitle
        title="Practise these next"
        info={METRICS.priority.long}
      />
      <div style={{ display: "grid", gap: 10, marginTop: 16,
                    gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))" }}>
        {problems.map((p, i) => {
          const id = p.problem_id || p.id || "";
          const [contest, index] = String(id).split("_");
          const url = contest && index
            ? `https://codeforces.com/problemset/problem/${contest}/${index}`
            : null;
          const rating = p.problem_rating || p.rating;
          const tags = (p.tags || []).map((x) => tagInfo(x).name).filter(Boolean);
          return (
            <motion.a
              key={id || i}
              href={url || undefined}
              target="_blank" rel="noopener noreferrer"
              custom={i} variants={fadeUp} initial="hidden" animate="visible"
              whileHover={{ y: -3, borderColor: T.accent }}
              style={{
                display: "block", padding: 16, borderRadius: T.radiusSm,
                background: T.bgAlt, border: `1px solid ${T.border}`,
                textDecoration: "none", color: "inherit",
                cursor: url ? "pointer" : "default",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between",
                            alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontWeight: 650, fontSize: 14.5 }}>
                  {p.problem_name || p.name || id}
                </span>
                {rating ? <Badge color={T.violet}>{rating}</Badge> : null}
              </div>
              {tags.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {tags.slice(0, 3).map((t) => (
                    <span key={t} style={{
                      fontSize: 11, color: T.textFaint, padding: "2px 7px",
                      border: `1px solid ${T.border}`, borderRadius: 6,
                    }}>{t}</span>
                  ))}
                </div>
              )}
            </motion.a>
          );
        })}
      </div>
    </Card>
  );
}

function CardTitle({ title, info }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <h3 style={{ fontSize: 16.5, fontWeight: 700, margin: 0,
                   letterSpacing: -0.2 }}>{title}</h3>
      {info && <Info text={info} />}
    </div>
  );
}
