import { useState, useEffect } from "react";
import { m, AnimatePresence } from "framer-motion";
import { T } from "../lib/theme.js";
import { api } from "../lib/api.js";
import { Card, Button, Badge } from "./ui.jsx";
import Icon, { IconTile } from "./Icon.jsx";

/** The AI Coach: turns the analysis into a 7-day training plan.
 *
 *  The plan is generated on demand rather than with every analysis — each one
 *  costs real money, and most people do not want a new plan on every run. */
export default function Coach({ data, handle, isPro, onUpgrade }) {
  const [available, setAvailable] = useState(null);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [trialUsed, setTrialUsed] = useState(false);

  const runId = data?.run_id ?? null;

  // A plan belongs to one run, so what is shown is derived from the run on
  // screen rather than held as free-floating state. `plan` only counts while
  // it is tagged with the current run: switching analyses then falls back to
  // that run's saved plan, or to none, instead of leaving stale coaching up
  // that cites a different analysis's problems.
  const generated = plan && plan.runId === runId ? plan : null;
  const shown = generated
    || (data?.coach_plan
      ? { plan: data.coach_plan, model: data.coach_model, saved: true }
      : null);

  useEffect(() => {
    let alive = true;
    api.coachConfig?.()
      .then((c) => { if (alive) setAvailable(Boolean(c?.available)); })
      .catch(() => { if (alive) setAvailable(false); });
    return () => { alive = false; };
  }, []);

  // Nothing to offer until the key is configured -- unless this run already
  // has a plan, which is the user's own saved work and must stay readable
  // whether or not the coach can currently write new ones.
  if (!data) return null;
  if (available === false && !shown) return null;

  async function generate() {
    setBusy(true); setError(""); setTrialUsed(false);
    try {
      const ts = data.tag_strengths || {};
      const score = (v) => typeof v === "object"
        ? (v?.strength ?? v?.user_strength ?? v?.score ?? 0) : v;
      const rows = Object.entries(ts).map(([tag, v]) => ({
        tag, strength: Math.round(Number(score(v)) || 0),
        solved: v?.solved ?? 0, attempted: v?.attempted ?? 0,
      }));
      const sorted = [...rows].sort((a, b) => a.strength - b.strength);

      const r = await api.coach({
        handle,
        // Ties the plan to this exact analysis, so the server can store it
        // and hand it back later instead of writing a new one.
        runId,
        estimatedRating: data?.recommendation?.recommendation?.cf_rating
                      ?? data?.cf_rating ?? 1200,
        totalSolved: rows.reduce((s, t) => s + (t.solved || 0), 0),
        weakTags: sorted.slice(0, 6),
        strongTags: sorted.slice(-4).reverse(),
        recommendedProblems: (data.recommended_problems || []).slice(0, 25),
        tagImpact: data.tag_impact || [],
      });
      setPlan({ ...r, runId });
    } catch (err) {
      if (err.code === "TRIAL_USED") { setTrialUsed(true); setError(err.message); }
      else setError(err.message || "Could not generate a plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{
      borderColor: shown ? T.borderHi : T.border,
      background: shown
        ? T.surface
        : `linear-gradient(180deg, ${T.violet}0d, transparent 55%), ${T.surface}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 13,
                    flexWrap: "wrap" }}>
        <IconTile name="sparkle" color={T.violet} size={38} iconSize={18} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <h3 style={{ fontSize: 16.5, fontWeight: 700, margin: 0 }}>
              AI Coach
            </h3>
            <Badge color={T.violet}>Beta</Badge>
          </div>
          <p style={{ color: T.textDim, fontSize: 13.5, lineHeight: 1.6,
                      margin: "6px 0 0" }}>
            A seven-day plan built from your weakest topics and the problems
            the model picked for you.
          </p>
        </div>
        {!shown && available && (
          <Button onClick={generate} loading={busy} disabled={busy}>
            {busy ? "Writing your plan" : "Build my plan"}
          </Button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {busy && (
          <m.div
            key="busy"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ marginTop: 18, fontSize: 13, color: T.textFaint }}
          >
            Reading your weak topics, then drafting seven days…
          </m.div>
        )}

        {error && !busy && (
          <m.div
            key="err"
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            style={{ marginTop: 16, display: "flex", gap: 10,
                     alignItems: "flex-start" }}
          >
            <span style={{ color: trialUsed ? T.violet : T.risk, marginTop: 1 }}>
              <Icon name={trialUsed ? "lock" : "alert"} size={15} />
            </span>
            <div style={{ fontSize: 13, color: T.textDim, lineHeight: 1.6 }}>
              {error}
              {trialUsed && !isPro && (
                <div style={{ marginTop: 10 }}>
                  <Button size="sm" onClick={onUpgrade}>See Plus</Button>
                </div>
              )}
            </div>
          </m.div>
        )}

        {shown && !busy && (
          <m.div
            key="plan"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            style={{ marginTop: 20 }}
          >
            <div
              className="coach-plan"
              /* The prompt constrains output to a fixed set of divs and lists.
                 It is model output, so it is rendered in a styled container
                 rather than trusted as page-level markup. */
              dangerouslySetInnerHTML={{ __html: shown.plan }}
            />
            <div style={{ display: "flex", gap: 12, alignItems: "center",
                          marginTop: 18, paddingTop: 14,
                          borderTop: `1px solid ${T.border}`,
                          fontSize: 12, color: T.textFaint, flexWrap: "wrap" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="sparkle" size={12} />
                Written by {shown.model?.includes("opus") ? "Claude Opus" : "Claude Sonnet"}
              </span>
              {/* Says the plan is kept, so nobody feels they must copy it out
                  before leaving the page. */}
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="check" size={12} />
                Saved with this analysis
              </span>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
