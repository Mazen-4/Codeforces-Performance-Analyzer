/**
 * InstaPay screenshot verification.
 *
 * Ported from OnlineCoursesPlatform's paymentVerification.js, with the vision
 * call moved from Groq/Llama to Claude so the project keeps one AI provider.
 *
 * The shape is unchanged because it is sound: read the receipt, run explicit
 * named checks, return one of three verdicts. Auto-approval requires every
 * required check to pass; anything ambiguous goes to a human rather than
 * being guessed at in either direction.
 */
import Anthropic from "@anthropic-ai/sdk";

// How much over the plan price still counts as paying it. Rounding up to the
// nearest note is ordinary behaviour, and refusing it would reject genuine
// payers over a single pound. The surplus is not credited -- it buys the same
// term -- which is why the window is small.
export const OVERPAY_TOLERANCE = 5;   // EGP

// A transfer must be recent. Someone paying now should not be submitting a
// receipt from last month, and an old receipt is the shape a resold or
// borrowed screenshot takes.
export const MAX_TRANSACTION_AGE_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
// Small tolerance for a clock that is slightly ahead: a receipt a few minutes
// in the future is a clock difference, not a forgery.
export const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;

// Real InstaPay receipts land around 370 KB. This is a weak signal on its own
// -- cropping or recompression moves it -- so it never rejects by itself; it
// only routes an odd-sized upload to manual review.
export const TYPICAL_SCREENSHOT_BYTES = 370 * 1024;
export const SCREENSHOT_SIZE_MIN = 40 * 1024;
export const SCREENSHOT_SIZE_MAX = 3 * 1024 * 1024;

/** Digits only, for comparing a typed reference against a read one. */
export function normalizeReference(v) {
  return String(v || "").replace(/\D/g, "");
}

const EXTRACTION_PROMPT = `You are reading a screenshot of an InstaPay (Egyptian instant payment) transaction confirmation.

A genuine receipt shows a "From" party (who sent the money) and a "To" party
(who received it), an amount, a Reference number, and a Date. The recipient's
name is often masked with asterisks, and text may be Arabic or English.

Extract as JSON:
{
  "isInstaPayScreenshot": boolean,
  "amount": number or null (numeric only, no currency symbol),
  "currency": string or null (e.g. "EGP"),
  "senderHandle": string or null (the address or phone under "From"),
  "senderName": string or null,
  "recipientHandle": string or null (the address or phone under "To"),
  "recipientName": string or null (as shown, keep asterisks if masked),
  "recipientAccount": string or null (any account/card number shown under "To"),
  "transactionTimestamp": string or null,
  "referenceNumber": string or null,
  "status": string or null (e.g. "Successful"),
  "notes": string (one line describing what you see)
}

Rules:
- Keep "From" and "To" strictly separate. Never put the sender's address in
  recipientHandle, even if only one party is clearly readable. If the "To"
  party is masked and no address is visible for them, set recipientHandle to
  null rather than falling back to the sender.
- transactionTimestamp: return ISO 8601 with the offset if a timezone is
  shown. Receipts usually show local Egyptian time (UTC+3) like
  "21 Sep 2026 11:09 PM" -- convert that to "2026-09-21T23:09:00+03:00".
- referenceNumber: digits exactly as printed, no spaces or separators.
- If a field is not clearly visible, use null. Do not guess.
- An address looks like name@instapay; a mobile number is 11 digits starting
  01. Keep addresses verbatim; for phones give digits only.
- Return ONLY the JSON object.`;

/** Egyptian mobile numbers appear with and without a country code. */
function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

/**
 * InstaPay accepts two kinds of recipient: a mobile number, or an address of
 * the form name@instapay. The ported implementation only handled numbers —
 * it stripped non-digits, which turns an address handle into an empty string
 * and fails every payment. Compare addresses as text, numbers as digits.
 */
function isAddressHandle(value) {
  return /@/.test(String(value || ""));
}

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function recipientsMatch(got, want) {
  if (!got || !want) return false;

  if (isAddressHandle(want) || isAddressHandle(got)) {
    const a = normalizeAddress(got);
    const b = normalizeAddress(want);
    if (!a || !b) return false;
    // A receipt may print the address with or without the @instapay suffix.
    const bare = (v) => v.replace(/@instapay$/, "");
    return a === b || bare(a) === bare(b);
  }

  const a = normalizePhone(got);
  const b = normalizePhone(want);
  if (!a || !b) return false;
  // endsWith either way, because one side may carry a +20 country code.
  return a === b || a.endsWith(b) || b.endsWith(a);
}

function parseModelJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    // The model occasionally wraps the object in prose; take the outermost {}.
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first === -1 || last <= first) return null;
    try { return JSON.parse(trimmed.slice(first, last + 1)); }
    catch { return null; }
  }
}

async function extractScreenshotData({ base64, mimeType }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error("ANTHROPIC_API_KEY is not set");
    err.code = "NO_KEY";
    throw err;
  }

  const anthropic = new Anthropic({ apiKey });
  const message = await anthropic.messages.create({
    // Reading a receipt is extraction, not judgement: the cheaper model is the
    // right tool and keeps per-submission cost near zero.
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "image",
          source: { type: "base64", media_type: mimeType || "image/jpeg", data: base64 } },
        { type: "text", text: EXTRACTION_PROMPT },
      ],
    }],
  });

  if (message.stop_reason === "refusal") {
    throw new Error("Screenshot could not be read");
  }

  const text = message.content.filter(b => b.type === "text").map(b => b.text).join("");
  const parsed = parseModelJson(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Verifier did not return valid JSON");
  }
  return parsed;
}

/**
 * Explicit named checks, so a rejection can always be explained to the user
 * and an admin can see exactly which condition failed.
 */
export function runVerificationChecks({
  extracted, expectedAmount, expectedCurrency, expectedRecipientHandle,
  // The reference the payer typed, the size of the uploaded file, and when it
  // was uploaded. All optional: a caller that omits them simply skips those
  // checks rather than failing them.
  claimedReference, screenshotBytes, uploadedAt,
}) {
  const checks = [];
  const reasons = [];

  const isInstaPay = Boolean(extracted?.isInstaPayScreenshot);
  checks.push({
    name: "screenshotIsInstaPay", passed: isInstaPay,
    detail: isInstaPay ? "Looks like an InstaPay confirmation"
                       : "Does not look like an InstaPay confirmation",
  });
  if (!isInstaPay) reasons.push("This does not look like an InstaPay confirmation screenshot.");

  // Number(null) is 0, which would be reported as "you sent 0 EGP" when in
  // fact nothing could be read off the receipt. Keep the two cases apart.
  const rawAmount = extracted?.amount;
  const got = (rawAmount === null || rawAmount === undefined || rawAmount === "")
    ? NaN : Number(rawAmount);
  // Asymmetric on purpose. People round up -- sending 1100 for a 1099 plan is
  // normal and must not be turned away -- so a small overpayment passes. Under
  // the price it stays strict apart from half a pound of receipt rounding,
  // because accepting less than the price is simply underpaying.
  const over = Number.isFinite(got) && Number.isFinite(expectedAmount)
    ? got - expectedAmount : NaN;
  const amountMatches = Number.isFinite(over)
    && over <= OVERPAY_TOLERANCE && over >= -0.5;
  checks.push({
    name: "amountMatchesPlanPrice", passed: amountMatches,
    detail: !Number.isFinite(over)
      ? `Amount unreadable, expected ${expectedAmount}`
      : amountMatches
        ? (over > 0.5 ? `Amount ${got} covers ${expectedAmount} (+${over.toFixed(2)} over)`
                      : `Amount ${got} matches ${expectedAmount}`)
        : `Amount ${got} does not match ${expectedAmount}`,
  });
  if (!amountMatches) {
    const cur = expectedCurrency || "EGP";
    reasons.push(
      !Number.isFinite(over)
        ? `We could not read the amount on the receipt. It must be ${expectedAmount} ${cur} for this plan.`
        : over < 0
          ? `The transfer was ${got} ${cur}, which is less than the ${expectedAmount} ${cur} this plan costs.`
          : `The transfer was ${got} ${cur}, more than ${OVERPAY_TOLERANCE} ${cur} above the ${expectedAmount} ${cur} price. Send the exact amount so it can be matched automatically.`
    );
  }

  const currencyMatches = !expectedCurrency || !extracted?.currency
    || String(extracted.currency).toUpperCase().includes(String(expectedCurrency).toUpperCase());
  checks.push({
    name: "currencyMatches", passed: currencyMatches,
    detail: currencyMatches ? "Currency matches" : `Currency mismatch (${extracted?.currency})`,
  });

  // ── the typed reference must match the one printed on the receipt ───────
  // This is the strongest check available. The payer types the reference from
  // their own receipt, so a screenshot taken from someone else fails here
  // unless they also copy its reference -- and that reference is then caught
  // by the duplicate guard.
  const typedRef = normalizeReference(claimedReference);
  const shownRef = normalizeReference(extracted?.referenceNumber);
  if (typedRef || shownRef) {
    const refMatches = Boolean(typedRef) && Boolean(shownRef) && typedRef === shownRef;
    checks.push({
      name: "referenceMatchesScreenshot", passed: refMatches,
      detail: !typedRef ? "No reference number was entered"
            : !shownRef ? `Could not read a reference on the receipt (you entered ${typedRef})`
            : refMatches ? `Reference ${typedRef} matches the receipt`
            : `You entered ${typedRef} but the receipt shows ${shownRef}`,
    });
    if (!refMatches) {
      reasons.push(
        !typedRef ? "Enter the reference number shown on your transfer receipt."
        : !shownRef ? "We could not read the reference number on that screenshot. Make sure the whole receipt is visible."
        : `The reference you entered (${typedRef}) does not match the one on the screenshot (${shownRef}).`
      );
    }
  }

  const gotTo = String(extracted?.recipientHandle || "").trim();
  const recipientMatches = recipientsMatch(gotTo, expectedRecipientHandle);
  checks.push({
    name: "recipientMatches", passed: recipientMatches,
    detail: recipientMatches
      ? `Recipient ${gotTo} matches the merchant handle`
      : `Recipient ${gotTo || "unreadable"} does not match `
        + `${expectedRecipientHandle || "(handle not configured)"}`,
  });
  if (!recipientMatches) {
    reasons.push(`The money must be sent to ${expectedRecipientHandle}.`);
  }

  // The sender must not be the merchant. A receipt where the configured handle
  // appears under "From" is one of our own outgoing transfers, not a payment
  // to us -- exactly the shape of the sample receipts.
  const gotFrom = String(extracted?.senderHandle || "").trim();
  if (gotFrom && expectedRecipientHandle) {
    const senderIsMerchant = recipientsMatch(gotFrom, expectedRecipientHandle);
    checks.push({
      name: "senderIsNotMerchant", passed: !senderIsMerchant,
      detail: senderIsMerchant
        ? `The receipt shows ${gotFrom} as the SENDER, so this is money leaving that account`
        : `Sent from ${gotFrom}`,
    });
    if (senderIsMerchant) {
      reasons.push(
        "This receipt shows a transfer FROM our account, not one to it. "
        + "Send a screenshot of your own transfer to us.");
    }
  }

  // ── when the transfer happened ──────────────────────────────────────────
  const rawTs = extracted?.transactionTimestamp;
  const txMs = rawTs ? Date.parse(rawTs) : NaN;
  const nowMs = uploadedAt ? new Date(uploadedAt).getTime() : Date.now();
  if (rawTs) {
    const ageMs = nowMs - txMs;
    const readable = Number.isFinite(txMs);
    const tooOld    = readable && ageMs >  MAX_TRANSACTION_AGE_MS;
    const tooFuture = readable && ageMs < -MAX_FUTURE_SKEW_MS;
    const timingOk  = readable && !tooOld && !tooFuture;
    const days = readable ? Math.floor(ageMs / 86_400_000) : null;
    checks.push({
      name: "transactionIsRecent", passed: timingOk,
      detail: !readable ? `Could not read the transfer date ("${rawTs}")`
            : tooOld    ? `Transfer is ${days} days old`
            : tooFuture ? `Transfer is dated in the future (${rawTs})`
            : `Transferred ${days === 0 ? "today" : `${days} day(s) ago`}`,
    });
    if (tooOld) {
      reasons.push(
        `That transfer is ${days} days old. Receipts must be from the last `
        + `${Math.round(MAX_TRANSACTION_AGE_MS / 86_400_000)} days.`);
    } else if (tooFuture) {
      reasons.push("The date on that receipt is in the future.");
    }
  }

  // ── file size ───────────────────────────────────────────────────────────
  // Advisory only. A real screenshot sits near 370 KB, but cropping and
  // re-encoding move it legitimately, so an odd size never rejects on its own
  // -- it is not in the required list below, so it routes to manual review.
  if (Number.isFinite(screenshotBytes) && screenshotBytes > 0) {
    const kb = Math.round(screenshotBytes / 1024);
    const plausible = screenshotBytes >= SCREENSHOT_SIZE_MIN
                   && screenshotBytes <= SCREENSHOT_SIZE_MAX;
    const typical = Math.abs(screenshotBytes - TYPICAL_SCREENSHOT_BYTES)
                    <= TYPICAL_SCREENSHOT_BYTES;   // within 2x of 370 KB
    checks.push({
      name: "screenshotSizePlausible", passed: plausible,
      detail: !plausible
        ? `${kb} KB is outside the range a phone screenshot normally falls in`
        : typical ? `${kb} KB, in line with an InstaPay screenshot`
                  : `${kb} KB, unusual for an InstaPay screenshot but possible`,
    });
    if (!plausible) {
      reasons.push(
        `That file is ${kb} KB. An InstaPay screenshot is normally around `
        + `${Math.round(TYPICAL_SCREENSHOT_BYTES / 1024)} KB -- send the original `
        + `image rather than a crop or a photo of another screen.`);
    }
  }

  // Auto-approval requires all of these. A check that was skipped (because the
  // caller did not supply the input, or the field was absent) is not counted
  // as a pass -- `find` simply will not match it, so the payment routes to
  // review rather than sailing through on missing evidence.
  //
  // screenshotSizePlausible IS here, but only as a range check: a 370 KB
  // screenshot and a 200 KB crop both pass it. What fails is a file far
  // outside any plausible range -- a few KB, or several MB -- which is worth a
  // human glance even though an odd size is not by itself fraud. A payment
  // that fails only this still routes to review, never to rejection.
  const required = [
    "screenshotIsInstaPay",
    "referenceMatchesScreenshot",
    "recipientMatches",
    "senderIsNotMerchant",
    "amountMatchesPlanPrice",
    "transactionIsRecent",
    "screenshotSizePlausible",
  ];
  const allPassed = required.every(n => checks.find(c => c.name === n && c.passed));

  // Three outcomes, not two: a screenshot that is clearly not InstaPay is
  // rejected outright, but a readable receipt failing a check goes to a human —
  // extraction can be wrong, and a real payer should not be turned away by a
  // misread digit.
  let status;
  if (allPassed) status = "verified";
  else if (!isInstaPay) status = "rejected";
  else status = "needs_review";

  return { status, checks, reasons };
}

