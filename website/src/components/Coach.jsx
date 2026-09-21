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

  useEffect(() => {
    let alive = true;
    api.coachConfig?.()
      .then((c) => { if (alive) setAvailable(Boolean(c?.available)); })
      .catch(() => { if (alive) setAvailable(false); });
    return () => { alive = false; };
  }, []);

  // Nothing to offer until the key is configured.
  if (available === false || !data) return null;

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
        estimatedRating: data?.recommendation?.recommendation?.cf_rating
                      ?? data?.cf_rating ?? 1200,
        totalSolved: rows.reduce((s, t) => s + (t.solved || 0), 0),
        weakTags: sorted.slice(0, 6),
        strongTags: sorted.slice(-4).reverse(),
        recommendedProblems: (data.recommended_problems || []).slice(0, 25),
        tagImpact: data.tag_impact || [],
      });
      setPlan(r);
    } catch (err) {
      if (err.code === "TRIAL_USED") { setTrialUsed(true); setError(err.message); }
      else setError(err.message || "Could not generate a plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{
      borderColor: plan ? T.borderHi : T.border,
      background: plan
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
        {!plan && (
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

        {plan && !busy && (
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
              dangerouslySetInnerHTML={{ __html: plan.plan }}
            />
            <div style={{ display: "flex", gap: 12, alignItems: "center",
                          marginTop: 18, paddingTop: 14,
                          borderTop: `1px solid ${T.border}`,
                          fontSize: 12, color: T.textFaint, flexWrap: "wrap" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="sparkle" size={12} />
                Written by {plan.model?.includes("opus") ? "Claude Opus" : "Claude Sonnet"}
              </span>
              <Button size="sm" variant="ghost" onClick={generate}
                      style={{ marginLeft: "auto" }}>
                Rewrite
              </Button>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
