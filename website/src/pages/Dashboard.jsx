import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { T, font } from "../lib/theme.js";
import { useAuth } from "../lib/auth.jsx";
import { api } from "../lib/api.js";
import { Button, Input, Card, Spinner, Badge, Toast } from "../components/ui.jsx";
import Results from "../components/Results.jsx";
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
  const abortRef = useRef(null);

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
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <h1 style={{ fontSize: 30, fontWeight: 780, margin: "0 0 8px",
                     letterSpacing: -0.9 }}>
          {user?.full_name ? `Hey ${user.full_name.split(" ")[0]}.` : "Your analysis"}
        </h1>
        <p style={{ color: T.textDim, fontSize: 15, margin: "0 0 26px" }}>
          Enter a Codeforces handle to see where the gaps are.
        </p>
      </motion.div>

      <Card style={{ padding: 20, marginBottom: 26 }}>
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
      </Card>

      <AnimatePresence mode="wait">
        {busy && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <Card style={{ padding: 44, textAlign: "center" }}>
              <Spinner size={30} color={T.accent} />
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }}
                  style={{ marginTop: 20, fontSize: 15, color: T.textDim }}
                >
                  {STEPS[step]}…
                </motion.div>
              </AnimatePresence>
              <div style={{ marginTop: 10, fontSize: 12.5, color: T.textFaint }}>
                This usually takes 30 to 60 seconds.
              </div>
            </Card>
          </motion.div>
        )}

        {!busy && error && (
          <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card style={{ borderColor: `${T.risk}55`, padding: 26 }}>
              <div style={{ color: T.risk, fontWeight: 650, marginBottom: 6 }}>
                Could not complete that analysis
              </div>
              <div style={{ color: T.textDim, fontSize: 14, lineHeight: 1.6 }}>
                {error}
              </div>
            </Card>
          </motion.div>
        )}

        {!busy && data && (
          <motion.div key="data" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Results data={data} handle={handle} />
          </motion.div>
        )}

        {!busy && !data && !error && history.length === 0 && (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
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
          </motion.div>
        )}

        {!busy && !data && !error && history.length > 0 && (
          <motion.div key="hist" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
