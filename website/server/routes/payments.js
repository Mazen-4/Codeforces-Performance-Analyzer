// InstaPay checkout: submit a transfer receipt, get Plus.
//
// InstaPay has no recurring billing, so Plus is sold as fixed-length passes.
// Each approved payment adds its term to plus_expires_at rather than starting
// a subscription that renews itself.
import express from "express";
import { query } from "../db/pool.js";
import {
  verifyInstapayScreenshot, decodeBase64Image, PLANS, priceFor,
} from "../services/instapayVerification.js";

const router = express.Router();

const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const CURRENCY = String(process.env.INSTAPAY_CURRENCY || "EGP").toUpperCase();
const HANDLE = String(process.env.INSTAPAY_HANDLE || "").trim();

/** A discount with no plan list covers everything; otherwise only its list. */
function discountAppliesTo(discount, planKey) {
  if (!discount?.percent_off) return false;
  const list = discount.applies_to;
  if (!Array.isArray(list) || list.length === 0) return true;
  return list.includes(planKey);
}

function requireUser(req, res) {
  if (!req.user) {
    res.status(401).json({ error: "Sign in to upgrade" });
    return false;
  }
  return true;
}

/** What the checkout page needs: plans, where to send, and current status. */
router.get("/config", async (req, res) => {
  let claimed = null;
  try {
    if (req.user) {
      // A discount the user already claimed applies to whatever they buy next.
      const { rows } = await query(
        `SELECT r.percent_off, d.code, d.applies_to
           FROM discount_redemptions r
           JOIN discount_codes d ON d.id = r.code_id
          WHERE r.account_id = $1
          ORDER BY r.redeemed_at DESC
          LIMIT 1`, [req.user.id]);
      if (rows.length) {
        claimed = {
          code: rows[0].code,
          percent_off: rows[0].percent_off,
          applies_to: rows[0].applies_to,   // null = every plan
        };
      }
    }
  } catch { /* the page works without it */ }

  res.json({
    configured: Boolean(HANDLE),
    handle: HANDLE || null,
    currency: CURRENCY,
    discount: claimed,
    plans: Object.values(PLANS).map(p => {
      const pct = discountAppliesTo(claimed, p.key) ? claimed.percent_off : 0;
      const price = priceFor(p.key, pct);
      // What the same term would cost at the monthly rate. This is the term
      // discount, which exists whether or not a coupon was claimed — sent from
      // here so the price shown and the price charged come from one source.
      const listPrice = PLANS.monthly.price * p.months;
      return {
        ...p,
        price_after_discount: price,
        per_month: Math.round(price / p.months),
        discounted: pct > 0,
        list_price: listPrice,
        saving: Math.max(0, listPrice - price),
        saving_percent: listPrice > 0
          ? Math.round((1 - price / listPrice) * 100) : 0,
      };
    }),
  });
});

