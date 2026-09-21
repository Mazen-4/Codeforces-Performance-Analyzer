import { useState, useEffect, useCallback } from "react";
import { m, AnimatePresence } from "framer-motion";
import { T, font } from "../lib/theme.js";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import {
  Button, Input, Card, Badge, Spinner, Field, Toast, Stat,
} from "../components/ui.jsx";
import { tagInfo } from "../lib/copy.js";
import AdminDiscounts from "../components/AdminDiscounts.jsx";
import AdminCoach from "../components/AdminCoach.jsx";
import AdminPayments from "../components/AdminPayments.jsx";

export default function Admin() {
  const [tab, setTab] = useState("users");
  const [stats, setStats] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    api.admin.stats().then(setStats).catch(() => {});
  }, []);

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "32px 22px 90px" }}>
      <h1 style={{ fontSize: 27, fontWeight: 780, margin: "0 0 4px",
                   letterSpacing: -0.7 }}>Admin</h1>
      <p style={{ color: T.textDim, fontSize: 14, margin: "0 0 24px" }}>
        Accounts, activity and plans.
      </p>

      {stats && (
        <div style={{ display: "grid", gap: 14, marginBottom: 26,
                      gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))" }}>
          <StatCard label="Total users"     value={stats.total_users}     color={T.accent} />
          <StatCard label="Pro plan"        value={stats.pro_users}       color={T.violet} />
          <StatCard label="New this week"   value={stats.new_this_week}   color={T.good} />
          <StatCard label="Active this week"value={stats.active_this_week}color={T.cyan} />
          <StatCard label="Searches today"  value={stats.searches_today}  color={T.warn} />
          <StatCard label="Suspended"       value={stats.suspended}
                    color={stats.suspended ? T.risk : T.textFaint} />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[["users", "Users"], ["activity", "Activity"], ["discounts", "Discounts"], ["coach", "AI Coach"], ["payments", "Payments"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: "9px 18px", borderRadius: 9, cursor: "pointer",
            fontFamily: font.sans, fontSize: 14, fontWeight: 620,
            background: tab === id ? T.surfaceHi : "transparent",
            border: `1px solid ${tab === id ? T.borderHi : "transparent"}`,
            color: tab === id ? T.text : T.textDim,
          }}>{label}</button>
        ))}
      </div>

      {tab === "users"     && <Users onToast={setToast} />}
      {tab === "activity"  && <Activity />}
      {tab === "discounts" && <AdminDiscounts />}
      {tab === "coach"     && <AdminCoach />}
      {tab === "payments"  && <AdminPayments />}
      <Toast message={toast?.message} tone={toast?.tone} onDone={() => setToast(null)} />
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <Card style={{ padding: 18 }} hover>
      <div style={{ fontSize: 30, fontWeight: 800, color,
                    fontFamily: font.mono, letterSpacing: -1 }}>
        <Stat value={value} />
      </div>
      <div style={{ fontSize: 12.5, color: T.textDim, marginTop: 5 }}>{label}</div>
    </Card>
  );
}

