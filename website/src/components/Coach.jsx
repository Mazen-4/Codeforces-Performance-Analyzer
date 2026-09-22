import { useState, useEffect, useMemo } from "react";
import { m, AnimatePresence } from "framer-motion";
import { T } from "../lib/theme.js";
import { api } from "../lib/api.js";
import { Card, Button, Badge } from "./ui.jsx";
import Icon, { IconTile } from "./Icon.jsx";

/** The AI Coach: turns the analysis into a 7-day training plan.
 *
 *  The plan is generated on demand rather than with every analysis — each one
 *  costs real money, and most people do not want a new plan on every run. */

/** Split the rendered plan into days so each can carry a checkbox.
 *
 *  The server already tags every day with data-day and data-topic, so this
 *  reads those rather than parsing the visible text. Falls back to rendering
 *  the whole plan untouched if the shape is not what we expect — an older
 *  saved plan should still display, just without checkboxes. */
function splitDays(html) {
  if (typeof document === "undefined" || !html) return null;
  try {
    const host = document.createElement("div");
    host.innerHTML = html;
    const nodes = [...host.querySelectorAll(".day")];
    if (!nodes.length) return null;
    return nodes.map((n) => ({
      day: Number(n.getAttribute("data-day")),
      topic: n.getAttribute("data-topic") || "",
      html: n.outerHTML,
    })).filter(d => Number.isInteger(d.day) && d.day > 0);
  } catch {
    return null;
  }
}

export default function Coach({ data, handle, isPro, onUpgrade }) {
  const [available, setAvailable] = useState(null);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  // Which days the student has ticked, and whether this plan is pinned.
  const [doneDays, setDoneDays] = useState([]);
  const [pinned, setPinned] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);

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

  // Days are derived from the rendered plan, so an older plan without the
  // data attributes still displays -- just without checkboxes.
  const days = useMemo(() => splitDays(shown?.plan), [shown?.plan]);
  // Progress belongs to a saved run: there is nothing to attach it to
  // otherwise, and only Plus accounts have plans at all.
  const canTrack = Boolean(runId && isPro);
  const pct = days?.length
    ? Math.round((doneDays.length / days.length) * 100) : 0;

  // Load this run's ticks and whether it is the pinned one.
  useEffect(() => {
    if (!canTrack) return;
    let alive = true;
    api.pinnedPlan?.()
      .then((r) => {
        if (!alive) return;
        setPinned(r?.plan?.id === runId);
        if (r?.plan?.id === runId) setDoneDays(r.completed_days || []);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [canTrack, runId]);

  async function toggleDay(d) {
    if (!canTrack) return;
    const next = doneDays.includes(d.day);
    // Optimistic: a checkbox that waits on the network feels broken.
    setDoneDays((prev) => next
      ? prev.filter((x) => x !== d.day)
      : [...prev, d.day].sort((a, b) => a - b));
    try {
      const r = await api.setCoachDay(runId, d.day, !next, d.topic);
      if (Array.isArray(r?.completed_days)) setDoneDays(r.completed_days);
    } catch {
      // Put it back: the server is the record, not the checkbox.
      setDoneDays((prev) => next
        ? [...prev, d.day].sort((a, b) => a - b)
        : prev.filter((x) => x !== d.day));
    }
  }

  async function togglePin() {
    if (!canTrack) return;
    setPinBusy(true);
    try {
      const r = await api.pinPlan(pinned ? null : runId);
      setPinned(r?.pinned === runId);
    } catch (err) {
      setError(err.message || "Could not pin that plan.");
    } finally {
      setPinBusy(false);
    }
  }

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
    setBusy(true); setError(""); setLocked(false);
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
      if (err.code === "PLUS_ONLY") { setLocked(true); setError(err.message); }
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
          {!isPro && !shown && (
            <p style={{ color: T.textFaint, fontSize: 12.5, lineHeight: 1.6,
                        margin: "8px 0 0" }}>
              Each day gets a warm-up, a time budget, a learning resource and a
              check you can tick off as you go.
            </p>
          )}
        </div>
        {!shown && available && (
          isPro ? (
            <Button onClick={generate} loading={busy} disabled={busy}>
              {busy ? "Writing your plan" : "Build my plan"}
            </Button>
          ) : (
            // Free accounts see what the coach does and how to get it, rather
            // than a button that fails. The card is a sales surface, not a
            // dead end.
            <Button variant="subtle" onClick={onUpgrade}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <Icon name="lock" size={13} />
                Unlock with Plus
              </span>
            </Button>
          )
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
            <span style={{ color: locked ? T.violet : T.risk, marginTop: 1 }}>
              <Icon name={locked ? "lock" : "alert"} size={15} />
            </span>
            <div style={{ fontSize: 13, color: T.textDim, lineHeight: 1.6 }}>
              {error}
              {locked && !isPro && (
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
            {days ? (
              <div className="coach-plan">
                {days.map((d) => {
                  const checked = doneDays.includes(d.day);
                  return (
                    <div key={d.day} style={{ display: "flex", gap: 11,
                                              alignItems: "flex-start" }}>
                      <label style={{
                        display: "flex", alignItems: "center", paddingTop: 16,
                        cursor: canTrack ? "pointer" : "default",
                      }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canTrack}
                          onChange={() => toggleDay(d)}
                          aria-label={`Mark day ${d.day} complete`}
                          style={{ width: 17, height: 17, accentColor: T.good,
                                   cursor: canTrack ? "pointer" : "default" }}
                        />
                      </label>
                      <div
                        style={{ flex: 1, minWidth: 0,
                                 opacity: checked ? 0.55 : 1,
                                 transition: "opacity .18s" }}
                        /* Model output, rendered inside a styled container
                           rather than trusted as page-level markup. */
                        dangerouslySetInnerHTML={{ __html: d.html }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className="coach-plan"
                dangerouslySetInnerHTML={{ __html: shown.plan }}
              />
            )}

            {canTrack && days && (
              <div style={{ marginTop: 14, display: "flex", alignItems: "center",
                            gap: 11, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 160, height: 6, borderRadius: 99,
                              background: T.bgAlt, overflow: "hidden" }}>
                  <m.div
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.35 }}
                    style={{ height: "100%", background: T.good }}
                  />
                </div>
                <span style={{ fontSize: 12.5, color: T.textDim }}>
                  {doneDays.length} of {days.length} days done
                </span>
              </div>
            )}
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
              {canTrack && runId && (
                <Button
                  size="sm"
                  variant={pinned ? "subtle" : "ghost"}
                  onClick={togglePin}
                  loading={pinBusy}
                  disabled={pinBusy}
                  style={{ marginLeft: "auto" }}
                >
                  {pinned ? "Pinned to dashboard" : "Pin to dashboard"}
                </Button>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
