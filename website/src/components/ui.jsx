import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useEffect } from "react";
import { T, font } from "../lib/theme.js";

export const ease = [0.22, 1, 0.36, 1];

export const fadeUp = {
  hidden:  { opacity: 0, y: 16 },
  visible: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.05, duration: 0.5, ease },
  }),
};

export function Button({
  children, variant = "primary", size = "md", loading, style, ...props
}) {
  const sizes = {
    sm: { padding: "8px 14px", fontSize: 13 },
    md: { padding: "11px 20px", fontSize: 14 },
    lg: { padding: "15px 28px", fontSize: 15 },
  };
  const variants = {
    primary: {
      background: `linear-gradient(135deg, ${T.accent}, ${T.violet})`,
      color: "#fff", border: "1px solid transparent",
    },
    ghost: {
      background: "transparent", color: T.text,
      border: `1px solid ${T.borderHi}`,
    },
    subtle: {
      background: T.surfaceHi, color: T.text,
      border: `1px solid ${T.border}`,
    },
    danger: {
      background: "transparent", color: T.risk,
      border: `1px solid ${T.risk}55`,
    },
  };
  return (
    <motion.button
      whileHover={{ y: props.disabled || loading ? 0 : -1 }}
      whileTap={{ scale: props.disabled || loading ? 1 : 0.985 }}
      transition={{ duration: 0.15 }}
      style={{
        ...sizes[size], ...variants[variant],
        fontFamily: font.sans, fontWeight: 600, borderRadius: T.radiusSm,
        cursor: props.disabled || loading ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.5 : 1,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        gap: 8, whiteSpace: "nowrap", ...style,
      }}
      {...props}
    >
      {loading && <Spinner size={14} />}
      {children}
    </motion.button>
  );
}

export function Spinner({ size = 16, color = "currentColor" }) {
  return (
    <motion.span
      animate={{ rotate: 360 }}
      transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
      style={{
        width: size, height: size, borderRadius: "50%",
        border: `2px solid ${color}33`, borderTopColor: color,
        display: "inline-block", flexShrink: 0,
      }}
    />
  );
}

export function Field({ label, hint, error, children, required }) {
  return (
    <label style={{ display: "block", marginBottom: 16 }}>
      <div style={{
        fontSize: 13, fontWeight: 600, color: T.textDim,
        marginBottom: 7, display: "flex", gap: 6, alignItems: "baseline",
      }}>
        {label}
        {required && <span style={{ color: T.accent, fontSize: 11 }}>required</span>}
        {!required && <span style={{ color: T.textFaint, fontSize: 11 }}>optional</span>}
      </div>
      {children}
      {hint && !error && (
        <div style={{ fontSize: 12, color: T.textFaint, marginTop: 6 }}>{hint}</div>
      )}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{ fontSize: 12, color: T.risk, marginTop: 6 }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </label>
  );
}

export function Input({ style, invalid, ...props }) {
  const [focus, setFocus] = useState(false);
  return (
    <input
      {...props}
      onFocus={(e) => { setFocus(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); props.onBlur?.(e); }}
      style={{
        width: "100%", padding: "12px 14px", fontSize: 14,
        fontFamily: font.sans, color: T.text,
        background: T.bgAlt,
        border: `1px solid ${invalid ? T.risk : focus ? T.accent : T.border}`,
        borderRadius: T.radiusSm, outline: "none",
        transition: "border-color .15s, box-shadow .15s",
        boxShadow: focus ? `0 0 0 3px ${T.accent}22` : "none",
        boxSizing: "border-box", ...style,
      }}
    />
  );
}

export function Card({ children, style, hover, delay = 0, ...rest }) {
  return (
    <motion.div
      initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }}
      custom={delay} variants={fadeUp}
      whileHover={hover ? { y: -3, borderColor: T.borderHi } : undefined}
      style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: T.radius, padding: 22, ...style,
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function Badge({ children, color = T.accent, style }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700,
      letterSpacing: 0.3, color, background: `${color}18`,
      border: `1px solid ${color}33`, whiteSpace: "nowrap", ...style,
    }}>
      {children}
    </span>
  );
}

/** Accessible tooltip for metric explanations. */
export function Info({ text, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        aria-label="What does this mean?"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        style={{
          width: 16, height: 16, borderRadius: "50%", cursor: "help",
          border: `1px solid ${T.borderHi}`, background: "transparent",
          color: T.textFaint, fontSize: 10, lineHeight: 1, padding: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700,
        }}
      >?</button>
      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            role="tooltip"
            style={{
              position: "absolute", bottom: "calc(100% + 8px)", left: "50%",
              transform: "translateX(-50%)", width: 260, zIndex: 50,
              background: T.surfaceHi, border: `1px solid ${T.borderHi}`,
              borderRadius: T.radiusSm, padding: "10px 12px",
              fontSize: 12.5, lineHeight: 1.55, color: T.textDim,
              boxShadow: "0 12px 32px rgba(0,0,0,.5)", fontWeight: 400,
              textAlign: "left",
            }}
          >
            {text || children}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Number that counts up when it scrolls into view. */
export function Stat({ value, decimals = 0 }) {
  const [shown, setShown] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const target = Number(value) || 0;
      const start = performance.now();
      const dur = 900;
      const tick = (now) => {
        const p = Math.min((now - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setShown(target * eased);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [value]);
  return <span ref={ref}>{shown.toFixed(decimals)}</span>;
}

export function Toast({ message, tone = "error", onDone }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 4500);
    return () => clearTimeout(t);
  }, [message, onDone]);
  const color = tone === "error" ? T.risk : T.good;
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          style={{
            position: "fixed", bottom: 24, left: "50%", translateX: "-50%",
            zIndex: 200, padding: "12px 18px", borderRadius: T.radiusSm,
            background: T.surfaceHi, border: `1px solid ${color}55`,
            color: T.text, fontSize: 14, maxWidth: 440,
            boxShadow: "0 16px 40px rgba(0,0,0,.55)",
          }}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
