// Admin surface: list, inspect, edit and delete accounts; review search activity.
// Every route sits behind requireAdmin.

import express from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireAdmin, hashPassword } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAdmin);

router.get("/stats", async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        (SELECT count(*) FROM accounts)                                   AS total_users,
        (SELECT count(*) FROM accounts WHERE plan = 'pro')                AS pro_users,
        (SELECT count(*) FROM accounts WHERE status = 'suspended')        AS suspended,
        (SELECT count(*) FROM accounts
          WHERE created_at > now() - interval '7 days')                   AS new_this_week,
        (SELECT count(*) FROM searches)                                   AS total_searches,
        (SELECT count(*) FROM searches
          WHERE searched_at > now() - interval '24 hours')                AS searches_today,
        (SELECT count(DISTINCT account_id) FROM searches
          WHERE searched_at > now() - interval '7 days')                  AS active_this_week
    `);
    const s = rows[0];
    res.json({
      total_users: Number(s.total_users),
      pro_users: Number(s.pro_users),
      suspended: Number(s.suspended),
      new_this_week: Number(s.new_this_week),
      total_searches: Number(s.total_searches),
      searches_today: Number(s.searches_today),
      active_this_week: Number(s.active_this_week),
    });
  } catch (err) {
    console.error("admin stats failed:", err.message);
    res.status(500).json({ error: "Could not load stats" });
  }
});

router.get("/users", async (req, res) => {
  const q     = (req.query.q || "").toString().trim().slice(0, 100);
  const plan  = (req.query.plan || "").toString();
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const where = [];
  const params = [];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(a.email_lower LIKE $${params.length}
                 OR lower(a.cf_handle) LIKE $${params.length}
                 OR lower(coalesce(a.full_name,'')) LIKE $${params.length})`);
  }
  if (plan === "free" || plan === "pro") {
    params.push(plan);
    where.push(`a.plan = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    params.push(limit, offset);
    const { rows } = await query(
      `SELECT a.id, a.email, a.cf_handle, a.role, a.plan, a.status,
              a.full_name, a.country, a.created_at, a.last_login_at,
              (SELECT count(*) FROM searches s WHERE s.account_id = a.id) AS search_count,
              (SELECT max(s.searched_at) FROM searches s WHERE s.account_id = a.id) AS last_search_at
         FROM accounts a
         ${whereSql}
         ORDER BY a.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows: countRows } = await query(
      `SELECT count(*)::int AS n FROM accounts a ${whereSql}`,
      params.slice(0, params.length - 2)
    );
    res.json({
      users: rows.map(r => ({ ...r, search_count: Number(r.search_count) })),
      total: countRows[0].n,
    });
  } catch (err) {
    console.error("admin users failed:", err.message);
    res.status(500).json({ error: "Could not load users" });
  }
});

router.get("/users/:id", async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, email, cf_handle, role, plan, status, full_name, phone,
              country, institution, bio, created_at, updated_at, last_login_at
         FROM accounts WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "User not found" });

    const { rows: searches } = await query(
      `SELECT id, cf_handle, searched_at, ok, duration_ms, cf_rating, weakest_tag, error
         FROM searches WHERE account_id = $1
         ORDER BY searched_at DESC LIMIT 50`, [req.params.id]);

    const { rows: sessions } = await query(
      `SELECT created_at, expires_at, user_agent, ip
         FROM sessions WHERE account_id = $1
         ORDER BY created_at DESC LIMIT 10`, [req.params.id]);

    res.json({ user: rows[0], searches, sessions });
  } catch (err) {
    console.error("admin user detail failed:", err.message);
    res.status(500).json({ error: "Could not load the user" });
  }
});

