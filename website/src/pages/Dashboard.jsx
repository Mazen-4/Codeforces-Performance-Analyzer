import { useState, useEffect, useRef, useMemo } from "react";
import { m, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { T, font } from "../lib/theme.js";
import { useAuth } from "../lib/auth.jsx";
import { api } from "../lib/api.js";
import { Button, Input, Card, Spinner, Badge, Toast } from "../components/ui.jsx";
import Results from "../components/Results.jsx";
import Compare from "../components/Compare.jsx";
import { tagInfo } from "../lib/copy.js";

// Shown while the pipeline runs. Deliberately about the user's data, not about
// what the system is doing internally.
const STEPS = [
  "Reading your submission history",
  "Scoring each topic",
  "Comparing against your rating band",
  "Choosing problems worth your time",
];

export default function Dashboard() {
  const { user } = useAuth();
  const [handle, setHandle] = useState(user?.cf_handle || "");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [history, setHistory] = useState([]);
  const [compareWith, setCompareWith] = useState(null);
  // id of the search row created by the run currently on screen
  const [lastRunId, setLastRunId] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const abortRef = useRef(null);
  const isAdmin = user?.role === "admin";

  // Flatten the current result the same way the server stores snapshots, so
  // today's numbers and a saved run are directly comparable.
  const currentScores = useMemo(() => {
    const ts = data?.tag_strengths;
    if (!ts) return null;
    const out = {};
    for (const [k, v] of Object.entries(ts)) {
      const n = typeof v === "object"
        ? (v?.strength ?? v?.user_strength ?? v?.score)
        : v;
      if (Number.isFinite(Number(n))) out[k] = Math.round(Number(n) * 10) / 10;
    }
    return Object.keys(out).length ? out : null;
  }, [data]);

  // Earlier runs for the SAME handle that captured scores. Comparing across
  // handles would be meaningless.
  const comparable = useMemo(() => {
    if (!data || !handle) return [];
    return history.filter(h =>
      h.comparable &&
      String(h.cf_handle).toLowerCase() === handle.trim().toLowerCase() &&
      // History reloads after each run, so the run just displayed is in this
      // list. Comparing it with itself would show zero change everywhere.
      h.id !== lastRunId);
  }, [history, data, handle, lastRunId]);

  useEffect(() => { loadHistory(); }, []);
  async function loadHistory() {
    try { const r = await api.mySearches(); setHistory(r.searches || []); }
    catch { /* history is a nicety, never block the page on it */ }
  }

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 2600);
    return () => clearInterval(t);
  }, [busy]);

  async function run(e) {
    e?.preventDefault();
    const h = handle.trim();
    if (!h) return;
    setBusy(true); setError(""); setData(null); setStep(0);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const result = await api.analyze(h, abortRef.current.signal);
      if (result?.error) throw new Error(result.error);
      if (!result?.tag_strengths) {
        throw new Error(
          "We could not build a profile for that handle. It may have too few rated submissions yet."
        );
      }
      setData(result);
      setLastRunId(result.run_id ?? null);
      setCompareWith(null);
      loadHistory();
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(
          err.message?.includes("timed out")
            ? "That took longer than expected. Try again in a moment."
            : err.message
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "36px 22px 90px" }}>
      <m.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <h1 style={{ fontSize: 30, fontWeight: 780, margin: "0 0 8px",
                     letterSpacing: -0.9 }}>
          {user?.full_name ? `Hey ${user.full_name.split(" ")[0]}.` : "Your analysis"}
        </h1>
        <p style={{ color: T.textDim, fontSize: 15, margin: "0 0 26px" }}>
          {isAdmin
            ? "Enter any Codeforces handle to see where the gaps are."
            : "See where your gaps are, and what to practise next."}
        </p>
      </m.div>

      <Card style={{ padding: 20, marginBottom: 26 }}>
        {isAdmin ? (
          <>
            <form onSubmit={run} style={{ display: "flex", gap: 11, flexWrap: "wrap" }}>
              <Input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="Codeforces handle"
                style={{ flex: 1, minWidth: 220 }}
                disabled={busy}
                aria-label="Codeforces handle"
              />
              <Button type="submit" loading={busy} disabled={busy || !handle.trim()}>
                {busy ? "Analysing" : "Analyse"}
              </Button>
              {user?.cf_handle && handle !== user.cf_handle && !busy && (
                <Button type="button" variant="ghost"
                        onClick={() => setHandle(user.cf_handle)}>
                  Use mine
                </Button>
              )}
            </form>
            <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 10 }}>
              As an admin you can analyse any handle.
            </div>
          </>
        ) : (
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap",
                        alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 12, color: T.textFaint, letterSpacing: 0.6,
                            textTransform: "uppercase", marginBottom: 6 }}>
                Your linked handle
              </div>
              <div style={{ fontFamily: font.mono, fontSize: 17, fontWeight: 700 }}>
                {user?.cf_handle}
              </div>
              <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 7 }}>
                Analysing someone else? Change your handle on the{" "}
                <Link to="/profile" style={{ color: T.accent }}>profile page</Link>.
              </div>
            </div>
            <Button onClick={run} loading={busy} disabled={busy} size="lg">
              {busy ? "Analysing" : "Analyse my profile"}
            </Button>
          </div>
        )}
      </Card>

      <AnimatePresence mode="wait">
        {busy && (
          <m.div
            key="loading"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <Card style={{ padding: 44, textAlign: "center" }}>
              <Spinner size={30} color={T.accent} />
              <AnimatePresence mode="wait">
                <m.div
                  key={step}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }}
                  style={{ marginTop: 20, fontSize: 15, color: T.textDim }}
                >
                  {STEPS[step]}…
                </m.div>
              </AnimatePresence>
              <div style={{ marginTop: 10, fontSize: 12.5, color: T.textFaint }}>
                This usually takes 30 to 60 seconds.
              </div>
            </Card>
          </m.div>
        )}

        {!busy && error && (
          <m.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card style={{ borderColor: `${T.risk}55`, padding: 26 }}>
              <div style={{ color: T.risk, fontWeight: 650, marginBottom: 6 }}>
                Could not complete that analysis
              </div>
              <div style={{ color: T.textDim, fontSize: 14, lineHeight: 1.6 }}>
                {error}
              </div>
            </Card>
          </m.div>
        )}

        {!busy && data && (
          <m.div key="data" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div style={{ display: "grid", gap: 22 }}>
              {comparable.length > 0 && (
                <CompareBar
                  options={comparable}
                  selected={compareWith}
                  onSelect={setCompareWith}
                />
              )}
              {compareWith && currentScores && (
                <Compare
                  current={currentScores}
                  previous={compareWith}
                  onClose={() => setCompareWith(null)}
                />
              )}
              <Results
                data={data}
                handle={handle}
                userRating={data?.recommendation?.recommendation?.cf_rating
                         ?? data?.cf_rating ?? null}
                isPro={user?.plan === "pro"}
                onUpgrade={() => setShowUpgrade(true)}
              />
            </div>
          </m.div>
        )}

        {!busy && !data && !error && history.length === 0 && (
          <m.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card style={{ padding: 40 }}>
              <h3 style={{ fontSize: 19, fontWeight: 720, margin: "0 0 10px" }}>
                What you will get
              </h3>
              <p style={{ color: T.textDim, fontSize: 14.5, lineHeight: 1.7,
                          margin: "0 0 22px", maxWidth: 560 }}>
                Every topic scored from 0 to 100 against competitors in your
                rating band, the handful worth practising first, and specific
                problems to open next.
              </p>
              <div style={{ display: "grid", gap: 12,
                            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
                {[
                  ["Topic scores", "Where you stand in all 20 topics."],
                  ["Your focus list", "The few topics with the most to gain."],
                  ["Problems to solve", "Matched to your level, not random."],
                ].map(([t, d]) => (
                  <div key={t} style={{
                    padding: 15, borderRadius: 10, background: T.bgAlt,
                    border: `1px solid ${T.border}`,
                  }}>
                    <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 5 }}>
                      {t}
                    </div>
                    <div style={{ fontSize: 12.5, color: T.textFaint,
                                  lineHeight: 1.55 }}>{d}</div>
                  </div>
                ))}
              </div>
            </Card>
          </m.div>
        )}

        {!busy && !data && !error && history.length > 0 && (
          <m.div key="hist" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 14px" }}>
                Recent
              </h3>
              <div style={{ display: "grid", gap: 8 }}>
                {history.slice(0, 8).map((h) => (
                  <button
                    key={h.id}
                    onClick={() => { setHandle(h.cf_handle); }}
                    style={{
                      display: "flex", justifyContent: "space-between",
                      alignItems: "center", gap: 12, textAlign: "left",
                      padding: "11px 13px", borderRadius: 9, cursor: "pointer",
                      background: T.bgAlt, border: `1px solid ${T.border}`,
                      color: T.text, fontFamily: font.sans, fontSize: 14,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{h.cf_handle}</span>
                    <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {h.weakest_tag && (
                        <span style={{ fontSize: 12.5, color: T.textFaint }}>
                          focus: {tagInfo(h.weakest_tag).name}
                        </span>
                      )}
                      <span style={{ fontSize: 12, color: T.textFaint }}>
                        {new Date(h.searched_at).toLocaleDateString()}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          </m.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showUpgrade && (
          <UpgradeNote onClose={() => setShowUpgrade(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}


/** Lets the user pick an earlier run of the same handle to compare against. */
function CompareBar({ options, selected, onSelect }) {
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap",
                    alignItems: "center" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: T.textDim }}>
          Compare with an earlier run
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {options.slice(0, 5).map((o) => {
            const active = selected?.id === o.id;
            const when = new Date(o.searched_at).toLocaleDateString(undefined,
              { day: "numeric", month: "short" });
            return (
              <button
                key={o.id}
                onClick={() => onSelect(active ? null : o)}
                style={{
                  padding: "7px 13px", borderRadius: 8, cursor: "pointer",
                  fontFamily: font.sans, fontSize: 13, fontWeight: 600,
                  background: active ? T.surfaceHi : "transparent",
                  border: `1px solid ${active ? T.accent : T.border}`,
                  color: active ? T.text : T.textDim,
                }}
              >
                {when}
              </button>
            );
          })}
        </div>
        {options.length === 0 && (
          <span style={{ fontSize: 13, color: T.textFaint }}>
            Run this again in a few days to see your progress.
          </span>
        )}
      </div>
    </Card>
  );
}


/** Shown when a free account taps a Pro-only control. */
function UpgradeNote({ onClose }) {
  return (
    <m.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 160, display: "grid",
        placeItems: "center", padding: 20,
        background: "rgba(3,4,6,.78)", backdropFilter: "blur(6px)",
      }}
    >
      <m.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 420, background: T.surface,
          border: `1px solid ${T.borderHi}`, borderRadius: 16, padding: 28,
          boxShadow: "0 30px 70px rgba(0,0,0,.6)",
        }}
      >
        <Badge color={T.violet}>Pro</Badge>
        <h3 style={{ fontSize: 20, fontWeight: 750, margin: "14px 0 10px" }}>
          The full problem list
        </h3>
        <p style={{ color: T.textDim, fontSize: 14.5, lineHeight: 1.7, margin: 0 }}>
          Pro opens every recommendation, not just the top twelve, and adds
          sorting and filtering by topic and rating so you can build a session
          around exactly what you want to practise.
        </p>
        <p style={{ color: T.textFaint, fontSize: 13, lineHeight: 1.6,
                    margin: "14px 0 22px" }}>
          Pro is not on sale yet. This is a preview of what it will include.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="subtle" onClick={onClose}>Got it</Button>
        </div>
      </m.div>
    </m.div>
  );
}
