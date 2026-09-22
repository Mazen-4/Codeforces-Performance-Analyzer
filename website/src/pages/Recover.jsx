import { useState, useEffect } from "react";
import { m } from "framer-motion";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { T, font } from "../lib/theme.js";
import { api } from "../lib/api.js";
import { Button, Field, Input, Card } from "../components/ui.jsx";
import Aurora from "../components/Aurora.jsx";
import Icon from "../components/Icon.jsx";

function Frame({ title, subtitle, children }) {
  return (
    <div style={{ position: "relative", minHeight: "calc(100vh - 66px)",
                  display: "grid", placeItems: "center", padding: "48px 22px" }}>
      <Aurora />
      <m.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 420 }}
      >
        <Card style={{ padding: 30 }}>
          <h1 style={{ fontSize: 22, fontWeight: 760, margin: "0 0 8px",
                       letterSpacing: -0.5 }}>{title}</h1>
          {subtitle && (
            <p style={{ color: T.textDim, fontSize: 13.5, lineHeight: 1.6,
                        margin: "0 0 22px" }}>{subtitle}</p>
          )}
          {children}
        </Card>
      </m.div>
    </div>
  );
}

/** Ask for a reset link. */
export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api.forgotPassword(email.trim());
      // The API answers the same way whether or not the address is registered,
      // and so does this screen: saying "no such account" would let anyone
      // test which addresses exist.
      setSent(true);
    } catch (err) {
      setError(err.message || "Could not send that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Frame title="Check your email">
        <div style={{ display: "flex", gap: 11, alignItems: "flex-start",
                      padding: "14px 15px", borderRadius: T.radiusSm,
                      background: T.bgAlt, border: `1px solid ${T.border}` }}>
          <span style={{ color: T.good, marginTop: 1, display: "flex" }}>
            <Icon name="checkCircle" size={16} />
          </span>
          <p style={{ margin: 0, fontSize: 13, color: T.textDim, lineHeight: 1.65 }}>
            If that address has an account, a reset link is on its way. The link
            works once and expires in an hour.
          </p>
        </div>
        <div style={{ marginTop: 20, textAlign: "center" }}>
          <Link to="/login" style={{ color: T.accent, fontSize: 13.5,
                                     fontWeight: 600, textDecoration: "none" }}>
            Back to sign in
          </Link>
        </div>
      </Frame>
    );
  }

  return (
    <Frame
      title="Forgot your password?"
      subtitle="Enter your email and we will send you a link to set a new one."
    >
      <form onSubmit={submit}>
        <Field label="Email" required>
          <Input type="email" value={email} required
                 onChange={(e) => setEmail(e.target.value)}
                 placeholder="you@example.com" />
        </Field>
        {error && (
          <div style={{ padding: "11px 14px", borderRadius: 10, marginBottom: 14,
                        background: `${T.risk}14`, border: `1px solid ${T.risk}44`,
                        color: T.risk, fontSize: 13.5, lineHeight: 1.5 }}>
            {error}
          </div>
        )}
        <Button type="submit" loading={busy} disabled={busy || !email.trim()}
                style={{ width: "100%" }} size="lg">
          Send reset link
        </Button>
      </form>
      <div style={{ marginTop: 20, textAlign: "center", fontSize: 13.5,
                    color: T.textDim }}>
        Remembered it?{" "}
        <Link to="/login" style={{ color: T.accent, fontWeight: 600,
                                   textDecoration: "none" }}>Sign in</Link>
      </div>
    </Frame>
  );
}

/** Set a new password from an emailed link. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const nav = useNavigate();
  // A missing token needs no network call, so it is decided during render
  // rather than by an effect that sets state on mount.
  const [checked, setChecked] = useState(null);
  const valid = token ? checked : false;
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    api.checkResetToken(token)
      .then((r) => { if (alive) setChecked(Boolean(r?.valid)); })
      .catch(() => { if (alive) setChecked(false); });
    return () => { alive = false; };
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    if (pw !== again) { setError("Those passwords do not match."); return; }
    setBusy(true); setError("");
    try {
      await api.resetPassword(token, pw);
      setDone(true);
      // Every session was revoked server-side, so signing in again is the
      // only way forward.
      setTimeout(() => nav("/login", { replace: true }), 2200);
    } catch (err) {
      setError(err.message || "Could not reset your password.");
    } finally {
      setBusy(false);
    }
  }

  if (valid === null) {
    return <Frame title="Checking that link…" />;
  }
  if (!valid) {
    return (
      <Frame
        title="That link is no longer valid"
        subtitle="Reset links work once and expire after an hour."
      >
        <Link to="/forgot-password">
          <Button style={{ width: "100%" }} size="lg">Request a new link</Button>
        </Link>
      </Frame>
    );
  }
  if (done) {
    return (
      <Frame title="Password changed">
        <p style={{ margin: 0, fontSize: 13.5, color: T.textDim, lineHeight: 1.65 }}>
          You have been signed out everywhere for safety. Taking you to the
          sign-in page…
        </p>
      </Frame>
    );
  }

  return (
    <Frame title="Choose a new password">
      <form onSubmit={submit}>
        <Field label="New password" hint="At least 8 characters" required>
          <Input type="password" value={pw} required minLength={8}
                 onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Confirm new password" required>
          <Input type="password" value={again} required
                 onChange={(e) => setAgain(e.target.value)} />
        </Field>
        {error && (
          <div style={{ padding: "11px 14px", borderRadius: 10, marginBottom: 14,
                        background: `${T.risk}14`, border: `1px solid ${T.risk}44`,
                        color: T.risk, fontSize: 13.5, lineHeight: 1.5 }}>
            {error}
          </div>
        )}
        <Button type="submit" loading={busy}
                disabled={busy || pw.length < 8 || !again}
                style={{ width: "100%" }} size="lg">
          Set new password
        </Button>
      </form>
      <p style={{ marginTop: 16, fontSize: 12, color: T.textFaint,
                  lineHeight: 1.6, fontFamily: font.sans }}>
        Passwords can be reset 5 times a month, and once a week after the first.
      </p>
    </Frame>
  );
}
