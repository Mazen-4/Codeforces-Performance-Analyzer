import { useState, useEffect, useMemo } from "react";
import { m, AnimatePresence } from "framer-motion";
import { T, font } from "../lib/theme.js";
import { api } from "../lib/api.js";
import { Button, Input } from "./ui.jsx";
import Icon from "./Icon.jsx";

const PLUS_PRICE = 399;

/* Redemption, in three states: enter a code, validating, claimed.
 *
 * The claimed state is deliberately a moment — confetti, the percentage as the
 * hero, the old price struck through, and how few claims are left. Reference
 * patterns: Higgsfield's dark celebratory modal and Uxcel's struck-through
 * price; the scarcity line follows DoorDash's "you're saving" framing. */
export default function DiscountClaim({ onClaimed }) {
  const [code, setCode] = useState("");
  const [state, setState] = useState("idle");   // idle | checking | claimed | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function claim(e) {
    e?.preventDefault();
    const c = code.trim();
    if (!c || state === "checking") return;
    setState("checking"); setError("");
    // A beat of "checking" reads as real verification rather than a lookup
    // that was already done; it also gives the reveal something to land after.
    const started = Date.now();
    try {
      const r = await api.redeemDiscount(c);
      const elapsed = Date.now() - started;
      if (elapsed < 900) await new Promise((res) => setTimeout(res, 900 - elapsed));
      setResult(r); setState("claimed");
      onClaimed?.(r);
    } catch (err) {
      const elapsed = Date.now() - started;
      if (elapsed < 600) await new Promise((res) => setTimeout(res, 600 - elapsed));
      setError(err.message || "Could not claim that code.");
      setState("error");
    }
  }

  if (state === "claimed" && result) {
    return <Claimed result={result} />;
  }

  return (
    <form onSubmit={claim} style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
        <Input
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setState("idle"); setError(""); }}
          placeholder="Discount code"
          aria-label="Discount code"
          invalid={state === "error"}
          disabled={state === "checking"}
          style={{ flex: 1, minWidth: 180, fontFamily: font.mono,
                   letterSpacing: 1.2, textTransform: "uppercase" }}
        />
        <Button type="submit" loading={state === "checking"}
                disabled={!code.trim() || state === "checking"}>
          {state === "checking" ? "Checking" : "Apply"}
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {state === "checking" && (
          <m.div
            key="checking"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ fontSize: 12.5, color: T.textFaint }}
          >
            Checking your code…
          </m.div>
        )}
        {state === "error" && error && (
          <m.div
            key="error"
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{ fontSize: 12.5, color: T.risk }}
          >
            {error}
          </m.div>
        )}
      </AnimatePresence>
    </form>
  );
}

function Claimed({ result }) {
  const { percent_off: pct, remaining, max_uses: maxUses, expires_at: expiresAt } = result;
  const newPrice = Math.round(PLUS_PRICE * (1 - pct / 100));
  const saving = PLUS_PRICE - newPrice;

  return (
    <div style={{ position: "relative" }}>
      <Confetti />
      <m.div
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 20 }}
        style={{
          position: "relative", zIndex: 1, overflow: "hidden",
          padding: "26px 24px", borderRadius: T.radius, textAlign: "center",
          background: `linear-gradient(160deg, ${T.accent}18, ${T.violet}12 55%, transparent)`,
          border: `1px solid ${T.accent}55`,
        }}
      >
        <Sheen />

        <m.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 14,
            padding: "5px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 650,
            letterSpacing: 0.5, textTransform: "uppercase", color: T.good,
            background: `${T.good}14`, border: `1px solid ${T.good}44`,
          }}
        >
          <Icon name="check" size={12} strokeWidth={3} /> Code applied
        </m.div>

        <m.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.18 }}
          style={{
            fontSize: "clamp(44px, 9vw, 66px)", fontWeight: 850, lineHeight: 1,
            letterSpacing: -2.5, fontFamily: font.mono,
            background: `linear-gradient(120deg, ${T.accent}, ${T.violet})`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {pct}% off
        </m.div>

        <m.p
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 0.34 }}
          style={{ fontSize: 14.5, color: T.text, margin: "14px 0 4px", fontWeight: 600 }}
        >
          You just saved {saving} EGP a month.
        </m.p>

        <m.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 0.42 }}
          style={{ display: "flex", alignItems: "baseline", gap: 10,
                   justifyContent: "center", marginTop: 12 }}
        >
          <span style={{ fontFamily: font.mono, fontSize: 17, color: T.textFaint,
                         textDecoration: "line-through" }}>
            {PLUS_PRICE}
          </span>
          <span style={{ fontFamily: font.mono, fontSize: 30, fontWeight: 820,
                         color: T.text, letterSpacing: -1 }}>
            {newPrice}
          </span>
          <span style={{ fontSize: 13, color: T.textDim }}>EGP / month</span>
        </m.div>

        <m.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 0.52 }}
          style={{ marginTop: 20, paddingTop: 16,
                   borderTop: `1px solid ${T.border}`,
                   display: "flex", gap: 18, justifyContent: "center",
                   flexWrap: "wrap", fontSize: 12.5, color: T.textDim }}
        >
          <Scarcity remaining={remaining} maxUses={maxUses} />
          <Countdown expiresAt={expiresAt} />
        </m.div>
      </m.div>
    </div>
  );
}

