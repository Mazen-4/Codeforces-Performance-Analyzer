import { useState, useEffect } from "react";
import { m } from "framer-motion";
import { Link } from "react-router-dom";
import { T, font } from "../lib/theme.js";
import { api } from "../lib/api.js";
import { Button, Card, Badge } from "../components/ui.jsx";
import DiscountClaim from "../components/DiscountClaim.jsx";
import Aurora from "../components/Aurora.jsx";

const PLUS_PRICE = 399;          // EGP per month

export default function Landing() {
  // Real number from the deployed model, so the page never overstates itself.
  const [trainingUsers, setTrainingUsers] = useState(null);
  useEffect(() => {
    let alive = true;
    api.mlVersion?.()
      .then((v) => { if (alive && v?.training_users) setTrainingUsers(v.training_users); })
      .catch(() => { /* the page reads fine without it */ });
    return () => { alive = false; };
  }, []);

  return (
    <div>
      <Hero trainingUsers={trainingUsers} />
      <HowItWorks />
      <Features />
      <WeeklyModel trainingUsers={trainingUsers} />
      <Pricing />
      <FinalCta />
    </div>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────────── */

function Hero({ trainingUsers }) {
  return (
    <section style={{
      position: "relative", overflow: "hidden",
      padding: "clamp(72px, 12vw, 128px) 24px clamp(64px, 9vw, 104px)",
      textAlign: "center",
    }}>
      <Aurora />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 880, margin: "0 auto" }}>
        <m.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 9,
            padding: "6px 14px", borderRadius: 999, marginBottom: 26,
            background: T.surface, border: `1px solid ${T.border}`,
            fontSize: 12.5, color: T.textDim,
          }}
        >
          <Pulse />
          Model retrained every week
        </m.div>

        <m.h1
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.06 }}
          style={{
            fontSize: "clamp(34px, 6.2vw, 62px)", fontWeight: 800,
            letterSpacing: -1.8, lineHeight: 1.06, margin: "0 0 20px",
          }}
        >
          Stop guessing what to
          <br />
          practise next.
        </m.h1>

        <m.p
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.13 }}
          style={{
            fontSize: "clamp(16px, 2.1vw, 19px)", color: T.textDim,
            lineHeight: 1.65, maxWidth: 620, margin: "0 auto 34px",
          }}
        >
          We read your Codeforces history, score all 20 topics against
          competitors who solve like you, and hand you the problems that move
          your rating fastest.
        </m.p>

        <m.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          style={{ display: "flex", gap: 12, justifyContent: "center",
                   flexWrap: "wrap", marginBottom: 18 }}
        >
          <Link to="/signup" style={{ textDecoration: "none" }}>
            <Button size="lg">Analyse my profile — free</Button>
          </Link>
          <Link to="/login" style={{ textDecoration: "none" }}>
            <Button size="lg" variant="ghost">Sign in</Button>
          </Link>
        </m.div>

        <m.p
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 0.32 }}
          style={{ fontSize: 13, color: T.textFaint, margin: 0 }}
        >
          Free forever. No card needed. Just your handle.
        </m.p>

        <m.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4 }}
          style={{ marginTop: 56 }}
        >
          <HeroPreview trainingUsers={trainingUsers} />
        </m.div>
      </div>
    </section>
  );
}

/** A small, honest mock of the real result view. */
function HeroPreview({ trainingUsers }) {
  const rows = [
    { name: "Implementation", score: 89, tone: T.good },
    { name: "Greedy",         score: 74, tone: T.cyan },
    { name: "Dynamic Programming", score: 41, tone: T.warn },
    { name: "Graphs",         score: 28, tone: T.risk },
  ];
  return (
    <Card style={{ maxWidth: 680, margin: "0 auto", textAlign: "left",
                   padding: 22, boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
      <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "baseline", marginBottom: 18, gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 0.7, color: T.textFaint,
                        textTransform: "uppercase", marginBottom: 5 }}>
            Your focus right now
          </div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>
            Graphs is where you have the most to gain.
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: T.warn,
                        fontFamily: font.mono, lineHeight: 1 }}>58</div>
          <div style={{ fontSize: 11, color: T.textFaint, marginTop: 4 }}>Overall</div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 11 }}>
        {rows.map((r, i) => (
          <div key={r.name} style={{ display: "grid",
                gridTemplateColumns: "minmax(120px,1fr) 2fr 34px",
                alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 550 }}>{r.name}</span>
            <div style={{ height: 5, background: T.bgAlt, borderRadius: 999 }}>
              <m.div
                initial={{ scaleX: 0 }} animate={{ scaleX: r.score / 100 }}
                transition={{ duration: 0.9, delay: 0.55 + i * 0.1,
                              ease: [0.22, 1, 0.36, 1] }}
                style={{ height: "100%", width: "100%", borderRadius: 999,
                         background: r.tone, transformOrigin: "left center" }}
              />
            </div>
            <span style={{ fontFamily: font.mono, fontSize: 12,
                           color: r.tone, fontWeight: 700, textAlign: "right" }}>
              {r.score}
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, paddingTop: 15,
                    borderTop: `1px solid ${T.border}`,
                    fontSize: 12, color: T.textFaint }}>
        Benchmarked against{" "}
        <strong style={{ color: T.textDim, fontFamily: font.mono }}>
          {trainingUsers ? trainingUsers.toLocaleString() : "28,000+"}
        </strong>{" "}
        rated competitors
      </div>
    </Card>
  );
}

