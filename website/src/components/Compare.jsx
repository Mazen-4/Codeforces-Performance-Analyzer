import { useMemo } from "react";
import { m } from "framer-motion";
import { T, band, font } from "../lib/theme.js";
import { tagInfo } from "../lib/copy.js";
import { Card, Badge, Info } from "./ui.jsx";

/** Side-by-side comparison of the current run against an earlier one. */
export default function Compare({ current, previous, onClose }) {
  const rows = useMemo(() => {
    const keys = new Set([...Object.keys(current || {}), ...Object.keys(previous?.scores || {})]);
    return [...keys]
      .map((key) => {
        const now  = Number(current?.[key]);
        const then = Number(previous?.scores?.[key]);
        const hasNow  = Number.isFinite(now);
        const hasThen = Number.isFinite(then);
        return {
          key, ...tagInfo(key),
          now:  hasNow  ? now  : null,
          then: hasThen ? then : null,
          delta: hasNow && hasThen ? now - then : null,
        };
      })
      // Biggest movement first, in either direction — that is the story.
      .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
  }, [current, previous]);

  const moved = rows.filter((r) => r.delta !== null && Math.abs(r.delta) >= 0.1);
  const gained = moved.filter((r) => r.delta > 0);
  const lost   = moved.filter((r) => r.delta < 0);

  const avgNow  = avg(rows.map((r) => r.now).filter(Number.isFinite));
  const avgThen = avg(rows.map((r) => r.then).filter(Number.isFinite));
  const avgDelta = avgNow !== null && avgThen !== null ? avgNow - avgThen : null;

  const when = previous?.searched_at
    ? new Date(previous.searched_at).toLocaleDateString(undefined,
        { day: "numeric", month: "short", year: "numeric" })
    : "earlier";

  return (
    <Card style={{ borderColor: T.borderHi }}>
      <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 style={{ fontSize: 16.5, fontWeight: 700, margin: 0 }}>
              Compared with {when}
            </h3>
            <Info text="Your scores today next to that earlier run. Movement of less than a point is normal noise between runs." />
          </div>
          <p style={{ color: T.textDim, fontSize: 13.5, margin: "7px 0 0" }}>
            {moved.length === 0
              ? "Nothing has moved measurably since then."
              : `${gained.length} topic${gained.length === 1 ? "" : "s"} up, `
                + `${lost.length} down.`}
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close comparison" style={{
            background: "transparent", border: `1px solid ${T.border}`,
            color: T.textDim, borderRadius: 8, cursor: "pointer",
            padding: "5px 11px", fontSize: 13, fontFamily: font.sans,
          }}>Close</button>
        )}
      </div>

      {avgDelta !== null && (
        <div style={{
          display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center",
          padding: "14px 16px", borderRadius: 10, marginBottom: 18,
          background: T.bgAlt, border: `1px solid ${T.border}`,
        }}>
          <Figure label={when} value={avgThen} dim />
          <Arrow delta={avgDelta} />
          <Figure label="Today" value={avgNow} />
          <div style={{ marginLeft: "auto" }}>
            <DeltaBadge delta={avgDelta} large />
          </div>
        </div>
      )}

      <div style={{ display: "grid", gap: 7 }}>
        <div style={{
          display: "grid", gridTemplateColumns: "minmax(130px,1.4fr) 1fr 1fr 78px",
          gap: 12, padding: "0 12px 6px", fontSize: 11,
          color: T.textFaint, textTransform: "uppercase", letterSpacing: 0.4,
        }}>
          <span>Topic</span><span>{when}</span><span>Today</span>
          <span style={{ textAlign: "right" }}>Change</span>
        </div>

        {rows.map((r, i) => (
          <m.div
            key={r.key}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.02, 0.35), duration: 0.3 }}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(130px,1.4fr) 1fr 1fr 78px",
              gap: 12, alignItems: "center", padding: "9px 12px",
              borderRadius: 9,
              background: i % 2 ? "transparent" : T.bgAlt + "70",
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 550 }}>{r.name}</span>
            <MiniBar value={r.then} dim />
            <MiniBar value={r.now} />
            <div style={{ textAlign: "right" }}><DeltaBadge delta={r.delta} /></div>
          </m.div>
        ))}
      </div>
    </Card>
  );
}

function avg(xs) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

function Figure({ label, value, dim }) {
  const b = value === null ? null : band(value);
  return (
    <div>
      <div style={{
        fontSize: 26, fontWeight: 800, fontFamily: font.mono, lineHeight: 1,
        color: value === null ? T.textFaint : (dim ? T.textDim : b.color),
      }}>
        {value === null ? "—" : Math.round(value)}
      </div>
      <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 5 }}>{label}</div>
    </div>
  );
}

function Arrow({ delta }) {
  const up = delta > 0;
  const flat = Math.abs(delta) < 0.1;
  return (
    <span style={{
      fontSize: 18, color: flat ? T.textFaint : up ? T.good : T.risk,
      fontWeight: 700,
    }}>
      {flat ? "→" : up ? "↗" : "↘"}
    </span>
  );
}

function MiniBar({ value, dim }) {
  if (value === null) {
    return <span style={{ fontSize: 12.5, color: T.textFaint }}>no data</span>;
  }
  const b = band(value);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div style={{ flex: 1, height: 5, background: T.bgAlt, borderRadius: 999 }}>
        <div style={{
          width: `${Math.max(0, Math.min(100, value))}%`, height: "100%",
          borderRadius: 999, background: dim ? T.borderHi : b.color,
        }} />
      </div>
      <span style={{
        fontFamily: font.mono, fontSize: 12, minWidth: 24, textAlign: "right",
        color: dim ? T.textDim : b.color, fontWeight: 700,
      }}>
        {Math.round(value)}
      </span>
    </div>
  );
}

function DeltaBadge({ delta, large }) {
  if (delta === null) {
    return <span style={{ fontSize: 12, color: T.textFaint }}>new</span>;
  }
  const flat = Math.abs(delta) < 0.1;
  const color = flat ? T.textFaint : delta > 0 ? T.good : T.risk;
  const sign = delta > 0 ? "+" : "";
  return (
    <Badge color={color} style={large ? { fontSize: 13, padding: "5px 12px" } : undefined}>
      {flat ? "no change" : `${sign}${delta.toFixed(1)}`}
    </Badge>
  );
}
