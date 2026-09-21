// Sign-up, sign-in, sign-out, profile.

import express from "express";
import { z } from "zod";
import fetch from "node-fetch";
import { query } from "../db/pool.js";
import {
  COOKIE_NAME, cookieOptions, hashPassword, verifyPassword,
  createSession, destroySession, requireAuth, clientIp,
  recentFailures, recordAttempt,
} from "../middleware/auth.js";
import {
  handleChangeWindow, otherHandleWindow, waitMessage,
} from "../services/quotas.js";

const router = express.Router();

// Only the three required fields are mandatory. Everything else is optional and
// can be filled in later from the profile page.
const signupSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(254),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .max(200, "Password is too long"),
  cf_handle: z.string().trim()
    .min(1, "Codeforces handle is required")
    .max(48)
    .regex(/^[A-Za-z0-9_.-]+$/, "Handles use letters, digits, dot, dash or underscore"),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

const profileSchema = z.object({
  full_name:   z.string().trim().max(120).optional().nullable(),
  phone:       z.string().trim().max(40).optional().nullable(),
  country:     z.string().trim().max(80).optional().nullable(),
  institution: z.string().trim().max(120).optional().nullable(),
  bio:         z.string().trim().max(600).optional().nullable(),
  cf_handle:   z.string().trim().min(1).max(48)
                .regex(/^[A-Za-z0-9_.-]+$/).optional(),
});

const publicUser = (u) => ({
  id: u.id, email: u.email, cf_handle: u.cf_handle, role: u.role,
  plan: u.plan, full_name: u.full_name, phone: u.phone, country: u.country,
  institution: u.institution, bio: u.bio, created_at: u.created_at,
  plus_expires_at: u.plus_expires_at ?? null,
  // Admins are exempt from both limits, so the client is told as much rather
  // than being shown a countdown that does not apply to them.
  limits: u.role === "admin" ? null : {
    handle_change: handleChangeWindow(u),
    other_handle:  otherHandleWindow(u),
  },
});

/** Confirm the handle exists on Codeforces, so a typo is caught at sign-up. */
async function codeforcesHandleExists(handle) {
  try {
    const r = await fetch(
      `https://codeforces.com/api/user.info?handles=${encodeURIComponent(handle)}`,
      { timeout: 8000 }
    );
    const j = await r.json();
    return j.status === "OK" && Array.isArray(j.result) && j.result.length > 0;
  } catch {
    // If Codeforces is unreachable, do not block sign-up on it.
    return true;
  }
}

