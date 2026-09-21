import { useState, useRef, useEffect } from "react";
import { m, AnimatePresence } from "framer-motion";
import { T, font } from "../lib/theme.js";

/** Dropdown styled to the app. Native <select> cannot be themed on most
 *  browsers and renders an OS widget that looks foreign next to everything
 *  else, so this replaces it. Keyboard and outside-click behaviour included. */
export function Dropdown({ value, onChange, options, label, minWidth = 150 }) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const ref = useRef(null);

  const current = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setFocus((f) => Math.min(f + 1, options.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setFocus((f) => Math.max(f - 1, 0)); }
      if (e.key === "Enter")     { e.preventDefault(); onChange(options[focus].value); setOpen(false); }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, focus, options, onChange]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setFocus(Math.max(0, options.findIndex((o) => o.value === value))); }}
        style={{
          display: "flex", alignItems: "center", gap: 9, minWidth,
          padding: "9px 12px", borderRadius: T.radiusSm, cursor: "pointer",
          fontFamily: font.sans, fontSize: 13, fontWeight: 560,
          color: T.text, background: T.bgAlt,
          border: `1px solid ${open ? T.accent : T.border}`,
          transition: "border-color .15s ease",
          justifyContent: "space-between", textAlign: "left",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {current?.label}
        </span>
        <Chevron open={open} />
      </button>

      <AnimatePresence>
        {open && (
          <m.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            role="listbox"
            style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40,
              minWidth: "100%", maxHeight: 260, overflowY: "auto",
              padding: 5, borderRadius: T.radiusSm,
              background: T.surfaceHi, border: `1px solid ${T.borderHi}`,
              boxShadow: "0 18px 40px rgba(0,0,0,.55)",
            }}
          >
            {options.map((o, i) => {
              const active = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setFocus(i)}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    padding: "8px 10px", borderRadius: 7, cursor: "pointer",
                    fontFamily: font.sans, fontSize: 13, textAlign: "left",
                    border: "none", whiteSpace: "nowrap",
                    color: active ? T.text : T.textDim,
                    fontWeight: active ? 650 : 500,
                    background: i === focus ? T.bgAlt : "transparent",
                  }}
                >
                  <span style={{
                    width: 5, height: 5, borderRadius: 999, flexShrink: 0,
                    background: active ? T.accent : "transparent",
                  }} />
                  <span style={{ flex: 1 }}>{o.label}</span>
                  {o.hint != null && (
                    <span style={{ fontSize: 11, color: T.textFaint, fontFamily: font.mono }}>
                      {o.hint}
                    </span>
                  )}
                </button>
              );
            })}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Two rating fields in one control, so the pair reads as a single range
 *  rather than two stray boxes. Spinners are hidden — they are useless at a
 *  step of 1 on a 0–3500 scale. */
export function RangeField({ min, max, onChange, presets = [] }) {
  const [openPresets, setOpenPresets] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!openPresets) return;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpenPresets(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openPresets]);

  const active = min || max;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div style={{
        display: "flex", alignItems: "center", borderRadius: T.radiusSm,
        background: T.bgAlt, border: `1px solid ${active ? T.accent : T.border}`,
        overflow: "hidden", transition: "border-color .15s ease",
      }}>
        <span style={{
          fontSize: 11, color: T.textFaint, padding: "0 4px 0 11px",
          letterSpacing: 0.4, textTransform: "uppercase", whiteSpace: "nowrap",
        }}>
          Rating
        </span>
        <NumField value={min} placeholder="any" label="Minimum rating"
                  onChange={(v) => onChange({ min: v, max })} />
        <span style={{ color: T.textFaint, fontSize: 13 }}>–</span>
        <NumField value={max} placeholder="any" label="Maximum rating"
                  onChange={(v) => onChange({ min, max: v })} />
        {presets.length > 0 && (
          <button
            type="button" aria-label="Rating presets"
            onClick={() => setOpenPresets((o) => !o)}
            style={{
              padding: "9px 10px", cursor: "pointer", background: "transparent",
              border: "none", borderLeft: `1px solid ${T.border}`,
              display: "grid", placeItems: "center",
            }}
          >
            <Chevron open={openPresets} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {openPresets && (
          <m.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }}
            style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 40,
              padding: 5, borderRadius: T.radiusSm, minWidth: 168,
              background: T.surfaceHi, border: `1px solid ${T.borderHi}`,
              boxShadow: "0 18px 40px rgba(0,0,0,.55)",
            }}
          >
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => { onChange({ min: p.min, max: p.max }); setOpenPresets(false); }}
                style={{
                  display: "flex", justifyContent: "space-between", gap: 14,
                  width: "100%", padding: "8px 10px", borderRadius: 7,
                  cursor: "pointer", border: "none", background: "transparent",
                  fontFamily: font.sans, fontSize: 13, color: T.textDim,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = T.bgAlt)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span>{p.label}</span>
                <span style={{ fontFamily: font.mono, fontSize: 11.5, color: T.textFaint }}>
                  {p.min || "0"}–{p.max || "∞"}
                </span>
              </button>
            ))}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NumField({ value, onChange, placeholder, label }) {
  return (
    <input
      type="text" inputMode="numeric" pattern="[0-9]*"
      value={value} placeholder={placeholder} aria-label={label}
      onChange={(e) => {
        const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
        onChange(v);
      }}
      style={{
        width: 52, padding: "9px 4px", textAlign: "center",
        background: "transparent", border: "none", outline: "none",
        color: T.text, fontFamily: font.mono, fontSize: 13, fontWeight: 600,
      }}
    />
  );
}

function Chevron({ open }) {
  return (
    <m.svg
      width="11" height="11" viewBox="0 0 24 24" fill="none"
      stroke={T.textFaint} strokeWidth="2.5" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden
      animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.18 }}
      style={{ flexShrink: 0 }}
    >
      <path d="M6 9l6 6 6-6" />
    </m.svg>
  );
}

/** A small pill that clears an active filter. */
export function ClearChip({ children, onClear }) {
  return (
    <button
      type="button" onClick={onClear}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
        borderRadius: 999, cursor: "pointer", fontFamily: font.sans,
        fontSize: 12, fontWeight: 560, color: T.textDim,
        background: T.bgAlt, border: `1px solid ${T.border}`,
      }}
    >
      {children}
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>
  );
}
