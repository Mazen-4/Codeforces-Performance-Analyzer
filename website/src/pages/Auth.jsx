import { useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { T } from "../lib/theme.js";
import { useAuth } from "../lib/auth.jsx";
import { Button, Field, Input, Card } from "../components/ui.jsx";
import Aurora from "../components/Aurora.jsx";

export function Login()  { return <AuthForm mode="login" />; }
export function Signup() { return <AuthForm mode="signup" />; }

function AuthForm({ mode }) {
  const isSignup = mode === "signup";
  const { login, signup } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ email: "", password: "", cf_handle: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user = isSignup ? await signup(form) : await login(form);
      const to = loc.state?.from
        || (user.role === "admin" ? "/admin" : "/dashboard");
      nav(to, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "relative", minHeight: "calc(100vh - 66px)",
                  display: "grid", placeItems: "center", padding: "48px 20px" }}>
      <Aurora intensity={0.55} />
      <motion.div
        initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ width: "100%", maxWidth: 430, position: "relative", zIndex: 1 }}
      >
        <Card style={{ padding: 32 }}>
          <h1 style={{ fontSize: 25, fontWeight: 750, margin: "0 0 6px",
                       letterSpacing: -0.5 }}>
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p style={{ color: T.textDim, fontSize: 14, margin: "0 0 26px",
                      lineHeight: 1.6 }}>
            {isSignup
              ? "Three fields to start. Everything else can wait."
              : "Sign in to pick up where you left off."}
          </p>

          <form onSubmit={submit} noValidate>
            <Field label="Email" required>
              <Input
                type="email" value={form.email} onChange={set("email")}
                placeholder="you@example.com" autoComplete="email" required
              />
            </Field>

            {isSignup && (
              <Field
                label="Codeforces handle" required
                hint="We use this to pull your submission history."
              >
                <Input
                  value={form.cf_handle} onChange={set("cf_handle")}
                  placeholder="tourist" autoComplete="username" required
                />
              </Field>
            )}

            <Field
              label="Password" required
              hint={isSignup ? "At least 8 characters." : undefined}
            >
              <Input
                type="password" value={form.password} onChange={set("password")}
                placeholder="••••••••"
                autoComplete={isSignup ? "new-password" : "current-password"}
                required
              />
            </Field>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                style={{
                  padding: "11px 14px", borderRadius: 10, marginBottom: 16,
                  background: `${T.risk}14`, border: `1px solid ${T.risk}44`,
                  color: T.risk, fontSize: 13.5, lineHeight: 1.5,
                }}
              >
                {error}
              </motion.div>
            )}

            <Button type="submit" loading={busy} disabled={busy}
                    style={{ width: "100%" }} size="lg">
              {isSignup ? "Create account" : "Sign in"}
            </Button>
          </form>

          <div style={{ marginTop: 22, textAlign: "center", fontSize: 13.5,
                        color: T.textDim }}>
            {isSignup ? "Already have an account? " : "New here? "}
            <Link
              to={isSignup ? "/login" : "/signup"}
              style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}
            >
              {isSignup ? "Sign in" : "Create one"}
            </Link>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
