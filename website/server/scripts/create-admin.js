/**
 * Create or promote an admin account.
 *
 * Normally the first account to sign up becomes the admin. This script covers
 * the other cases: seeding an admin on a database that already has users, or
 * promoting an existing account.
 *
 * Usage:
 *   DATABASE_URL=... node website/server/scripts/create-admin.js \
 *     --email you@example.com --handle your_cf_handle [--password '...']
 *
 * If --password is omitted a strong one is generated and printed once, which
 * is safer than passing a secret on the command line where it lands in shell
 * history and the process list.
 */

import { randomBytes } from "node:crypto";
import readline from "node:readline";
import bcrypt from "bcryptjs";
import { query, ensureSchema, dbEnabled } from "../db/pool.js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function generatePassword() {
  return randomBytes(18).toString("base64url");
}

async function prompt(qs) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(qs, res));
  rl.close();
  return answer.trim();
}

async function main() {
  if (!dbEnabled()) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const email  = (arg("email")  || "").trim();
  const handle = (arg("handle") || "").trim();
  let password = arg("password");

  if (!email || !handle) {
    console.error("Usage: --email <email> --handle <cf_handle> [--password <pw>]");
    process.exit(1);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`Not a valid email: ${email}`);
    process.exit(1);
  }
  if (!/^[A-Za-z0-9_.-]{1,48}$/.test(handle)) {
    console.error(`Not a valid Codeforces handle: ${handle}`);
    process.exit(1);
  }

  let generated = false;
  if (!password) { password = generatePassword(); generated = true; }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  await ensureSchema();

  const emailLower = email.toLowerCase();
  const existing = await query(
    `SELECT id, role FROM accounts WHERE email_lower = $1`, [emailLower]);

  const hash = await bcrypt.hash(password, 12);

  if (existing.rowCount) {
    const { id, role } = existing.rows[0];
    const confirm = process.argv.includes("--yes")
      ? "y"
      : await prompt(`${email} already exists (role: ${role}). Promote to admin and reset its password? [y/N] `);
    if (confirm.toLowerCase() !== "y") { console.log("Aborted."); process.exit(0); }

    await query(
      `UPDATE accounts
          SET role = 'admin', status = 'active', password_hash = $2,
              cf_handle = $3, updated_at = now()
        WHERE id = $1`, [id, hash, handle]);
    await query(`DELETE FROM sessions WHERE account_id = $1`, [id]);
    console.log(`Updated ${email} -> admin.`);
  } else {
    await query(
      `INSERT INTO accounts (email, email_lower, password_hash, cf_handle, role)
       VALUES ($1, $2, $3, $4, 'admin')`,
      [email, emailLower, hash, handle]);
    console.log(`Created admin ${email}.`);
  }

  if (generated) {
    console.log("\n  Password (shown once, store it now):\n");
    console.log(`    ${password}\n`);
  }
  console.log("Sign in, then change the password from the profile page.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