function Users({ onToast }) {
  const { user: me } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.admin.users({ q, plan, limit: 100 });
      setRows(r.users); setTotal(r.total);
    } catch (err) {
      onToast({ message: err.message, tone: "error" });
    } finally { setLoading(false); }
  }, [q, plan, onToast]);

  useEffect(() => { const t = setTimeout(load, 220); return () => clearTimeout(t); }, [load]);

  async function remove(u) {
    try {
      await api.admin.remove(u.id);
      onToast({ message: `Deleted ${u.email}.`, tone: "ok" });
      setConfirmDelete(null);
      load();
    } catch (err) { onToast({ message: err.message, tone: "error" }); }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Search email, handle or name"
               style={{ flex: 1, minWidth: 220 }} />
        <select value={plan} onChange={(e) => setPlan(e.target.value)}
          style={{
            padding: "12px 14px", borderRadius: 10, fontSize: 14,
            background: T.bgAlt, color: T.text, fontFamily: font.sans,
            border: `1px solid ${T.border}`, outline: "none", cursor: "pointer",
          }}>
          <option value="">All plans</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
        </select>
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 46, textAlign: "center" }}><Spinner size={22} /></div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 46, textAlign: "center", color: T.textDim }}>
            No accounts match that search.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse",
                            fontSize: 13.5, minWidth: 880 }}>
              <thead>
                <tr style={{ background: T.bgAlt }}>
                  {["User", "Handle", "Plan", "Role", "Status", "Searches",
                    "Last active", ""].map((h) => (
                    <th key={h} style={{
                      textAlign: "left", padding: "12px 14px", fontWeight: 650,
                      color: T.textDim, fontSize: 12, letterSpacing: 0.3,
                      textTransform: "uppercase", whiteSpace: "nowrap",
                      borderBottom: `1px solid ${T.border}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{u.full_name || "—"}</div>
                      <div style={{ color: T.textFaint, fontSize: 12.5 }}>{u.email}</div>
                    </td>
                    <td style={{ ...td, fontFamily: font.mono, fontSize: 12.5 }}>
                      {u.cf_handle}
                    </td>
                    <td style={td}>
                      <Badge color={u.plan === "pro" ? T.violet : T.textFaint}>
                        {u.plan}
                      </Badge>
                    </td>
                    <td style={td}>
                      {u.role === "admin"
                        ? <Badge color={T.warn}>admin</Badge>
                        : <span style={{ color: T.textFaint }}>user</span>}
                    </td>
                    <td style={td}>
                      <Badge color={u.status === "active" ? T.good : T.risk}>
                        {u.status}
                      </Badge>
                    </td>
                    <td style={{ ...td, fontFamily: font.mono }}>{u.search_count}</td>
                    <td style={{ ...td, color: T.textFaint, fontSize: 12.5,
                                 whiteSpace: "nowrap" }}>
                      {u.last_search_at
                        ? new Date(u.last_search_at).toLocaleDateString()
                        : "never"}
                    </td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      <Button size="sm" variant="subtle"
                              onClick={() => setEditing(u)}>Edit</Button>
                      {u.id !== me.id && (
                        <Button size="sm" variant="danger" style={{ marginLeft: 6 }}
                                onClick={() => setConfirmDelete(u)}>Delete</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div style={{ marginTop: 10, fontSize: 12.5, color: T.textFaint }}>
        Showing {rows.length} of {total}
      </div>

      <AnimatePresence>
        {editing && (
          <EditModal user={editing} onClose={() => setEditing(null)}
                     onSaved={() => { setEditing(null); load(); }}
                     onToast={onToast} />
        )}
        {confirmDelete && (
          <Modal onClose={() => setConfirmDelete(null)}>
            <h3 style={{ margin: "0 0 10px", fontSize: 19, fontWeight: 720 }}>
              Delete this account?
            </h3>
            <p style={{ color: T.textDim, fontSize: 14, lineHeight: 1.6,
                        margin: "0 0 22px" }}>
              <strong style={{ color: T.text }}>{confirmDelete.email}</strong> and
              all of their search history will be permanently removed. This cannot
              be undone.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => remove(confirmDelete)}>
                Delete permanently
              </Button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}

const td = { padding: "12px 14px", verticalAlign: "middle" };

function EditModal({ user, onClose, onSaved, onToast }) {
  const [f, setF] = useState({
    email: user.email, cf_handle: user.cf_handle,
    full_name: user.full_name || "", country: user.country || "",
    role: user.role, plan: user.plan, status: user.status, password: "",
  });
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    api.admin.user(user.id).then(setDetail).catch(() => {});
  }, [user.id]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault(); setBusy(true);
    const body = { ...f };
    if (!body.password) delete body.password;
    try {
      await api.admin.update(user.id, body);
      onToast({ message: "Account updated.", tone: "ok" });
      onSaved();
    } catch (err) {
      onToast({ message: err.message, tone: "error" });
    } finally { setBusy(false); }
  }

  return (
    <Modal onClose={onClose} wide>
      <h3 style={{ margin: "0 0 18px", fontSize: 19, fontWeight: 720 }}>
        Edit account
      </h3>
      <form onSubmit={save}>
        <div style={{ display: "grid", columnGap: 16,
                      gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
          <Field label="Email" required>
            <Input type="email" value={f.email} onChange={set("email")} required />
          </Field>
          <Field label="Codeforces handle" required>
            <Input value={f.cf_handle} onChange={set("cf_handle")} required />
          </Field>
          <Field label="Full name">
            <Input value={f.full_name} onChange={set("full_name")} />
          </Field>
          <Field label="Country">
            <Input value={f.country} onChange={set("country")} />
          </Field>
          <Field label="Role"><Select value={f.role} onChange={set("role")}
            options={[["user","User"],["admin","Admin"]]} /></Field>
          <Field label="Plan"><Select value={f.plan} onChange={set("plan")}
            options={[["free","Free"],["pro","Pro"]]} /></Field>
          <Field label="Status"><Select value={f.status} onChange={set("status")}
            options={[["active","Active"],["suspended","Suspended"]]} /></Field>
          <Field label="Reset password"
                 hint="Leave blank to keep the current one.">
            <Input type="password" value={f.password} onChange={set("password")}
                   placeholder="New password" autoComplete="new-password" />
          </Field>
        </div>

        {detail?.searches?.length > 0 && (
          <div style={{ marginTop: 6, marginBottom: 20 }}>
            <div style={{ fontSize: 12.5, fontWeight: 650, color: T.textDim,
                          marginBottom: 8 }}>
              Recent searches
            </div>
            <div style={{ maxHeight: 150, overflowY: "auto", display: "grid",
                          gap: 6 }}>
              {detail.searches.slice(0, 10).map((s) => (
                <div key={s.id} style={{
                  display: "flex", justifyContent: "space-between", gap: 10,
                  padding: "7px 10px", background: T.bgAlt, borderRadius: 7,
                  fontSize: 12.5,
                }}>
                  <span style={{ fontFamily: font.mono }}>{s.cf_handle}</span>
                  <span style={{ color: T.textFaint }}>
                    {s.weakest_tag ? tagInfo(s.weakest_tag).name : (s.ok ? "—" : "failed")}
                    {"  ·  "}
                    {new Date(s.searched_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end",
                      marginTop: 6 }}>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={onChange} style={{
      width: "100%", padding: "12px 14px", borderRadius: 10, fontSize: 14,
      background: T.bgAlt, color: T.text, fontFamily: font.sans,
      border: `1px solid ${T.border}`, outline: "none", cursor: "pointer",
      boxSizing: "border-box",
    }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function Modal({ children, onClose, wide }) {
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <m.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 150, display: "grid",
        placeItems: "center", padding: 20,
        background: "rgba(3,4,6,.78)", backdropFilter: "blur(6px)",
      }}
    >
      <m.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.22 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: wide ? 660 : 440, maxHeight: "88vh",
          overflowY: "auto", background: T.surface,
          border: `1px solid ${T.borderHi}`, borderRadius: 16, padding: 26,
          boxShadow: "0 30px 70px rgba(0,0,0,.6)",
        }}
      >
        {children}
      </m.div>
    </m.div>
  );
}

function Activity() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.admin.searches(150).then((r) => setRows(r.searches)).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Card style={{ padding: 46, textAlign: "center" }}><Spinner /></Card>;
  if (!rows.length) return (
    <Card style={{ padding: 46, textAlign: "center", color: T.textDim }}>
      No searches recorded yet.
    </Card>
  );

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse",
                        fontSize: 13.5, minWidth: 760 }}>
          <thead>
            <tr style={{ background: T.bgAlt }}>
              {["When", "Account", "Handle analysed", "Focus topic", "Result"]
                .map((h) => (
                <th key={h} style={{
                  textAlign: "left", padding: "12px 14px", fontWeight: 650,
                  color: T.textDim, fontSize: 12, textTransform: "uppercase",
                  letterSpacing: 0.3, borderBottom: `1px solid ${T.border}`,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td style={{ ...td, color: T.textFaint, whiteSpace: "nowrap" }}>
                  {new Date(s.searched_at).toLocaleString()}
                </td>
                <td style={td}>{s.email || <span style={{ color: T.textFaint }}>anonymous</span>}</td>
                <td style={{ ...td, fontFamily: font.mono, fontSize: 12.5 }}>
                  {s.cf_handle}
                </td>
                <td style={td}>
                  {s.weakest_tag ? tagInfo(s.weakest_tag).name
                                 : <span style={{ color: T.textFaint }}>—</span>}
                </td>
                <td style={td}>
                  <Badge color={s.ok ? T.good : T.risk}>
                    {s.ok ? "ok" : "failed"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
