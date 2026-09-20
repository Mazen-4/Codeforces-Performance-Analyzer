import { useState } from "react";
import { T } from "../lib/theme.js";
import { useAuth } from "../lib/auth.jsx";
import { api } from "../lib/api.js";
import { Button, Field, Input, Card, Badge, Toast } from "../components/ui.jsx";

export default function Profile() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({
    cf_handle: user?.cf_handle || "", full_name: user?.full_name || "",
    phone: user?.phone || "", country: user?.country || "",
    institution: user?.institution || "", bio: user?.bio || "",
  });
  const [pw, setPw] = useState({ current: "", next: "" });
  const [busy, setBusy] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault(); setBusy(true);
    try {
      const { user: updated } = await api.updateMe(form);
      setUser(updated);
      setToast({ message: "Profile saved.", tone: "ok" });
    } catch (err) {
      setToast({ message: err.message, tone: "error" });
    } finally { setBusy(false); }
  }

  async function changePassword(e) {
    e.preventDefault(); setPwBusy(true);
    try {
      await api.changePassword(pw);
      setPw({ current: "", next: "" });
      setToast({ message: "Password updated.", tone: "ok" });
    } catch (err) {
      setToast({ message: err.message, tone: "error" });
    } finally { setPwBusy(false); }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "36px 22px 90px" }}>
      <h1 style={{ fontSize: 28, fontWeight: 780, margin: "0 0 6px",
                   letterSpacing: -0.7 }}>Your profile</h1>
      <p style={{ color: T.textDim, fontSize: 14.5, margin: "0 0 26px" }}>
        Only your handle, email and password are required. The rest is yours to fill in.
      </p>

      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 20,
                      alignItems: "center", flexWrap: "wrap" }}>
          <Badge color={user?.plan === "pro" ? T.violet : T.textFaint}>
            {user?.plan === "pro" ? "Pro plan" : "Free plan"}
          </Badge>
          {user?.role === "admin" && <Badge color={T.warn}>Administrator</Badge>}
          <span style={{ fontSize: 13, color: T.textFaint }}>{user?.email}</span>
        </div>

        <form onSubmit={save}>
          <Field label="Codeforces handle" required>
            <Input value={form.cf_handle} onChange={set("cf_handle")} required />
          </Field>
          <div style={{ display: "grid", gap: 0,
                        gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                        columnGap: 16 }}>
            <Field label="Full name">
              <Input value={form.full_name} onChange={set("full_name")}
                     placeholder="Ada Lovelace" />
            </Field>
            <Field label="Country">
              <Input value={form.country} onChange={set("country")}
                     placeholder="Egypt" />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={set("phone")}
                     placeholder="+20 100 000 0000" />
            </Field>
            <Field label="University or company">
              <Input value={form.institution} onChange={set("institution")}
                     placeholder="Cairo University" />
            </Field>
          </div>
          <Field label="About you">
            <Input as="input" value={form.bio} onChange={set("bio")}
                   placeholder="Aiming for Candidate Master this year" />
          </Field>
          <Button type="submit" loading={busy} disabled={busy}>Save changes</Button>
        </form>
      </Card>

      <Card>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 16px" }}>
          Change password
        </h2>
        <form onSubmit={changePassword}>
          <Field label="Current password" required>
            <Input type="password" value={pw.current} required
                   autoComplete="current-password"
                   onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} />
          </Field>
          <Field label="New password" required hint="At least 8 characters.">
            <Input type="password" value={pw.next} required
                   autoComplete="new-password"
                   onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} />
          </Field>
          <Button type="submit" variant="subtle" loading={pwBusy} disabled={pwBusy}>
            Update password
          </Button>
        </form>
      </Card>

      <Toast message={toast?.message} tone={toast?.tone}
             onDone={() => setToast(null)} />
    </div>
  );
}