export async function verifyInstapayScreenshot({
  base64, mimeType, expectedAmount, expectedCurrency, expectedRecipientHandle,
  claimedReference, screenshotBytes, uploadedAt,
}) {
  const extracted = await extractScreenshotData({ base64, mimeType });
  const result = runVerificationChecks({
    extracted, expectedAmount, expectedCurrency, expectedRecipientHandle,
    claimedReference, screenshotBytes, uploadedAt,
  });
  return { ...result, extracted };
}

export function decodeBase64Image(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (match) return { mimeType: match[1], base64: match[2] };
  const trimmed = dataUrl.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed)) return { mimeType: "image/jpeg", base64: trimmed };
  return null;
}

/** The plans Plus is sold in. Longer terms carry a discount. */
export const PLANS = {
  monthly:   { key: "monthly",   months: 1, price: 399,  label: "1 month"  },
  quarterly: { key: "quarterly", months: 3, price: 1099, label: "3 months" },
  biannual:  { key: "biannual",  months: 6, price: 1799, label: "6 months" },
};

/** Price after a claimed discount, rounded to whole pounds. */
export function priceFor(planKey, percentOff = 0) {
  const plan = PLANS[planKey];
  if (!plan) return null;
  const pct = Number(percentOff) || 0;
  return Math.round(plan.price * (1 - Math.min(100, Math.max(0, pct)) / 100));
}
