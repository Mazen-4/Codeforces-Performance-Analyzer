import { useState, useEffect, useRef } from "react";
import { m, AnimatePresence } from "framer-motion";
import { T, font } from "../lib/theme.js";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { Button } from "./ui.jsx";
import Icon from "./Icon.jsx";

/** Shown to accounts that have not confirmed their address. Analysis, the
 *  coach and payment are blocked until they do, so this has to be visible and
 *  actionable rather than a dismissable notice. */
export default function VerifyBanner() {
  const { user, refresh } = useAuth();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef(null);

  const unverified = user && user.email_verified === false;

  useEffect(() => {
    if (!unverified) return;
    let alive = true;
    api.verifyStatus?.()
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        if (s?.retry_after_seconds > 0) setCooldown(s.retry_after_seconds);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [unverified]);

  // One interval for the countdown, cleared on unmount so it cannot tick on a
  // dead component.
  useEffect(() => {
    if (cooldown <= 0) return;
    timer.current = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(timer.current);
  }, [cooldown > 0]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!unverified) return null;

  async function submit(e) {
    e?.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    try {
      await api.verifyEmail(code.replace(/\D/g, ""));
      await refresh?.();
      setMsg("Email confirmed.");
    } catch (e2) {
      setErr(e2.message || "That code did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await api.verifyResend();
      setMsg("A new code is on its way.");
      setCooldown(180);
      if (typeof r?.remaining_today === "number") {
        setStatus((s) => ({ ...s, remaining_today: r.remaining_today }));
      }
    } catch (e2) {
      setErr(e2.message || "Could not send another code.");
      if (e2.retry_after_seconds) setCooldown(e2.retry_after_seconds);
    } finally {
      setBusy(false);
    }
  }

  const codeReady = code.replace(/\D/g, "").length === 6;

  return (
    <m.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      style={{
        marginBottom: 22, padding: "16px 18px", borderRadius: T.radiusSm,
        background: `${T.warn}0f`, border: `1px solid ${T.warn}44`,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start",
                    flexWrap: "wrap" }}>
        <span style={{ color: T.warn, marginTop: 2, display: "flex" }}>
          <Icon name="alert" size={17} strokeWidth={1.9} />
        </span>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 5 }}>
            Confirm your email to start analysing
          </div>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: T.textDim,
                      lineHeight: 1.6 }}>
            We sent a 6-digit code to{" "}
            <strong style={{ color: T.text }}>{user.email}</strong>.
          </p>

          <form onSubmit={submit}
                style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              maxLength={7}
              placeholder="000000"
              aria-label="6-digit verification code"
              style={{
                width: 130, padding: "9px 12px", borderRadius: 8,
                background: T.bgAlt, color: T.text, border: `1px solid ${T.borderHi}`,
                fontFamily: font.mono, fontSize: 16, letterSpacing: 3,
                outline: "none",
              }}
            />
            <Button type="submit" size="sm" loading={busy}
                    disabled={!codeReady || busy}>
              Confirm
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={resend}
                    disabled={busy || cooldown > 0}>
              {cooldown > 0
                ? `Resend in ${Math.floor(cooldown / 60)}:${String(cooldown % 60).padStart(2, "0")}`
                : "Send a new code"}
            </Button>
          </form>

          <AnimatePresence>
            {(msg || err) && (
              <m.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ marginTop: 10, fontSize: 12.5,
                         color: err ? T.risk : T.good, lineHeight: 1.55 }}
              >
                {err || msg}
              </m.div>
            )}
          </AnimatePresence>

          {status && typeof status.remaining_today === "number" && (
            <div style={{ marginTop: 8, fontSize: 12, color: T.textFaint }}>
              {status.remaining_today} of {status.sends_per_day} codes left today.
            </div>
          )}
        </div>
      </div>
    </m.div>
  );
}
