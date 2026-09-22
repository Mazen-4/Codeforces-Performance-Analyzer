// Verification codes, reset tokens, and the limits on both.
//
// The rules, in one place so the API and the UI cannot disagree:
//   - a code or link may be requested once every 3 minutes
//   - at most 3 requests per address per day, per kind
//   - a password may actually be reset 5 times a month, the first immediately
//     and then one a week
//
// Send limits are keyed on the email address rather than the account, so
// asking for a reset on an address with no account behaves identically to one
// with an account and cannot be used to discover which addresses are
// registered.

import { createHash, randomInt, randomBytes } from "node:crypto";
import { query } from "../db/pool.js";

export const RESEND_COOLDOWN_MS  = 3 * 60 * 1000;   // 3 minutes
export const SENDS_PER_DAY       = 3;
export const CODE_TTL_MS         = 15 * 60 * 1000;  // verification code
export const RESET_TTL_MS        = 60 * 60 * 1000;  // reset link
export const MAX_CODE_ATTEMPTS   = 5;

// Actual password changes, distinct from reset emails requested.
export const RESETS_PER_MONTH    = 5;
export const RESET_SPACING_MS    = 7 * 24 * 60 * 60 * 1000;   // one a week

const sha256 = (v) => createHash("sha256").update(String(v)).digest("hex");

/** A 6-digit code. randomInt is rejection-sampled, so digits stay uniform —
 *  Math.random() would be both biased and predictable. */
export function newCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** A reset token. 32 bytes is far beyond guessing; it never has to be typed. */
export function newToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * May this address be sent another `kind` email right now?
 * Returns {allowed, reason, retry_after_seconds, sends_today, remaining_today}.
 */
export async function sendWindow(emailLower, kind) {
  const { rows } = await query(
    `SELECT count(*)::int AS today,
            max(sent_at)   AS last_at
       FROM email_sends
      WHERE email_lower = $1 AND kind = $2
        AND sent_at > now() - interval '24 hours'`,
    [emailLower, kind]);

  const today = rows[0]?.today ?? 0;
  const lastAt = rows[0]?.last_at ? new Date(rows[0].last_at).getTime() : null;

  if (today >= SENDS_PER_DAY) {
    return {
      allowed: false, reason: "DAILY_LIMIT",
      sends_today: today, remaining_today: 0,
      retry_after_seconds: null,
    };
  }
  if (lastAt) {
    const waited = Date.now() - lastAt;
    if (waited < RESEND_COOLDOWN_MS) {
      return {
        allowed: false, reason: "COOLDOWN",
        sends_today: today,
        remaining_today: Math.max(0, SENDS_PER_DAY - today),
        retry_after_seconds: Math.ceil((RESEND_COOLDOWN_MS - waited) / 1000),
      };
    }
  }
  return {
    allowed: true, reason: null,
    sends_today: today,
    remaining_today: Math.max(0, SENDS_PER_DAY - today),
    retry_after_seconds: 0,
  };
}

/** Record a send attempt. Logged even on failure: otherwise a bouncing
 *  mailbox would hand out unlimited retries. */
export async function recordSend(accountId, emailLower, kind, ok = true) {
  await query(
    `INSERT INTO email_sends (account_id, email_lower, kind, ok)
     VALUES ($1, $2, $3, $4)`,
    [accountId, emailLower, kind, ok]);
}

/** Issue a token, replacing any live one of the same kind so only the newest
 *  code works. Returns the plaintext secret; only its hash is stored. */
export async function issueToken(accountId, kind) {
  const secret = kind === "verify" ? newCode() : newToken();
  const ttl = kind === "verify" ? CODE_TTL_MS : RESET_TTL_MS;

  // Retiring the previous token matters for correctness: a user who requests a
  // second code expects the first to stop working.
  await query(
    `UPDATE email_tokens SET consumed_at = now()
      WHERE account_id = $1 AND kind = $2 AND consumed_at IS NULL`,
    [accountId, kind]);

  await query(
    `INSERT INTO email_tokens (account_id, kind, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)`,
    [accountId, kind, sha256(secret), String(ttl)]);

  return secret;
}

/**
 * Consume a token. One statement does the check and the claim, so the same
 * code cannot be redeemed twice by two concurrent requests.
 * Returns {ok, accountId, reason}.
 */
export async function consumeToken(kind, secret, accountId = null) {
  const hash = sha256(secret);
  const { rows } = await query(
    `UPDATE email_tokens
        SET consumed_at = now()
      WHERE id = (
        SELECT id FROM email_tokens
         WHERE token_hash = $1 AND kind = $2
           AND consumed_at IS NULL
           AND expires_at > now()
           AND attempts < $3
           AND ($4::uuid IS NULL OR account_id = $4::uuid)
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE SKIP LOCKED)
      RETURNING account_id`,
    [hash, kind, MAX_CODE_ATTEMPTS, accountId]);

  if (rows.length) return { ok: true, accountId: rows[0].account_id };
  return { ok: false, reason: "INVALID_OR_EXPIRED" };
}

/** Count a wrong guess against the live token, so a 6-digit code cannot be
 *  brute-forced by repeated submission. */
export async function recordFailedAttempt(accountId, kind) {
  await query(
    `UPDATE email_tokens SET attempts = attempts + 1
      WHERE account_id = $1 AND kind = $2 AND consumed_at IS NULL`,
    [accountId, kind]);
}

/**
 * May this account actually change its password now?
 * 5 per rolling month; the first is immediate, each later one needs a week
 * since the previous.
 */
export async function passwordResetWindow(accountId) {
  const { rows } = await query(
    `SELECT count(*)::int AS month_count, max(reset_at) AS last_at
       FROM password_resets
      WHERE account_id = $1 AND reset_at > now() - interval '30 days'`,
    [accountId]);

  const used = rows[0]?.month_count ?? 0;
  const lastAt = rows[0]?.last_at ? new Date(rows[0].last_at).getTime() : null;
  const remaining = Math.max(0, RESETS_PER_MONTH - used);

  if (used >= RESETS_PER_MONTH) {
    return { allowed: false, reason: "MONTHLY_LIMIT", used, remaining: 0,
             next_at: null, days_remaining: null };
  }
  // The first reset in the window is immediate; spacing applies from then on.
  if (lastAt) {
    const since = Date.now() - lastAt;
    if (since < RESET_SPACING_MS) {
      const nextMs = lastAt + RESET_SPACING_MS;
      return {
        allowed: false, reason: "TOO_SOON", used, remaining,
        next_at: new Date(nextMs).toISOString(),
        days_remaining: Math.max(1, Math.ceil((nextMs - Date.now()) / 86_400_000)),
      };
    }
  }
  return { allowed: true, reason: null, used, remaining,
           next_at: null, days_remaining: 0 };
}

/** Record a completed password change against the monthly quota. */
export async function recordPasswordReset(accountId) {
  await query(`INSERT INTO password_resets (account_id) VALUES ($1)`, [accountId]);
}
