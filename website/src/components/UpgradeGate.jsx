import { useState, useEffect } from "react";
import { m, AnimatePresence } from "framer-motion";
import { T, font } from "../lib/theme.js";
import { Button, Badge } from "./ui.jsx";
import Icon from "./Icon.jsx";

const PLUS_PRICE = 399;
const SEEN_KEY = "cf_upgrade_seen_at";
const EVERY_MS = 7 * 24 * 60 * 60 * 1000;   // at most once a week

/* What Free actually gets versus Plus, per capability. The unlock percentage
 * is computed from these rows rather than picked: it is the share of the
 * capability total that Free does not have, so the number is defensible and
 * changes automatically if the tiers change. */
const CAPABILITIES = [
  { icon: "bolt",     label: "Analyses per month",   free: 4,  plus: 10 },
  { icon: "target",   label: "Recommended problems", free: 12, plus: 50 },
  { icon: "users",    label: "Peer view",            free: 0,  plus: 10, unit: "peers" },
  { icon: "filter",   label: "Sorting and filtering", free: 0, plus: 1, boolean: true },
  { icon: "search",   label: "Other handles a year", free: 4,  plus: 52 },
];

function unlockPercent() {
  const freeTotal = CAPABILITIES.reduce((s, c) => s + c.free, 0);
  const plusTotal = CAPABILITIES.reduce((s, c) => s + c.plus, 0);
  return Math.round(((plusTotal - freeTotal) / plusTotal) * 100);
}

/** Should a free user see this now? Weekly at most, never for Plus. */
export function shouldShowUpgrade(user) {
  if (!user || user.plan === "pro") return false;
  try {
    const last = Number(localStorage.getItem(SEEN_KEY) || 0);
    return !Number.isFinite(last) || Date.now() - last > EVERY_MS;
  } catch {
    return true;   // private mode: showing once is better than never
  }
}

export function markUpgradeSeen() {
  try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* ignore */ }
}

export default function UpgradeGate({ open, onClose, onUpgrade }) {
  const pct = unlockPercent();
  const [shown, setShown] = useState(0);

  // Count the headline percentage up once the panel is on screen.
  useEffect(() => {
    if (!open) return;
    let raf, start;
    const tick = (t) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / 1200);
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setShown(Math.round(pct * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, pct]);

  function close() { markUpgradeSeen(); onClose?.(); }

  return (
    <AnimatePresence>
      {open && (
        <m.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={close}
          style={{
            position: "fixed", inset: 0, zIndex: 200, display: "grid",
            placeItems: "center", padding: 20, overflowY: "auto",
            background: "rgba(3,4,6,.82)", backdropFilter: "blur(8px)",
          }}
        >
          <m.div
            initial={{ opacity: 0, y: 22, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 210, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 560, position: "relative",
              borderRadius: T.radius, overflow: "hidden",
              background: T.surface, border: `1px solid ${T.borderHi}`,
              boxShadow: "0 40px 90px rgba(0,0,0,.65)",
            }}
          >
            <Glow />

            <div style={{ position: "relative", padding: "30px 30px 26px",
                          textAlign: "center" }}>
              <Badge color={T.violet}>Plus</Badge>

              <div style={{ margin: "20px 0 6px" }}>
                <m.div
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 240, damping: 17, delay: 0.1 }}
                  style={{
                    fontSize: "clamp(52px, 12vw, 76px)", fontWeight: 850,
                    lineHeight: 1, letterSpacing: -3, fontFamily: font.mono,
                    background: `linear-gradient(120deg, ${T.accent}, ${T.violet})`,
                    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  {shown}%
                </m.div>
              </div>

              <h2 style={{ fontSize: 19, fontWeight: 760, margin: "0 0 8px",
                           letterSpacing: -0.5 }}>
                of the analyzer is still locked
              </h2>
              <p style={{ color: T.textDim, fontSize: 14, lineHeight: 1.6,
                          margin: "0 auto", maxWidth: 380 }}>
                You are using the free tier. Here is what Plus adds.
              </p>

              <div style={{ display: "grid", gap: 9, margin: "24px 0 22px",
                            textAlign: "left" }}>
                {CAPABILITIES.map((c, i) => (
                  <Row key={c.label} c={c} i={i} />
                ))}
              </div>

              <Button size="lg" style={{ width: "100%" }} onClick={() => { markUpgradeSeen(); onUpgrade?.(); }}>
                Unlock everything — {PLUS_PRICE} EGP / month
              </Button>

              <button
                onClick={close}
                style={{
                  display: "block", width: "100%", marginTop: 14,
                  background: "transparent", border: "none", cursor: "pointer",
                  fontFamily: font.sans, fontSize: 12.5, lineHeight: 1.6,
                  color: T.textFaint, padding: "4px 0",
                }}
              >
                Continue with 12 of 50 problems, no peer view and no filters
              </button>
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

function Row({ c, i }) {
  const locked = c.free === 0;
  return (
    <m.div
      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.22 + i * 0.06, duration: 0.35 }}
      style={{
        display: "grid", gridTemplateColumns: "28px 1fr auto",
        alignItems: "center", gap: 12, padding: "11px 13px",
        borderRadius: T.radiusSm, background: T.bgAlt,
        border: `1px solid ${T.border}`,
      }}
    >
      <span style={{ color: locked ? T.textFaint : T.accent }}>
        <Icon name={c.icon} size={16} />
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 550 }}>{c.label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8,
                     fontFamily: font.mono, fontSize: 12.5 }}>
        <span style={{ color: T.textFaint }}>
          {c.boolean ? "—" : c.free}
        </span>
        <Icon name="arrowRight" size={11} color={T.textFaint} />
        <span style={{ color: T.good, fontWeight: 700 }}>
          {c.boolean ? "Yes" : c.plus}
        </span>
      </span>
    </m.div>
  );
}

/** A soft accent glow behind the percentage. */
function Glow() {
  return (
    <div aria-hidden style={{
      position: "absolute", top: -110, left: "50%", transform: "translateX(-50%)",
      width: 340, height: 260, pointerEvents: "none",
      background: `radial-gradient(circle, ${T.accent}2e 0%, transparent 68%)`,
      filter: "blur(36px)",
    }} />
  );
}