router.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { email, password, cf_handle } = parsed.data;
  const emailLower = email.toLowerCase();

  try {
    const exists = await query(
      `SELECT 1 FROM accounts WHERE email_lower = $1`, [emailLower]);
    if (exists.rowCount) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    if (!(await codeforcesHandleExists(cf_handle))) {
      return res.status(400).json({
        error: `Codeforces has no user named "${cf_handle}". Check the spelling.`,
      });
    }

    const password_hash = await hashPassword(password);
    // The first account to register becomes the admin, so a fresh deployment
    // has someone who can reach the admin area without manual SQL.
    const { rows: countRows } = await query(`SELECT count(*)::int AS n FROM accounts`);
    const role = countRows[0].n === 0 ? "admin" : "user";

    const { rows } = await query(
      `INSERT INTO accounts (email, email_lower, password_hash, cf_handle, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [email, emailLower, password_hash, cf_handle, role]
    );
    const user = rows[0];
    const token = await createSession(user.id, req);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    console.error("signup failed:", err.message);
    res.status(500).json({ error: "Could not create the account. Try again." });
  }
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Enter your email and password" });
  }
  const { email, password } = parsed.data;
  const emailLower = email.toLowerCase();
  const ip = clientIp(req);

  try {
    const fails = await recentFailures(emailLower, ip);
    if (fails.byEmail >= 8 || fails.byIp >= 25) {
      return res.status(429).json({
        error: "Too many failed attempts. Wait 15 minutes and try again.",
      });
    }

    const { rows } = await query(
      `SELECT * FROM accounts WHERE email_lower = $1`, [emailLower]);
    const user = rows[0];

    // Always run a comparison so a missing account and a wrong password take
    // the same time — otherwise response timing reveals which emails exist.
    const hash = user?.password_hash
      || "$2a$12$" + "x".repeat(53);
    const ok = await verifyPassword(password, hash);

    if (!user || !ok) {
      await recordAttempt(emailLower, ip, false);
      return res.status(401).json({ error: "Email or password is incorrect" });
    }
    if (user.status === "suspended") {
      await recordAttempt(emailLower, ip, false);
      return res.status(403).json({
        error: "This account has been suspended. Contact support.",
      });
    }

    await recordAttempt(emailLower, ip, true);
    await query(`UPDATE accounts SET last_login_at = now() WHERE id = $1`, [user.id]);
    const token = await createSession(user.id, req);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("login failed:", err.message);
    res.status(500).json({ error: "Could not sign in. Try again." });
  }
});

router.post("/logout", async (req, res) => {
  await destroySession(req.cookies?.[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: publicUser(req.user) });
});

router.patch("/me", requireAuth, async (req, res) => {
  const parsed = profileSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const fields = parsed.data;

  const changingHandle =
    fields.cf_handle &&
    fields.cf_handle.toLowerCase() !== String(req.user.cf_handle).toLowerCase();

  if (changingHandle) {
    // A handle may be relinked once every 6 months. Admins are exempt: they
    // manage accounts and must be able to correct a wrong handle.
    if (req.user.role !== "admin") {
      const w = handleChangeWindow(req.user);
      if (!w.allowed) {
        return res.status(429).json({
          error: `Your Codeforces handle can only be changed once every `
               + `6 months. You can change it again ${waitMessage(w.days_remaining)}.`,
          code: "HANDLE_CHANGE_LOCKED",
          next_at: w.next_at,
          days_remaining: w.days_remaining,
        });
      }
    }
    if (!(await codeforcesHandleExists(fields.cf_handle))) {
      return res.status(400).json({
        error: `Codeforces has no user named "${fields.cf_handle}".`,
      });
    }
  } else if (fields.cf_handle) {
    // Same handle, possibly different capitalisation. Saving it must not
    // consume the 6-month allowance, so drop it from the update entirely.
    delete fields.cf_handle;
  }

  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return res.json({ user: publicUser(req.user) });

  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const values = keys.map((k) => (fields[k] === "" ? null : fields[k]));
  // One statement: the new handle and the spent allowance land together, so a
  // failure between them cannot leave a free extra change.
  const stamp = changingHandle && req.user.role !== "admin"
    ? ", cf_handle_changed_at = now()" : "";
  try {
    const { rows } = await query(
      `UPDATE accounts SET ${sets}, updated_at = now()${stamp}
        WHERE id = $1 RETURNING *`,
      [req.user.id, ...values]
    );
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    console.error("profile update failed:", err.message);
    res.status(500).json({ error: "Could not save your changes." });
  }
});

router.post("/password", requireAuth, async (req, res) => {
  const schema = z.object({
    current: z.string().min(1),
    next: z.string().min(8, "New password must be at least 8 characters").max(200),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  try {
    const { rows } = await query(
      `SELECT password_hash FROM accounts WHERE id = $1`, [req.user.id]);
    if (!(await verifyPassword(parsed.data.current, rows[0].password_hash))) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }
    await query(`UPDATE accounts SET password_hash = $2, updated_at = now()
                  WHERE id = $1`,
                [req.user.id, await hashPassword(parsed.data.next)]);
    // Invalidate other sessions after a password change.
    await query(`DELETE FROM sessions WHERE account_id = $1`, [req.user.id]);
    const token = await createSession(req.user.id, req);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({ ok: true });
  } catch (err) {
    console.error("password change failed:", err.message);
    res.status(500).json({ error: "Could not change the password." });
  }
});

export default router;
