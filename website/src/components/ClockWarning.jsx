import { useState, useEffect, useCallback } from "react";
import { m, AnimatePresence } from "framer-motion";
import { T, font } from "../lib/theme.js";
import { Button } from "./ui.jsx";

const MAX_SKEW_MS = 5 * 60 * 1000;

/** Compares the device clock against the server's and reports the drift.
 *
 *  Subscriptions depend on an accurate date: a device set to the wrong year
 *  would compute the wrong billing period, show a lapsed plan as active, or
 *  let an expired one keep working. The server is the authority — this only
 *  surfaces the problem and tells the user how to fix it. */
export function useClockCheck() {
  const [state, setState] = useState({
    checked: false, ok: true, skewMs: 0, serverTime: null, deviceTime: null,
  });

  const check = useCallback(async () => {
    try {
      const before = Date.now();
      const res = await fetch("/api/time", { cache: "no-store" });
      const after = Date.now();
      if (!res.ok) throw new Error("no time endpoint");
      const { server_time, max_skew_ms } = await res.json();

      // Discount the round trip: compare the server's time against the
      // midpoint of the request, not against one end of it.
      const midpoint = before + (after - before) / 2;
      const skew = Math.abs(server_time - midpoint);
      const limit = Number(max_skew_ms) || MAX_SKEW_MS;

      setState({
        checked: true, ok: skew <= limit, skewMs: skew,
        serverTime: server_time, deviceTime: midpoint,
      });
    } catch {
      // If the check itself fails, do not block the app on a guess.
      setState({ checked: true, ok: true, skewMs: 0, serverTime: null, deviceTime: null });
    }
  }, []);

  useEffect(() => {
    // Deferred so the state update never lands synchronously inside the effect.
    const t = setTimeout(check, 0);
    return () => clearTimeout(t);
  }, [check]);
  return { ...state, recheck: check };
}

function describe(ms) {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} seconds`;
  const m2 = Math.round(s / 60);
  if (m2 < 90) return `${m2} minutes`;
  const h = Math.round(m2 / 60);
  if (h < 48) return `${h} hours`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d} days`;
  return `${Math.round(d / 365)} years`;
}

export default function ClockWarning({ skewMs, serverTime, deviceTime, onRecheck }) {
  const [busy, setBusy] = useState(false);

  const fmt = (t) => new Date(t).toLocaleString(undefined, {
    dateStyle: "medium", timeStyle: "short",
  });

  return (
    <AnimatePresence>
      <m.div
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        style={{
          padding: "16px 20px", borderRadius: T.radiusSm, marginBottom: 22,
          background: `${T.risk}0f`, border: `1px solid ${T.risk}44`,
          display: "flex", gap: 15, alignItems: "flex-start", flexWrap: "wrap",
        }}
        role="alert"
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
             stroke={T.risk} strokeWidth="2" strokeLinecap="round"
             style={{ flexShrink: 0, marginTop: 2 }} aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>

        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 6 }}>
            Your device clock is off by about {describe(skewMs)}
          </div>
          <p style={{ color: T.textDim, fontSize: 13.5, lineHeight: 1.65, margin: 0 }}>
            Analysis is paused because subscriptions and billing depend on an
            accurate date. Turn on <strong style={{ color: T.text }}>Set date
            and time automatically</strong> in your system settings, then check
            again.
          </p>
          {serverTime && (
            <div style={{ marginTop: 10, fontFamily: font.mono, fontSize: 12,
                          color: T.textFaint, lineHeight: 1.8 }}>
              <div>your device — {fmt(deviceTime ?? serverTime + skewMs)}</div>
              <div>actual time&nbsp;&nbsp;— {fmt(serverTime)}</div>
            </div>
          )}
        </div>

        <Button
          variant="subtle" loading={busy}
          onClick={async () => { setBusy(true); await onRecheck(); setBusy(false); }}
        >
          Check again
        </Button>
      </m.div>
    </AnimatePresence>
  );
}