const adminEditSchema = z.object({
  email:       z.string().trim().email().max(254).optional(),
  cf_handle:   z.string().trim().min(1).max(48)
                .regex(/^[A-Za-z0-9_.-]+$/).optional(),
  full_name:   z.string().trim().max(120).optional().nullable(),
  phone:       z.string().trim().max(40).optional().nullable(),
  country:     z.string().trim().max(80).optional().nullable(),
  institution: z.string().trim().max(120).optional().nullable(),
  bio:         z.string().trim().max(600).optional().nullable(),
  role:        z.enum(["user", "admin"]).optional(),
  plan:        z.enum(["free", "pro"]).optional(),
  status:      z.enum(["active", "suspended"]).optional(),
  password:    z.string().min(8).max(200).optional(),
});

router.patch("/users/:id", async (req, res) => {
  const parsed = adminEditSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const fields = { ...parsed.data };
  const id = req.params.id;

  // An admin must not be able to lock everyone out by demoting or suspending
  // the last remaining admin.
  if (fields.role === "user" || fields.status === "suspended") {
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM accounts
        WHERE role = 'admin' AND status = 'active' AND id <> $1`, [id]);
    const target = await query(`SELECT role FROM accounts WHERE id = $1`, [id]);
    if (target.rows[0]?.role === "admin" && rows[0].n === 0) {
      return res.status(400).json({
        error: "This is the last active admin. Promote another account first.",
      });
    }
  }

  const updates = {};
  if (fields.password) {
    updates.password_hash = await hashPassword(fields.password);
    delete fields.password;
  }
  if (fields.email) {
    const emailLower = fields.email.toLowerCase();
    const clash = await query(
      `SELECT 1 FROM accounts WHERE email_lower = $1 AND id <> $2`,
      [emailLower, id]);
    if (clash.rowCount) {
      return res.status(409).json({ error: "Another account uses that email" });
    }
    updates.email = fields.email;
    updates.email_lower = emailLower;
    delete fields.email;
  }
  Object.assign(updates, fields);

  const keys = Object.keys(updates).filter(k => updates[k] !== undefined);
  if (!keys.length) return res.status(400).json({ error: "Nothing to update" });

  try {
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const values = keys.map(k => (updates[k] === "" ? null : updates[k]));
    const { rows } = await query(
      `UPDATE accounts SET ${sets}, updated_at = now()
        WHERE id = $1
        RETURNING id, email, cf_handle, role, plan, status, full_name,
                  phone, country, institution, bio, created_at, last_login_at`,
      [id, ...values]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });

    // Suspension must take effect immediately, not when the cookie expires.
    if (updates.status === "suspended" || updates.password_hash) {
      await query(`DELETE FROM sessions WHERE account_id = $1`, [id]);
    }
    res.json({ user: rows[0] });
  } catch (err) {
    console.error("admin edit failed:", err.message);
    res.status(500).json({ error: "Could not save the changes" });
  }
});

router.delete("/users/:id", async (req, res) => {
  const id = req.params.id;
  if (id === req.user.id) {
    return res.status(400).json({ error: "You cannot delete your own account here" });
  }
  try {
    const { rows } = await query(`SELECT role FROM accounts WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    if (rows[0].role === "admin") {
      const { rows: others } = await query(
        `SELECT count(*)::int AS n FROM accounts
          WHERE role = 'admin' AND id <> $1`, [id]);
      if (others[0].n === 0) {
        return res.status(400).json({ error: "Cannot delete the last admin" });
      }
    }
    // sessions and searches cascade via ON DELETE CASCADE.
    await query(`DELETE FROM accounts WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("admin delete failed:", err.message);
    res.status(500).json({ error: "Could not delete the account" });
  }
});

router.get("/searches", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 300);
  try {
    const { rows } = await query(
      `SELECT s.id, s.cf_handle, s.searched_at, s.ok, s.duration_ms,
              s.cf_rating, s.weakest_tag, s.error,
              a.email, a.id AS account_id
         FROM searches s
         LEFT JOIN accounts a ON a.id = s.account_id
        ORDER BY s.searched_at DESC
        LIMIT $1`, [limit]);
    res.json({ searches: rows });
  } catch (err) {
    console.error("admin searches failed:", err.message);
    res.status(500).json({ error: "Could not load searches" });
  }
});

export default router;
