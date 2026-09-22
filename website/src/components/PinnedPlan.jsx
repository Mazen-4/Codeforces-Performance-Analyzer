import { useState, useEffect, useMemo } from "react";
import { m } from "framer-motion";
import { T, font } from "../lib/theme.js";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { Card } from "./ui.jsx";
import Icon, { IconTile } from "./Icon.jsx";

/** Split a rendered plan into its days, reading the data attributes the
 *  server writes. Returns null for an older plan that lacks them, which the
 *  caller treats as "nothing to show here". */
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
    })).filter((d) => Number.isInteger(d.day) && d.day > 0);
  } catch {
    return null;
  }
}

/** The plan the user pinned, shown at the top of the dashboard so the week's
 *  work is the first thing they see rather than something to go looking for. */
export default function PinnedPlan({ onOpenRun }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [done, setDone] = useState([]);
  const [open, setOpen] = useState(true);

  const isPro = user?.plan === "pro";

  useEffect(() => {
    if (!isPro) return;
    let alive = true;
    api.pinnedPlan?.()
      .then((r) => {
        if (!alive || !r?.plan) return;
        setData(r.plan);
        setDone(r.completed_days || []);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [isPro]);

  const days = useMemo(() => splitDays(data?.coach_plan), [data?.coach_plan]);

  if (!isPro || !data || !days?.length) return null;

  const pct = Math.round((done.length / days.length) * 100);

  async function toggle(d) {
    const was = done.includes(d.day);
    setDone((prev) => was
      ? prev.filter((x) => x !== d.day)
      : [...prev, d.day].sort((a, b) => a - b));
    try {
      const r = await api.setCoachDay(data.id, d.day, !was, d.topic);
      if (Array.isArray(r?.completed_days)) setDone(r.completed_days);
    } catch {
      setDone((prev) => was
        ? [...prev, d.day].sort((a, b) => a - b)
        : prev.filter((x) => x !== d.day));
    }
  }

  return (
    <Card style={{
      padding: 20, marginBottom: 24,
      background: `linear-gradient(180deg, ${T.violet}0c, transparent 55%), ${T.surface}`,
      borderColor: T.borderHi,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 13,
                    flexWrap: "wrap" }}>
        <IconTile name="sparkle" color={T.violet} size={34} iconSize={16} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Your training plan</div>
          <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 3 }}>
            Pinned from your {data.cf_handle} analysis
            {data.coach_written_at && (
              <> · {new Date(data.coach_written_at).toLocaleDateString(undefined,
                { dateStyle: "medium" })}</>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: font.mono, fontSize: 18, fontWeight: 800,
                         color: pct === 100 ? T.good : T.text }}>
            {pct}%
          </span>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Collapse plan" : "Expand plan"}
            style={{ background: "none", border: "none", cursor: "pointer",
                     color: T.textFaint, display: "flex", padding: 4,
                     transform: open ? "rotate(180deg)" : "none",
                     transition: "transform .18s" }}
          >
            <Icon name="chevron" size={16} />
          </button>
        </div>
      </div>

      <div style={{ marginTop: 14, height: 6, borderRadius: 99,
                    background: T.bgAlt, overflow: "hidden" }}>
        <m.div
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4 }}
          style={{ height: "100%",
                   background: pct === 100 ? T.good : T.violet }}
        />
      </div>

      {pct === 100 && (
        <div style={{ marginTop: 12, fontSize: 13, color: T.good,
                      display: "flex", alignItems: "center", gap: 7 }}>
          <Icon name="checkCircle" size={14} />
          Whole week done. Run a fresh analysis to see what moved.
        </div>
      )}

      {open && (
        <div className="coach-plan" style={{ marginTop: 16 }}>
          {days.map((d) => {
            const checked = done.includes(d.day);
            return (
              <div key={d.day} style={{ display: "flex", gap: 11,
                                        alignItems: "flex-start" }}>
                <label style={{ display: "flex", alignItems: "center",
                                paddingTop: 16, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(d)}
                    aria-label={`Mark day ${d.day} complete`}
                    style={{ width: 17, height: 17, accentColor: T.good,
                             cursor: "pointer" }}
                  />
                </label>
                <div
                  style={{ flex: 1, minWidth: 0, opacity: checked ? 0.55 : 1,
                           transition: "opacity .18s" }}
                  dangerouslySetInnerHTML={{ __html: d.html }}
                />
              </div>
            );
          })}
        </div>
      )}

      {onOpenRun && (
        <button
          type="button"
          onClick={() => onOpenRun(data.id, data.cf_handle)}
          style={{ marginTop: 12, background: "none", border: "none",
                   padding: 0, cursor: "pointer", color: T.accent,
                   fontSize: 12.5, fontWeight: 600, fontFamily: font.sans }}
        >
          Open the full analysis
        </button>
      )}
    </Card>
  );
}