/* ── How it works ────────────────────────────────────────────────────────── */

function HowItWorks() {
  const steps = [
    { n: "01", title: "Link your handle",
      body: "One field. We pull your full public submission history from Codeforces — every attempt, not just the wins." },
    { n: "02", title: "We find your real peers",
      body: "A nearest-neighbour model matches you to competitors with a genuinely similar solving profile: comparable volume, comparable rating." },
    { n: "03", title: "You get a plan",
      body: "Every topic scored against those peers, the gaps ranked by what they cost you, and specific problems to open next." },
  ];
  return (
    <Section>
      <SectionHead
        eyebrow="How it works"
        title="Three steps, about thirty seconds"
      />
      <div style={{ display: "grid", gap: 18,
                    gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))" }}>
        {steps.map((s, i) => (
          <Reveal key={s.n} delay={i * 0.08}>
            <Card style={{ height: "100%", padding: 24 }}>
              <div style={{ fontFamily: font.mono, fontSize: 12.5,
                            color: T.accent, fontWeight: 700, marginBottom: 14 }}>
                {s.n}
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 9px" }}>
                {s.title}
              </h3>
              <p style={{ color: T.textDim, fontSize: 14, lineHeight: 1.65, margin: 0 }}>
                {s.body}
              </p>
            </Card>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ── Features ────────────────────────────────────────────────────────────── */

function Features() {
  const items = [
    { title: "Every topic, scored against your peers",
      body: "All 20 Codeforces topics on a 0–100 scale. Not an absolute grade — a comparison against people who solve at your level, so the number means something.",
      wide: true },
    { title: "Problems chosen, not listed",
      body: "Ranked by what they actually teach you, labelled Warm-up, Stretch or Reach relative to your rating." },
    { title: "See your ten closest peers",
      body: "The competitors you were measured against, with similarity and solve counts. Your scores stop being a black box." },
    { title: "Track progress between runs",
      body: "Compare any two analyses side by side and see exactly which topics moved, and by how much." },
    { title: "Sort and filter your practice",
      body: "Build a session around one topic or a rating band, instead of scrolling a fixed list." },
  ];
  return (
    <Section alt>
      <SectionHead
        eyebrow="What you get"
        title="Built to answer one question"
        sub="What should I solve next, and why that?"
      />
      <div style={{ display: "grid", gap: 16,
                    gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))" }}>
        {items.map((f, i) => (
          <Reveal key={f.title} delay={i * 0.06}
                  style={f.wide ? { gridColumn: "1 / -1" } : undefined}>
            <Card style={{ height: "100%", padding: 24 }} hover>
              <h3 style={{ fontSize: f.wide ? 20 : 16.5, fontWeight: 700,
                           margin: "0 0 10px", letterSpacing: -0.3 }}>
                {f.title}
              </h3>
              <p style={{ color: T.textDim, fontSize: 14.5, lineHeight: 1.68,
                          margin: 0, maxWidth: f.wide ? 620 : undefined }}>
                {f.body}
              </p>
            </Card>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ── Weekly model ────────────────────────────────────────────────────────── */

function WeeklyModel({ trainingUsers }) {
  return (
    <Section>
      <Card style={{ padding: "clamp(28px, 5vw, 48px)" }}>
        <div style={{ display: "grid", gap: 34, alignItems: "center",
                      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 9,
                          marginBottom: 18 }}>
              <Pulse />
              <span style={{ fontSize: 12, letterSpacing: 0.7, color: T.textDim,
                             textTransform: "uppercase" }}>
                Retrained weekly
              </span>
            </div>
            <h2 style={{ fontSize: "clamp(23px, 3.4vw, 32px)", fontWeight: 760,
                         letterSpacing: -0.9, margin: "0 0 14px", lineHeight: 1.2 }}>
              The model does not go stale
            </h2>
            <p style={{ color: T.textDim, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              Every Sunday the pipeline pulls fresh submissions, rebuilds the
              peer dataset and retrains. New problems, shifting difficulty and
              changing metas are reflected within the week — your scores track
              the Codeforces of now, not of last year.
            </p>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <MetricRow value={trainingUsers ? trainingUsers.toLocaleString() : "28,492"}
                       label="rated competitors in the model" />
            <MetricRow value="20" label="topics scored on every run" />
            <MetricRow value="Weekly" label="full retrain, every Sunday" />
          </div>
        </div>
      </Card>
    </Section>
  );
}

function MetricRow({ value, label }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 14,
                  padding: "14px 18px", borderRadius: T.radiusSm,
                  background: T.bgAlt, border: `1px solid ${T.border}` }}>
      <span style={{ fontFamily: font.mono, fontSize: 21, fontWeight: 800,
                     color: T.accent, minWidth: 92 }}>
        {value}
      </span>
      <span style={{ fontSize: 13.5, color: T.textDim }}>{label}</span>
    </div>
  );
}

/* ── Pricing ─────────────────────────────────────────────────────────────── */

const FREE = [
  { t: "One analysis per week" },
  { t: "Up to 12 recommended problems" },
  { t: "All 20 topics scored" },
  { t: "Analyse another handle once every 3 months" },
  { t: "Problem sorting and filtering", no: true },
  { t: "See your closest peers", no: true },
  { t: "AI-Coach free trial", soon: true },
];

const PLUS = [
  { t: "One analysis every 3 days" },
  { t: "Up to 50 recommended problems, matched to your results" },
  { t: "Sort and filter by topic and rating" },
  { t: "See your ten closest peers" },
  { t: "Analyse another handle once a week" },
  { t: "Compare any two runs side by side" },
  { t: "AI-Coach early access", soon: true },
];

function Pricing() {
  return (
    <Section alt id="pricing">
      <SectionHead
        eyebrow="Pricing"
        title="Start free. Upgrade when you outgrow it."
        sub="No card required to begin."
      />
      <div style={{ display: "grid", gap: 20, alignItems: "start",
                    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                    maxWidth: 860, margin: "0 auto 26px" }}>
        <Reveal>
          <PlanCard
            name="Free"
            price="0"
            period="forever"
            blurb="Everything you need to find your weakest topic and start fixing it."
            features={FREE}
            cta="Create a free account"
            to="/signup"
          />
        </Reveal>
        <Reveal delay={0.08}>
          <PlanCard
            name="Plus"
            price={PLUS_PRICE}
            period="EGP / month"
            blurb="For anyone practising seriously and pushing for the next rating band."
            features={PLUS}
            cta="Get Plus"
            to="/signup"
            highlight
          />
        </Reveal>
      </div>

      <Reveal delay={0.14}>
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
          <DiscountClaim />
        </div>
      </Reveal>
    </Section>
  );
}

function PlanCard({ name, price, period, blurb, features, cta, to, highlight }) {
  return (
    <Card style={{
      height: "100%", padding: 28, position: "relative",
      border: `1px solid ${highlight ? T.accent + "66" : T.border}`,
      background: highlight
        ? `linear-gradient(180deg, ${T.accent}0a, transparent 40%), ${T.surface}`
        : T.surface,
    }}>
      {highlight && (
        <Badge color={T.accent} style={{ position: "absolute", top: 20, right: 20 }}>
          Most popular
        </Badge>
      )}
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.4,
                    textTransform: "uppercase", color: highlight ? T.accent : T.textDim,
                    marginBottom: 14 }}>
        {name}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 42, fontWeight: 820, letterSpacing: -1.6,
                       fontFamily: font.mono, lineHeight: 1 }}>
          {price}
        </span>
        <span style={{ fontSize: 13.5, color: T.textFaint }}>{period}</span>
      </div>
      <p style={{ color: T.textDim, fontSize: 14, lineHeight: 1.6,
                  margin: "0 0 22px", minHeight: 44 }}>
        {blurb}
      </p>

      <Link to={to} style={{ textDecoration: "none", display: "block" }}>
        <Button variant={highlight ? "primary" : "subtle"} style={{ width: "100%" }}>
          {cta}
        </Button>
      </Link>

      <div style={{ display: "grid", gap: 11, marginTop: 24 }}>
        {features.map((f) => (
          <div key={f.t} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Mark no={f.no} soon={f.soon} />
            <span style={{
              fontSize: 13.5, lineHeight: 1.5,
              color: f.no ? T.textFaint : T.textDim,
              textDecoration: f.no ? "line-through" : "none",
            }}>
              {f.t}
              {f.soon && (
                <span style={{
                  marginLeft: 7, fontSize: 10.5, fontWeight: 600,
                  padding: "1px 6px", borderRadius: 999, color: T.violet,
                  background: `${T.violet}1a`, border: `1px solid ${T.violet}44`,
                  textTransform: "uppercase", letterSpacing: 0.3,
                  whiteSpace: "nowrap",
                }}>
                  coming soon
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Mark({ no, soon }) {
  const color = no ? T.textFaint : soon ? T.violet : T.good;
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color}
         strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
         style={{ flexShrink: 0, marginTop: 2 }} aria-hidden>
      {no ? <path d="M18 6L6 18M6 6l12 12" />
          : soon ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>
                 : <path d="M20 6L9 17l-5-5" />}
    </svg>
  );
}

/* ── Final CTA ───────────────────────────────────────────────────────────── */

function FinalCta() {
  return (
    <section style={{ position: "relative", overflow: "hidden",
                      padding: "clamp(70px, 10vw, 110px) 24px", textAlign: "center" }}>
      <Aurora intensity={1.2} />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 620, margin: "0 auto" }}>
        <h2 style={{ fontSize: "clamp(26px, 4.4vw, 40px)", fontWeight: 790,
                     letterSpacing: -1.2, margin: "0 0 16px", lineHeight: 1.15 }}>
          Find your weakest topic in thirty seconds
        </h2>
        <p style={{ color: T.textDim, fontSize: 16, lineHeight: 1.65,
                    margin: "0 0 30px" }}>
          Enter your handle and see where your rating is actually stuck.
        </p>
        <Link to="/signup" style={{ textDecoration: "none" }}>
          <Button size="lg">Analyse my profile — free</Button>
        </Link>
      </div>
    </section>
  );
}

/* ── Shared bits ─────────────────────────────────────────────────────────── */

function Section({ children, alt, id }) {
  return (
    <section id={id} style={{
      padding: "clamp(56px, 8vw, 92px) 24px",
      background: alt ? T.bgAlt : "transparent",
      borderTop: alt ? `1px solid ${T.border}` : "none",
      borderBottom: alt ? `1px solid ${T.border}` : "none",
    }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>{children}</div>
    </section>
  );
}

function SectionHead({ eyebrow, title, sub }) {
  return (
    <Reveal>
      <div style={{ marginBottom: 38, maxWidth: 640 }}>
        <div style={{ fontSize: 12, letterSpacing: 0.9, color: T.accent,
                      textTransform: "uppercase", fontWeight: 650, marginBottom: 12 }}>
          {eyebrow}
        </div>
        <h2 style={{ fontSize: "clamp(24px, 3.6vw, 34px)", fontWeight: 770,
                     letterSpacing: -1, margin: 0, lineHeight: 1.18 }}>
          {title}
        </h2>
        {sub && (
          <p style={{ color: T.textDim, fontSize: 15.5, lineHeight: 1.65,
                      margin: "12px 0 0" }}>
            {sub}
          </p>
        )}
      </div>
    </Reveal>
  );
}

function Reveal({ children, delay = 0, style }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay }}
      style={style}
    >
      {children}
    </m.div>
  );
}

function Pulse() {
  return (
    <span style={{ position: "relative", display: "inline-flex",
                   width: 7, height: 7, flexShrink: 0 }}>
      <m.span
        animate={{ scale: [1, 2.1, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
        style={{ position: "absolute", inset: 0, borderRadius: 999,
                 background: T.good }}
      />
      <span style={{ position: "relative", width: 7, height: 7,
                     borderRadius: 999, background: T.good }} />
    </span>
  );
}
