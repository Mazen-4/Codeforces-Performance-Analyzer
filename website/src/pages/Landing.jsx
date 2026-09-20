import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { T } from "../lib/theme.js";
import { TAGLINES } from "../lib/copy.js";
import { Button, Card } from "../components/ui.jsx";
import Aurora from "../components/Aurora.jsx";
import Icon from "../components/Icon.jsx";

export default function Landing() {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLine((i) => (i + 1) % TAGLINES.length), 3800);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <section style={{
        position: "relative", padding: "110px 24px 96px",
        overflow: "hidden", textAlign: "center",
      }}>
        <Aurora />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 820, margin: "0 auto" }}>
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "6px 14px", borderRadius: 999, marginBottom: 26,
              border: `1px solid ${T.borderHi}`, background: T.surface + "cc",
              fontSize: 12.5, color: T.textDim, backdropFilter: "blur(8px)",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%",
                           background: T.good, boxShadow: `0 0 8px ${T.good}` }} />
            Built on real Codeforces submission data
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.08 }}
            style={{
              fontSize: "clamp(38px, 6.4vw, 68px)", lineHeight: 1.05,
              fontWeight: 800, letterSpacing: -2.2, margin: 0,
            }}
          >
            Find the topic that is<br />
            <span style={{
              background: `linear-gradient(120deg, ${T.accent}, ${T.violet} 55%, ${T.cyan})`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}>
              holding your rating back
            </span>
          </motion.h1>

          <div style={{ height: 32, marginTop: 20 }}>
            <AnimatePresence mode="wait">
              <motion.p
                key={line}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4 }}
                style={{ fontSize: 17.5, color: T.textDim, margin: 0 }}
              >
                {TAGLINES[line]}
              </motion.p>
            </AnimatePresence>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            style={{ display: "flex", gap: 12, justifyContent: "center",
                     marginTop: 36, flexWrap: "wrap" }}
          >
            <Link to="/signup"><Button size="lg">Analyse my profile</Button></Link>
            <Link to="/login"><Button size="lg" variant="ghost">Sign in</Button></Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            style={{ marginTop: 18, fontSize: 13, color: T.textFaint }}
          >
            Free to use. Takes about a minute.
          </motion.div>
        </div>
      </section>

      <section style={{ padding: "20px 24px 100px", maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "grid", gap: 18,
                      gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))" }}>
          {[
            {
              t: "See the real gap",
              d: "Every topic scored against competitors at your level, so a weakness is obvious instead of suspected.",
              c: T.accent, icon: "target",
            },
            {
              t: "Know what to open next",
              d: "Problems chosen to sit just above your current comfort range, in the topics that matter most.",
              c: T.violet, icon: "compass",
            },
            {
              t: "Watch it move",
              d: "Re-run any time. The picture updates as your submissions do, so progress is something you can see.",
              c: T.cyan, icon: "trend",
            },
          ].map((f, i) => (
            <Card key={f.t} delay={i} hover>
              <div style={{
                width: 40, height: 40, borderRadius: 11, marginBottom: 15,
                background: `linear-gradient(135deg, ${f.c}2e, ${f.c}0d)`,
                border: `1px solid ${f.c}44`,
                display: "grid", placeItems: "center",
              }}>
                <Icon name={f.icon} color={f.c} size={19} />
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 9px" }}>{f.t}</h3>
              <p style={{ color: T.textDim, fontSize: 14, lineHeight: 1.65, margin: 0 }}>
                {f.d}
              </p>
            </Card>
          ))}
        </div>

        <Card style={{ marginTop: 60, textAlign: "center", padding: 44 }}>
          <h2 style={{ fontSize: 28, fontWeight: 750, margin: "0 0 12px",
                       letterSpacing: -0.8 }}>
            Your next rating point is hiding in one topic
          </h2>
          <p style={{ color: T.textDim, fontSize: 15.5, lineHeight: 1.7,
                      maxWidth: 520, margin: "0 auto 26px" }}>
            Most people practise what they already enjoy. Find out what you have
            been avoiding, and turn it into your next gain.
          </p>
          <Link to="/signup"><Button size="lg">Get started free</Button></Link>
        </Card>
      </section>
    </div>
  );
}
