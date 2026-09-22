// Promo codes at checkout.
//
// A code is validated for preview without being consumed, and its use is only
// spent when a purchase actually completes. Someone who types a code and walks
// away does not burn one of a limited run.
//
// Validation and consumption share `lookupPromo` and `discountAppliesTo` so
// the price previewed is always the price charged.

import { query } from "../db/pool.js";

/** A discount with no plan list covers everything; otherwise only its list. */
export function discountAppliesTo(discount, planKey) {
  if (!discount?.percent_off) return false;
  const list = discount.applies_to;
  if (!Array.isArray(list) || list.length === 0) return true;
  return list.includes(planKey);
}

/**
 * Read a code and say whether this account may use it, WITHOUT consuming it.
 * Returns {ok, code, percent_off, applies_to, reason}.
 */
export async function lookupPromo(codeRaw, accountId) {
  const code = String(codeRaw || "").trim().toUpperCase();
  if (!code) return { ok: false, reason: "EMPTY" };

  const { rows } = await query(
    `SELECT id, code, percent_off, max_uses, used_count, expires_at, active,
            applies_to
       FROM discount_codes WHERE code_upper = $1`, [code]);
  if (!rows.length) return { ok: false, reason: "NOT_FOUND" };

  const d = rows[0];
  if (!d.active) return { ok: false, reason: "INACTIVE" };
  if (new Date(d.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "EXPIRED" };
  }
  if (d.used_count >= d.max_uses) return { ok: false, reason: "EXHAUSTED" };

  // One redemption per account, checked here so the preview can say so rather
  // than letting someone reach the payment step and be refused.
  if (accountId) {
    const { rows: mine } = await query(
      `SELECT 1 FROM discount_redemptions
        WHERE code_id = $1 AND account_id = $2`, [d.id, accountId]);
    if (mine.length) return { ok: false, reason: "ALREADY_USED" };
  }

  return {
    ok: true,
    id: d.id,
    code: d.code,
    percent_off: d.percent_off,
    applies_to: d.applies_to,
    remaining: d.max_uses - d.used_count,
    expires_at: d.expires_at,
  };
}

/** Wording for each refusal, so the API and the UI say the same thing. */
export const PROMO_MESSAGES = {
  EMPTY:        "Enter a promo code.",
  NOT_FOUND:    "That code does not exist.",
  INACTIVE:     "That code is no longer active.",
  EXPIRED:      "That code has expired.",
  EXHAUSTED:    "That code has been fully used.",
  ALREADY_USED: "You have already used this code.",
  NOT_FOR_PLAN: "That code does not apply to this plan.",
};

/**
 * Spend one use, atomically. Every condition lives in the UPDATE's WHERE
 * clause, so two purchases racing for the last use cannot both win.
 * Returns {ok, reason}.
 */
export async function consumePromo(codeId, accountId, percentOff) {
  const claimed = await query(
    `UPDATE discount_codes
        SET used_count = used_count + 1
      WHERE id = $1 AND active AND expires_at > now()
        AND used_count < max_uses
      RETURNING id`, [codeId]);
  if (!claimed.rowCount) return { ok: false, reason: "EXHAUSTED" };

  try {
    await query(
      `INSERT INTO discount_redemptions (code_id, account_id, percent_off)
       VALUES ($1, $2, $3)`, [codeId, accountId, percentOff]);
    return { ok: true };
  } catch (err) {
    if (err.code === "23505") {
      // This account already redeemed it: hand the use back rather than
      // silently burning one.
      await query(
        `UPDATE discount_codes SET used_count = used_count - 1 WHERE id = $1`,
        [codeId]);
      return { ok: false, reason: "ALREADY_USED" };
    }
    // The use was taken but the record failed; return it so the count stays
    // honest, then report the failure.
    await query(
      `UPDATE discount_codes SET used_count = used_count - 1 WHERE id = $1`,
      [codeId]).catch(() => {});
    throw err;
  }
}
