import { useState, useEffect } from "react";
import { m } from "framer-motion";
import { T, font } from "../lib/theme.js";
import { api } from "../lib/api.js";
import { Card, Spinner } from "./ui.jsx";
import Icon from "./Icon.jsx";

/** Do people actually follow the plans?
 *
 *  This is the signal for tuning how the coach writes them: a plan nobody
 *  finishes past day 3 says days 4-7 are too ambitious, not that students are
 *  lazy. Day-by-day drop-off is the most actionable view, so it leads. */
export default function AdminCoachStats() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.adminCoachStats?.()
      .then((r) => { if (alive) setData(r); })
      .catch((e) => { if (alive) setError(e.message || "Could not load stats."); });
    return () => { alive = false; };
  }, []);

  if (error) {
    return <Card style={{ padding: 22, color: T.risk, fontSize: 13.5 }}>{error}</Card>;
  }
  if (!data) {
    return (
      <div style={{ padding: 40, display: "grid", placeItems: "center" }}>
        <Spinner size={22} color={T.accent} />
      </div>
    );
  }

  const o = data.overall || {};
  if (!o.plans) {
    return (
      <Card style={{ padding: 26, textAlign: "center" }}>
        <div style={{ color: T.textFaint, display: "flex", justifyContent: "center",
                      marginBottom: 10 }}>
          <Icon name="sparkle" size={22} />
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 5 }}>
          No plans generated yet
        </div>
        <p style={{ fontSize: 13, color: T.textDim, margin: 0, lineHeight: 1.6 }}>
          Completion data appears once Plus members start generating and
          ticking off plans.
        </p>
      </Card>
    );
  }

  const maxDay = Math.max(1, ...(data.by_day || []).map(d => d.completed));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Headline */}
      <div style={{ display: "grid", gap: 12,
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <Stat label="Plans generated" value={o.plans} />
        <Stat label="Started" value={`${o.started} · ${o.start_rate}%`}
              hint="At least one day ticked" />
        <Stat label="Finished" value={o.finished}
              tone={o.finished ? T.good : undefined}
              hint="Every day ticked" />
        <Stat label="Days completed"
              value={`${o.completion_percent}%`}
              tone={o.completion_percent >= 50 ? T.good : T.warn}
              hint={`${o.days_done} of ${o.days_total}`} />
      </div>

      {/* Drop-off */}
      <Card style={{ padding: 20 }}>
        <SectionTitle
          title="Where people stop"
          note="Days ticked across all plans. A cliff here is the day the plan gets unrealistic."
        />
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {(data.by_day || []).map((d) => (
            <div key={d.day_number} style={{ display: "flex", alignItems: "center",
                                             gap: 11 }}>
              <span style={{ width: 46, fontSize: 12, color: T.textFaint,
                             fontFamily: font.mono }}>
                Day {d.day_number}
              </span>
              <div style={{ flex: 1, height: 20, borderRadius: 6,
                            background: T.bgAlt, overflow: "hidden" }}>
                <m.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(d.completed / maxDay) * 100}%` }}
                  transition={{ duration: 0.45, delay: d.day_number * 0.04 }}
                  style={{ height: "100%",
                           background: `linear-gradient(90deg, ${T.violet}, ${T.accent})` }}
                />
              </div>
              <span style={{ width: 62, textAlign: "right", fontSize: 12.5,
                             fontFamily: font.mono, color: T.textDim }}>
                {d.completed}
                {d.eligible > 0 && (
                  <span style={{ color: T.textFaint }}>
                    {" "}/{d.eligible}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* By topic */}
      {(data.by_topic || []).length > 0 && (
        <Card style={{ padding: 20 }}>
          <SectionTitle
            title="Completed days by topic"
            note="Topics low on this list may be producing days that are too hard."
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            {data.by_topic.map((t) => (
              <span key={t.topic} style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "6px 11px", borderRadius: 999,
                background: T.bgAlt, border: `1px solid ${T.border}`,
                fontSize: 12.5, color: T.textDim,
              }}>
                {t.topic}
                <strong style={{ color: T.text, fontFamily: font.mono }}>
                  {t.completed}
                </strong>
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Per user */}
      <Card style={{ padding: 20 }}>
        <SectionTitle title="Per plan" note="Most recently active first." />
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse",
                          fontSize: 13 }}>
            <thead>
              <tr style={{ color: T.textFaint, fontSize: 11.5,
                           textTransform: "uppercase", letterSpacing: 0.5 }}>
                <Th>Account</Th><Th>Handle</Th><Th>Progress</Th>
                <Th>Last activity</Th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.run_id} style={{ borderTop: `1px solid ${T.border}` }}>
                  <Td>
                    {u.email}
                    {u.pinned && (
                      <span style={{ marginLeft: 7, fontSize: 11, color: T.violet }}>
                        pinned
                      </span>
                    )}
                  </Td>
                  <Td mono>{u.cf_handle}</Td>
                  <Td>
                    <span style={{
                      fontFamily: font.mono,
                      color: u.percent === 100 ? T.good
                           : u.percent === 0 ? T.textFaint : T.text,
                    }}>
                      {u.days_done}/{u.day_count} · {u.percent}%
                    </span>
                  </Td>
                  <Td dim>
                    {u.last_activity
                      ? new Date(u.last_activity).toLocaleDateString(undefined,
                          { dateStyle: "medium" })
                      : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SectionTitle({ title, note }) {
  return (
    <div>
      <div style={{ fontSize: 14.5, fontWeight: 700 }}>{title}</div>
      {note && (
        <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 4,
                      lineHeight: 1.55 }}>
          {note}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }) {
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ fontSize: 11.5, color: T.textFaint, letterSpacing: 0.5,
                    textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6,
                    fontFamily: font.mono, color: tone || T.text }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 3 }}>
          {hint}
        </div>
      )}
    </Card>
  );
}

const Th = ({ children }) => (
  <th style={{ textAlign: "left", padding: "7px 10px", fontWeight: 600 }}>
    {children}
  </th>
);
const Td = ({ children, mono, dim }) => (
  <td style={{ padding: "10px", color: dim ? T.textFaint : T.textDim,
               fontFamily: mono ? font.mono : undefined }}>
    {children}
  </td>
);
