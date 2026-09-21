import { useState, useEffect, useCallback } from "react";
import { m } from "framer-motion";
import { T, font } from "../lib/theme.js";
import { api } from "../lib/api.js";
import { Card, Button, Badge } from "./ui.jsx";
import Icon, { IconTile } from "./Icon.jsx";

/** Admin control for the AI Coach: which Claude model writes the plans. */
export default function AdminCoach() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setCfg(await api.adminCoach()); }
    catch (err) { setError(err.message || "Could not load settings."); }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function choose(id) {
    if (id === cfg?.model || saving) return;
    setSaving(id); setError("");
    try {
      await api.adminSetCoachModel(id);
      await load();
    } catch (err) {
      setError(err.message || "Could not save that.");
    } finally {
      setSaving("");
    }
  }

  if (!cfg) {
    return (
      <Card style={{ padding: 22 }}>
        <div style={{ color: T.textFaint, fontSize: 13.5 }}>
          {error || "Loading…"}
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Card style={{ padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11,
                      marginBottom: 6 }}>
          <IconTile name="sparkle" color={T.violet} size={32} iconSize={16} />
          <h3 style={{ fontSize: 16.5, fontWeight: 700, margin: 0 }}>AI Coach</h3>
          <Badge color={cfg.key_configured ? T.good : T.risk}
                 style={{ marginLeft: "auto" }}>
            {cfg.key_configured ? "Key configured" : "No API key"}
          </Badge>
        </div>

        {!cfg.key_configured && (
          <div style={{ display: "flex", gap: 11, alignItems: "flex-start",
                        padding: "13px 15px", borderRadius: T.radiusSm,
                        background: `${T.risk}0f`, border: `1px solid ${T.risk}44`,
                        margin: "14px 0 4px" }}>
            <span style={{ color: T.risk, marginTop: 1 }}>
              <Icon name="alert" size={15} />
            </span>
            <div style={{ fontSize: 13, color: T.textDim, lineHeight: 1.65 }}>
              Set <code style={{ fontFamily: font.mono, color: T.text }}>
              ANTHROPIC_API_KEY</code> in the Railway service variables, then
              redeploy. Until then the coach stays hidden for everyone.
            </div>
          </div>
        )}

        <p style={{ color: T.textDim, fontSize: 13.5, lineHeight: 1.6,
                    margin: "12px 0 18px" }}>
          Which Claude model writes the training plans. Takes effect within a
          minute — no redeploy.
        </p>

        <div style={{ display: "grid", gap: 10 }}>
          {cfg.choices.map((c) => {
            const active = c.id === cfg.model;
            return (
              <m.button
                key={c.id}
                onClick={() => choose(c.id)}
                whileHover={{ y: active ? 0 : -1 }}
                disabled={Boolean(saving)}
                style={{
                  display: "flex", alignItems: "center", gap: 13,
                  padding: "14px 16px", borderRadius: T.radiusSm,
                  cursor: active ? "default" : "pointer", textAlign: "left",
                  background: active ? T.surfaceHi : T.bgAlt,
                  border: `1px solid ${active ? T.accent : T.border}`,
                  color: T.text, fontFamily: font.sans,
                  opacity: saving && saving !== c.id ? 0.5 : 1,
                }}
              >
                <span style={{
                  width: 17, height: 17, borderRadius: 999, flexShrink: 0,
                  display: "grid", placeItems: "center",
                  border: `2px solid ${active ? T.accent : T.borderHi}`,
                }}>
                  {active && <span style={{ width: 7, height: 7,
                    borderRadius: 999, background: T.accent }} />}
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 650 }}>
                    {c.label}
                  </span>
                  <span style={{ display: "block", fontSize: 12.5,
                                 color: T.textFaint, marginTop: 3 }}>
                    {c.note}
                  </span>
                </span>
                <span style={{ fontFamily: font.mono, fontSize: 11.5,
                               color: T.textFaint }}>
                  {saving === c.id ? "saving…" : c.id}
                </span>
              </m.button>
            );
          })}
        </div>

        {error && (
          <div style={{ marginTop: 14, fontSize: 13, color: T.risk }}>{error}</div>
        )}
      </Card>

      <div style={{
        display: "grid", gap: 1, overflow: "hidden",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        borderRadius: T.radius, background: T.border,
        border: `1px solid ${T.border}`,
      }}>
        {[
          { icon: "sparkle", tone: T.violet, value: cfg.plans_generated, label: "plans generated" },
          { icon: "calendar", tone: T.accent, value: cfg.plans_last_30d, label: "in the last 30 days" },
          { icon: "gift", tone: T.good, value: cfg.free_trial_plans, label: "free trial plans" },
        ].map((s) => (
          <div key={s.label} style={{ background: T.surface, padding: "18px" }}>
            <span style={{ color: s.tone, display: "block", marginBottom: 10 }}>
              <Icon name={s.icon} size={17} strokeWidth={1.8} />
            </span>
            <div style={{ fontFamily: font.mono, fontSize: 23, fontWeight: 820,
                          color: s.tone, lineHeight: 1 }}>
              {s.value}
            </div>
            <div style={{ fontSize: 12, color: T.textFaint, marginTop: 6 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
