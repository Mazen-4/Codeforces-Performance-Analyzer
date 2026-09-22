// Verification + reset limits. No mail provider is configured here, so the
// send path is exercised down to the point of handing off to Resend.
import pg from "pg";
import { createHash } from "node:crypto";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_PUBLIC_URL,
                           ssl: { rejectUnauthorized: false } });
const q = (t, p) => pool.query(t, p);
const BASE = "http://127.0.0.1:5999";
const EMAIL = `auth-test-${Date.now()}@gmail.com`;
let pass = 0, fail = 0;
const check = (n, c, e = "") => { c ? pass++ : fail++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${e ? "  " + e : ""}`); };
const jf = async (path, opts = {}, cookie) => {
  const r = await fetch(BASE + path, { ...opts, headers: {
    "content-type": "application/json", "X-Client-Time": new Date().toISOString(),
    ...(cookie ? { cookie } : {}), ...(opts.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => ({})),
           setCookie: r.headers.get("set-cookie") };
};
const sha = v => createHash("sha256").update(String(v)).digest("hex");

try {
    console.log("=== 1. signup creates a PENDING row, not an account ===");
  const su = await jf("/api/auth/signup", { method: "POST",
    body: JSON.stringify({ email: EMAIL, password: "TestPass!2345", cf_handle: "tourist" }) });
  check("signup returns 202 pending", su.status === 202, `status ${su.status}`);
  check("no session issued yet", !su.setCookie);
  const { rows: noAcc } = await q("SELECT 1 FROM accounts WHERE email_lower=$1", [EMAIL.toLowerCase()]);
  check("no account yet", noAcc.length === 0);
  const { rows: pend } = await q("SELECT * FROM pending_signups WHERE email_lower=$1", [EMAIL.toLowerCase()]);
  check("pending row exists", pend.length === 1);
  check("terms version on pending row", pend[0]?.terms_version === "2026-09-22");

  // Confirm it so the rest of the suite has a real, verified account.
  await q("UPDATE pending_signups SET code_hash=$2 WHERE email_lower=$1",
          [EMAIL.toLowerCase(), sha("111111")]);
  const conf = await jf("/api/auth/signup/confirm", { method: "POST",
    body: JSON.stringify({ email: EMAIL, code: "111111" }) });
  check("confirm creates the account", conf.status === 201, `status ${conf.status}`);
  check("account is verified on creation", conf.body.user?.email_verified === true);
  const cookie = conf.setCookie.split(";")[0];
  const { rows: [a] } = await q(
    "SELECT id, email_verified, terms_accepted_at, terms_accepted_version FROM accounts WHERE email_lower=$1",
    [EMAIL.toLowerCase()]);
  check("db: verified true", a.email_verified === true);
  check("db: terms recorded", Boolean(a.terms_accepted_at));

  console.log("\n=== 2. unverified accounts are blocked from paid surfaces ===");
  await q("UPDATE accounts SET email_verified=false WHERE id=$1", [a.id]);
  const an = await jf("/api/ml/analyze/tourist", {}, cookie);
  check("analysis blocked 403", an.status === 403, `status ${an.status}`);
  check("code EMAIL_UNVERIFIED", an.body.code === "EMAIL_UNVERIFIED");
  const co = await jf("/api/coach", { method: "POST",
    body: JSON.stringify({ handle: "tourist", estimatedRating: 3000 }) }, cookie);
  check("coach blocked", co.body.code === "EMAIL_UNVERIFIED", `got ${co.body.code}`);

  console.log("\n=== 3. email cannot be changed ===");
  const em = await jf("/api/auth/email", { method: "PATCH",
    body: JSON.stringify({ email: "new@example.invalid" }) }, cookie);
  check("PATCH /email refused 403", em.status === 403, `status ${em.status}`);
  check("code EMAIL_LOCKED", em.body.code === "EMAIL_LOCKED");
  check("points at the discussion channel", /discussions/.test(em.body.contact_url || ""));
  const pm = await jf("/api/auth/me", { method: "PATCH",
    body: JSON.stringify({ email: "sneaky@example.invalid", full_name: "X" }) }, cookie);
  const { rows: [still] } = await q("SELECT email_lower FROM accounts WHERE id=$1", [a.id]);
  check("PATCH /me cannot smuggle an email change",
        still.email_lower === EMAIL.toLowerCase(), `db has ${still.email_lower}`);

  console.log("\n=== 4. wrong code is refused and counted ===");
  // Insert a live token directly: /resend is rate-limited by the signup send,
  // and this section is testing code checking, not the send window.
  await q(`INSERT INTO email_tokens (account_id,kind,token_hash,expires_at)
           VALUES ($1,'verify',$2, now() + interval '15 minutes')`, [a.id, sha("999999")]);
  const bad = await jf("/api/auth/verify", { method: "POST",
    body: JSON.stringify({ code: "000000" }) }, cookie);
  check("wrong code refused", bad.status === 400, `status ${bad.status}`);
  const { rows: [att] } = await q(
    "SELECT attempts FROM email_tokens WHERE account_id=$1 AND kind='verify' AND consumed_at IS NULL", [a.id]);
  check("attempt counted", att?.attempts === 1, `got ${att?.attempts}`);

  await q("UPDATE accounts SET email_verified=false WHERE id=$1", [a.id]);
  console.log("\n=== 5. the right code verifies ===");
  // Read the code by planting a known one (the real code was emailed).
  const CODE = "123456";
  await q(`UPDATE email_tokens SET token_hash=$2, attempts=0
            WHERE account_id=$1 AND kind='verify' AND consumed_at IS NULL`, [a.id, sha(CODE)]);
  const good = await jf("/api/auth/verify", { method: "POST",
    body: JSON.stringify({ code: CODE }) }, cookie);
  check("correct code accepted", good.status === 200, `status ${good.status}`);
  check("user now verified", good.body.user?.email_verified === true);
  const reuse = await jf("/api/auth/verify", { method: "POST",
    body: JSON.stringify({ code: CODE }) }, cookie);
  check("code cannot be reused", reuse.body.already_verified === true || reuse.status === 400);
  const an2 = await jf("/api/ml/analyze/tourist", {}, cookie);
  check("analysis no longer blocked by verification",
        an2.body.code !== "EMAIL_UNVERIFIED", `code ${an2.body.code}`);

  console.log("\n=== 6. resend: 3-minute cooldown, 3 a day ===");
  await q("DELETE FROM email_sends WHERE email_lower=$1", [EMAIL.toLowerCase()]);
  await q("UPDATE accounts SET email_verified=false WHERE id=$1", [a.id]);
  // 1st send just now -> cooldown applies.
  await q(`INSERT INTO email_sends (account_id,email_lower,kind) VALUES ($1,$2,'verify')`,
          [a.id, EMAIL.toLowerCase()]);
  const cd = await jf("/api/auth/verify/resend", { method: "POST" }, cookie);
  check("cooldown enforced 429", cd.status === 429, `status ${cd.status}`);
  check("code COOLDOWN", cd.body.code === "COOLDOWN");
  check("retry_after under 3 min", cd.body.retry_after_seconds <= 180 && cd.body.retry_after_seconds > 0,
        `got ${cd.body.retry_after_seconds}s`);
  // 3 sends, all older than the cooldown -> daily cap applies.
  await q("DELETE FROM email_sends WHERE email_lower=$1", [EMAIL.toLowerCase()]);
  for (let i = 0; i < 3; i++)
    await q(`INSERT INTO email_sends (account_id,email_lower,kind,sent_at)
             VALUES ($1,$2,'verify', now() - interval '30 minutes')`, [a.id, EMAIL.toLowerCase()]);
  const dl = await jf("/api/auth/verify/resend", { method: "POST" }, cookie);
  check("daily cap enforced 429", dl.status === 429, `status ${dl.status}`);
  check("code DAILY_LIMIT", dl.body.code === "DAILY_LIMIT", `got ${dl.body.code}`);
  // 2 old sends -> allowed again.
  await q("DELETE FROM email_sends WHERE email_lower=$1", [EMAIL.toLowerCase()]);
  for (let i = 0; i < 2; i++)
    await q(`INSERT INTO email_sends (account_id,email_lower,kind,sent_at)
             VALUES ($1,$2,'verify', now() - interval '30 minutes')`, [a.id, EMAIL.toLowerCase()]);
  const ok3 = await jf("/api/auth/verify/resend", { method: "POST" }, cookie);
  check("3rd send allowed", ok3.status === 200 || ok3.status === 503,
        `status ${ok3.status} ${ok3.body.code || ""}`);
  await q("UPDATE accounts SET email_verified=true WHERE id=$1", [a.id]);

  console.log("\n=== 7. forgot: identical answer for known and unknown ===");
  await q("DELETE FROM email_sends WHERE kind='reset'");
  const f1 = await jf("/api/auth/forgot", { method: "POST",
    body: JSON.stringify({ email: EMAIL }) });
  const f2 = await jf("/api/auth/forgot", { method: "POST",
    body: JSON.stringify({ email: `nobody-${Date.now()}@example.invalid` }) });
  check("known address: 200", f1.status === 200, `status ${f1.status}`);
  check("unknown address: 200", f2.status === 200, `status ${f2.status}`);
  check("identical message", f1.body.message === f2.body.message);
  check("no account enumeration", JSON.stringify(f1.body) === JSON.stringify(f2.body));

  console.log("\n=== 8. forgot honours the same cooldown/daily caps ===");
  const fc = await jf("/api/auth/forgot", { method: "POST",
    body: JSON.stringify({ email: EMAIL }) });
  check("second request hits cooldown", fc.status === 429, `status ${fc.status}`);
  check("code COOLDOWN", fc.body.code === "COOLDOWN");

  console.log("\n=== 9. reset token: single use ===");
  const TOKEN = "test-token-" + Date.now();
  await q(`INSERT INTO email_tokens (account_id,kind,token_hash,expires_at)
           VALUES ($1,'reset',$2, now() + interval '1 hour')`, [a.id, sha(TOKEN)]);
  const chk = await jf(`/api/auth/reset/check?token=${TOKEN}`);
  check("valid token reports valid", chk.body.valid === true);
  const r1 = await jf("/api/auth/reset", { method: "POST",
    body: JSON.stringify({ token: TOKEN, password: "BrandNewPass!99" }) });
  check("reset succeeds", r1.status === 200, `status ${r1.status} ${r1.body.error || ""}`);
  const r2 = await jf("/api/auth/reset", { method: "POST",
    body: JSON.stringify({ token: TOKEN, password: "Another!12345" }) });
  check("token cannot be reused", r2.status === 400, `status ${r2.status}`);
  const chk2 = await jf(`/api/auth/reset/check?token=${TOKEN}`);
  check("check now reports invalid", chk2.body.valid === false);
  const { rows: [sess] } = await q("SELECT count(*)::int n FROM sessions WHERE account_id=$1", [a.id]);
  check("all sessions revoked on reset", sess.n === 0, `got ${sess.n}`);
  const li = await jf("/api/auth/login", { method: "POST",
    body: JSON.stringify({ email: EMAIL, password: "BrandNewPass!99" }) });
  check("new password works", li.status === 200, `status ${li.status}`);

  console.log("\n=== 10. password resets: 1 instant, then 1 a week, 5 a month ===");
  const mk = async (daysAgo) => q(
    `INSERT INTO password_resets (account_id, reset_at) VALUES ($1, now() - ($2||' days')::interval)`,
    [a.id, String(daysAgo)]);
  const tryReset = async () => {
    const t = "tok-" + Math.random();
    await q(`INSERT INTO email_tokens (account_id,kind,token_hash,expires_at)
             VALUES ($1,'reset',$2, now() + interval '1 hour')`, [a.id, sha(t)]);
    return jf("/api/auth/reset", { method: "POST",
      body: JSON.stringify({ token: t, password: "SomePass!45678" }) });
  };
  await q("DELETE FROM password_resets WHERE account_id=$1", [a.id]);
  const i1 = await tryReset();
  check("first reset is immediate", i1.status === 200, `status ${i1.status}`);
  const i2 = await tryReset();
  check("second reset blocked (needs a week)", i2.status === 429, `status ${i2.status}`);
  check("code TOO_SOON", i2.body.code === "TOO_SOON", `got ${i2.body.code}`);
  check("says days remaining", i2.body.error.includes("7") || /\d+ days/.test(i2.body.error),
        i2.body.error);
  // A week later it is allowed again.
  await q("DELETE FROM password_resets WHERE account_id=$1", [a.id]);
  await mk(8);
  const i3 = await tryReset();
  check("allowed once a week has passed", i3.status === 200, `status ${i3.status}`);
  // 5 in the month -> hard stop even if spaced.
  await q("DELETE FROM password_resets WHERE account_id=$1", [a.id]);
  for (const d of [25, 20, 15, 10, 8]) await mk(d);
  const i4 = await tryReset();
  check("6th in a month blocked", i4.status === 429, `status ${i4.status}`);
  check("code MONTHLY_LIMIT", i4.body.code === "MONTHLY_LIMIT", `got ${i4.body.code}`);
  check("says 5", /5/.test(i4.body.error), i4.body.error);

  console.log(`\n${pass} passed, ${fail} failed`);
} finally {
  await q("DELETE FROM accounts WHERE email_lower=$1", [EMAIL.toLowerCase()]);
  await q("DELETE FROM email_sends WHERE email_lower LIKE 'auth-test-%' OR email_lower LIKE 'nobody-%'");
  console.log("cleaned up");
  await pool.end();
}
process.exit(fail ? 1 : 0);