function Scarcity({ remaining, maxUses }) {
  if (remaining == null) return null;
  const claimed = maxUses - remaining;
  const tight = remaining <= Math.max(3, maxUses * 0.2);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span style={{ width: 6, height: 6, borderRadius: 999,
                     background: tight ? T.warn : T.good }} />
      {remaining === 0
        ? `You took the last one of ${maxUses}`
        : <>You were <strong style={{ color: T.text }}>#{claimed}</strong> of {maxUses}
           {tight && <> · only {remaining} left</>}</>}
    </span>
  );
}

function Countdown({ expiresAt }) {
  const target = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [left, setLeft] = useState(null);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, target - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [target]);
  if (!Number.isFinite(target) || left === null) return null;

  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const m2 = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <Icon name="clock" size={12} />
      <span style={{ fontFamily: font.mono }}>
        {d > 0 ? `${d}d ${h}h left` : `${String(h).padStart(2,"0")}:${String(m2).padStart(2,"0")}:${String(s).padStart(2,"0")} left`}
      </span>
    </span>
  );
}

/** Lightweight confetti: transform-only, so it stays cheap on a phone. */
function Confetti() {
  // Built in an effect: Math.random() during render is impure and would give
  // a different burst on every re-render.
  const [bits, setBits] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => setBits(Array.from({ length: 22 }, (_, i) => ({
      id: i,
      x: (Math.random() - 0.5) * 300,
      y: -60 - Math.random() * 140,
      rot: (Math.random() - 0.5) * 520,
      delay: Math.random() * 0.2,
      color: [T.accent, T.violet, T.good, T.cyan, T.warn][i % 5],
      size: 5 + Math.random() * 5,
    }))), 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div aria-hidden style={{
      position: "absolute", inset: 0, overflow: "hidden",
      pointerEvents: "none", zIndex: 2,
    }}>
      {bits.map((b) => (
        <m.span
          key={b.id}
          initial={{ opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }}
          animate={{ opacity: [1, 1, 0], x: b.x, y: b.y, rotate: b.rot, scale: 0.7 }}
          transition={{ duration: 1.5, delay: b.delay, ease: [0.16, 0.8, 0.4, 1] }}
          style={{
            position: "absolute", left: "50%", top: "42%",
            width: b.size, height: b.size * 0.5,
            borderRadius: 1.5, background: b.color,
          }}
        />
      ))}
    </div>
  );
}

/** A single light sweep across the panel as it lands. */
function Sheen() {
  return (
    <m.div
      aria-hidden
      initial={{ x: "-120%" }}
      animate={{ x: "160%" }}
      transition={{ duration: 1.1, delay: 0.3, ease: "easeOut" }}
      style={{
        position: "absolute", top: 0, bottom: 0, width: "45%",
        background: `linear-gradient(100deg, transparent, ${T.text}0f, transparent)`,
        pointerEvents: "none",
      }}
    />
  );
}


