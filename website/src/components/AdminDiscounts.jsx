import { useState, useEffect, useCallback } from "react";
import { m, AnimatePresence } from "framer-motion";
import { T, font } from "../lib/theme.js";
import { api } from "../lib/api.js";
import { Button, Input, Card, Badge, Field } from "./ui.jsx";

/** Admin surface for promo codes: create, deactivate, delete. */
export default function AdminDiscounts() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const blank = { code: "", percent_off: "", max_uses: "", expires_at: "", note: "" };
  const [form, setForm] = useState(blank);

  const load = useCallback(async () => {
    try {
      const r = await api.adminDiscounts();
      setList(r.discounts || []);
    } catch (err) {
      setError(err.message || "Could not load codes.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  async function create(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api.adminCreateDiscount({
        code: form.code.trim().toUpperCase(),
        percent_off: Number(form.percent_off),
        max_uses: Number(form.max_uses),
        // datetime-local gives no timezone; treat it as the admin's local time.
        expires_at: new Date(form.expires_at).toISOString(),
        note: form.note.trim() || null,
      });
      setForm(blank);
      await load();
    } catch (err) {
      setError(err.message || "Could not create that code.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(d) {
    try { await api.adminSetDiscount(d.id, !d.active); await load(); }
    catch (err) { setError(err.message); }
  }

  async function remove(d) {
    if (!window.confirm(`Delete ${d.code}? This cannot be undone.`)) return;
    try { await api.adminDeleteDiscount(d.id); await load(); }
    catch (err) { setError(err.message); }
  }

  const valid = form.code.trim().length >= 3 && Number(form.percent_off) >= 1
    && Number(form.percent_off) <= 100 && Number(form.max_uses) >= 1
    && form.expires_at;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Card style={{ padding: 22 }}>
        <h3 style={{ fontSize: 16.5, fontWeight: 700, margin: "0 0 4px" }}>
          Create a discount code
        </h3>
        <p style={{ color: T.textDim, fontSize: 13.5, margin: "0 0 18px" }}>
          Codes apply to the Plus plan. They stop working once the uses run out
          or the deadline passes, whichever comes first.
        </p>

        <form onSubmit={create} style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14,
                        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            <Field label="Code">
              <Input
                value={form.code}
                onChange={(e) => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="LAUNCH40"
                style={{ fontFamily: font.mono, letterSpacing: 1 }}
              />
            </Field>
            <Field label="Percent off">
              <Input type="number" min="1" max="100" value={form.percent_off}
                     onChange={(e) => setForm(f => ({ ...f, percent_off: e.target.value }))}
                     placeholder="40" />
            </Field>
            <Field label="Maximum uses">
              <Input type="number" min="1" value={form.max_uses}
                     onChange={(e) => setForm(f => ({ ...f, max_uses: e.target.value }))}
                     placeholder="100" />
            </Field>
            <Field label="Expires">
              <Input type="datetime-local" value={form.expires_at}
                     onChange={(e) => setForm(f => ({ ...f, expires_at: e.target.value }))} />
            </Field>
          </div>

          <Field label="Note" hint="Only you see this.">
            <Input value={form.note}
                   onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))}
                   placeholder="Launch week promo" />
          </Field>

          {form.percent_off && Number(form.percent_off) > 0 && Number(form.percent_off) <= 100 && (
            <div style={{ fontSize: 13, color: T.textDim }}>
              Plus becomes{" "}
              <strong style={{ color: T.text, fontFamily: font.mono }}>
                {Math.round(399 * (1 - Number(form.percent_off) / 100))} EGP
              </strong>{" "}
              per month, down from 399.
            </div>
          )}

          {error && <div style={{ fontSize: 13, color: T.risk }}>{error}</div>}

          <div>
            <Button type="submit" loading={busy} disabled={!valid || busy}>
              Create code
            </Button>
          </div>
        </form>
      </Card>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${T.border}` }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
            Codes {list.length > 0 && (
              <span style={{ color: T.textFaint, fontWeight: 500 }}>({list.length})</span>
            )}
          </h3>
        </div>

        {loading ? (
          <div style={{ padding: 28, color: T.textFaint, fontSize: 13.5 }}>Loading…</div>
        ) : list.length === 0 ? (
          <div style={{ padding: 28, color: T.textFaint, fontSize: 13.5 }}>
            No codes yet.
          </div>
        ) : (
          <div style={{ display: "grid" }}>
            <AnimatePresence initial={false}>
              {list.map((d) => (
                <m.div
                  key={d.id}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}
                  style={{
                    display: "grid", gap: 12, alignItems: "center",
                    gridTemplateColumns: "minmax(110px,1.1fr) 70px 1.2fr 1.3fr auto",
                    padding: "14px 22px", borderTop: `1px solid ${T.border}`,
                  }}
                >
                  <span style={{ fontFamily: font.mono, fontWeight: 700, fontSize: 13.5 }}>
                    {d.code}
                  </span>
                  <Badge color={d.redeemable ? T.accent : T.textFaint}>
                    {d.percent_off}%
                  </Badge>
                  <Uses used={d.used_count} max={d.max_uses} />
                  <Expiry at={d.expires_at} active={d.active} redeemable={d.redeemable}
                          exhausted={d.used_count >= d.max_uses} />
                  <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
                    <Button variant="ghost" size="sm" onClick={() => toggle(d)}>
                      {d.active ? "Pause" : "Resume"}
                    </Button>
                    {d.used_count === 0 && (
                      <Button variant="ghost" size="sm" onClick={() => remove(d)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </m.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </Card>
    </div>
  );
}

function Uses({ used, max }) {
  const pct = Math.min(100, (used / max) * 100);
  const full = used >= max;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div style={{ flex: 1, height: 4, background: T.bgAlt, borderRadius: 999,
                    minWidth: 40 }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999,
                      background: full ? T.risk : T.accent }} />
      </div>
      <span style={{ fontFamily: font.mono, fontSize: 12, color: T.textDim,
                     whiteSpace: "nowrap" }}>
        {used}/{max}
      </span>
    </div>
  );
}

function Expiry({ at, active, redeemable, exhausted }) {
  // The server already decided whether this code is redeemable, so we do not
  // re-derive it from the browser clock (which is impure during render and
  // may disagree with the server anyway).
  const d = new Date(at);
  const label = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  let state = "Live", color = T.good;
  if (!active)          { state = "Paused";  color = T.textFaint; }
  else if (exhausted)   { state = "Used up"; color = T.warn; }
  else if (!redeemable) { state = "Expired"; color = T.risk; }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5 }}>
      <span style={{ color, fontWeight: 600 }}>{state}</span>
      <span style={{ color: T.textFaint }}>· {label}</span>
    </div>
  );
}