/** Submit a transfer receipt. */
router.post("/instapay", async (req, res) => {
  if (!requireUser(req, res)) return;

  if (!HANDLE) {
    return res.status(503).json({
      error: "Payments are not configured yet.", code: "NOT_CONFIGURED",
    });
  }

  const planKey = String(req.body?.plan || "");
  const plan = PLANS[planKey];
  if (!plan) return res.status(400).json({ error: "Choose a plan." });

  const image = decodeBase64Image(req.body?.screenshot);
  if (!image) {
    return res.status(400).json({ error: "Attach a screenshot of your transfer." });
  }
  const bytes = Math.floor((image.base64.length * 3) / 4);
  if (bytes > MAX_SCREENSHOT_BYTES) {
    return res.status(413).json({ error: "That image is too large. Keep it under 8 MB." });
  }

  // One pending submission at a time, so a user cannot queue ten screenshots.
  try {
    const { rows } = await query(
      `SELECT id FROM payments WHERE account_id = $1 AND status = 'pending'`,
      [req.user.id]);
    if (rows.length) {
      return res.status(409).json({
        error: "You already have a payment awaiting review.", code: "PENDING_EXISTS",
      });
    }
  } catch { /* fall through rather than block a genuine payment */ }

  // At most one transfer per account per day. The pending check above only
  // holds while a submission is unreviewed, so a rejection would otherwise
  // free the slot at once and let someone retry screenshots all day until one
  // slipped past verification. Rejected attempts count against the cap for
  // exactly that reason. Verification reads an image with a model, so each
  // attempt also costs money.
  //
  // A rolling 24h window, not a calendar day: "one per day" should not reset
  // at midnight and hand out two in ten minutes.
  try {
    const { rows } = await query(
      `SELECT created_at FROM payments
        WHERE account_id = $1 AND created_at > now() - interval '24 hours'
        ORDER BY created_at DESC LIMIT 1`, [req.user.id]);
    if (rows.length) {
      const nextAt = new Date(new Date(rows[0].created_at).getTime() + 86_400_000);
      const hours = Math.max(1, Math.ceil((nextAt - Date.now()) / 3_600_000));
      return res.status(429).json({
        error: `You can only submit one transfer per day. Try again in `
             + `${hours} hour${hours === 1 ? "" : "s"}.`
             + ` If your last payment was rejected by mistake, reply on the`
             + ` feedback page and it will be reviewed manually.`,
        code: "DAILY_LIMIT",
        next_at: nextAt.toISOString(),
      });
    }
  } catch { /* fall through rather than block a genuine payment */ }

  // The price must be recomputed here from the user's own claimed discount.
  // Trusting an amount from the request would let anyone pay 1 EGP.
  let percentOff = 0, discountId = null;
  try {
    const { rows } = await query(
      `SELECT r.percent_off, r.code_id, d.applies_to
         FROM discount_redemptions r
         JOIN discount_codes d ON d.id = r.code_id
        WHERE r.account_id = $1
        ORDER BY r.redeemed_at DESC LIMIT 1`, [req.user.id]);
    if (rows.length) {
      const claimed = { percent_off: rows[0].percent_off, applies_to: rows[0].applies_to };
      // Scoped codes only reduce the plans they name. A user holding a
      // 6-month code cannot pay the discounted figure for a 1-month term.
      if (discountAppliesTo(claimed, planKey)) {
        percentOff = rows[0].percent_off;
        discountId = rows[0].code_id;
      }
    }
  } catch { /* no discount */ }

  const expectedAmount = priceFor(planKey, percentOff);

  let verification;
  try {
    verification = await verifyInstapayScreenshot({
      base64: image.base64,
      mimeType: image.mimeType,
      expectedAmount,
      expectedCurrency: CURRENCY,
      expectedRecipientHandle: HANDLE,
    });
  } catch (err) {
    console.error("instapay verification failed:", err.message);
    const code = err.code === "NO_KEY" ? 503 : 502;
    return res.status(code).json({
      error: err.code === "NO_KEY"
        ? "Payment verification is not configured yet."
        : "Could not check that screenshot. Try again in a moment.",
    });
  }

  const ref = String(verification.extracted?.referenceNumber || "").trim() || null;

  // One transfer buys one term. Checked before insert for a clear message, and
  // enforced by a unique index for the concurrent case.
  if (ref) {
    try {
      const { rows } = await query(
        `SELECT id FROM payments
          WHERE instapay_reference = $1 AND status <> 'rejected'`, [ref]);
      if (rows.length) {
        return res.json({
          status: "rejected",
          reasons: ["This InstaPay transaction has already been used."],
          checks: verification.checks,
        });
      }
    } catch { /* the unique index is the real guard */ }
  }

  if (verification.status === "rejected") {
    return res.json({
      status: "rejected",
      reasons: verification.reasons,
      checks: verification.checks,
    });
  }

  const approved = verification.status === "verified";

  try {
    const { rows } = await query(
      `INSERT INTO payments
         (account_id, plan_key, months, amount, currency, discount_code_id,
          percent_off, status, instapay_reference, extracted, checks,
          auto_verdict, reasons, screenshot_mime, screenshot_bytes,
          reviewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13::jsonb,$14,$15,$16)
       RETURNING id, status, created_at`,
      [req.user.id, planKey, plan.months, expectedAmount, CURRENCY, discountId,
       percentOff || null, approved ? "approved" : "pending", ref,
       JSON.stringify(verification.extracted), JSON.stringify(verification.checks),
       verification.status, JSON.stringify(verification.reasons),
       image.mimeType, bytes, approved ? new Date() : null]);

    if (approved) {
      await grantPlus(req.user.id, plan.months);
    }

    res.json({
      status: approved ? "approved" : "pending",
      payment_id: rows[0].id,
      months: plan.months,
      checks: verification.checks,
      reasons: verification.reasons,
    });
  } catch (err) {
    if (err.code === "23505") {
      // Two unique indexes can raise this. Name them apart, or a user who hit
      // the daily cap would be told their transaction was already used --
      // which is false, and would send them chasing a refund.
      if (err.constraint === "idx_payments_one_per_day") {
        return res.status(429).json({
          error: "You can only submit one transfer per day. Try again tomorrow.",
          code: "DAILY_LIMIT",
        });
      }
      return res.json({
        status: "rejected",
        reasons: ["This InstaPay transaction has already been used."],
        checks: verification.checks,
      });
    }
    console.error("payment insert failed:", err.message);
    res.status(500).json({ error: "Could not record that payment." });
  }
});

/** Extend Plus by `months`, from now or from the existing expiry if later. */
export async function grantPlus(accountId, months) {
  await query(
    `UPDATE accounts
        SET plan = 'pro',
            plus_expires_at = GREATEST(COALESCE(plus_expires_at, now()), now())
                              + ($2 || ' months')::interval
      WHERE id = $1`, [accountId, String(months)]);
}

/** The signed-in user's own payments. */
router.get("/mine", async (req, res) => {
  if (!requireUser(req, res)) return;
  try {
    const { rows } = await query(
      `SELECT id, plan_key, months, amount, currency, status, created_at,
              reviewed_at, review_note, reasons
         FROM payments WHERE account_id = $1
        ORDER BY created_at DESC LIMIT 20`, [req.user.id]);
    const { rows: acct } = await query(
      `SELECT plus_expires_at FROM accounts WHERE id = $1`, [req.user.id]);
    res.json({ payments: rows, plus_expires_at: acct[0]?.plus_expires_at ?? null });
  } catch (err) {
    console.error("payment history failed:", err.message);
    res.status(500).json({ error: "Could not load your payments." });
  }
});

export default router;
