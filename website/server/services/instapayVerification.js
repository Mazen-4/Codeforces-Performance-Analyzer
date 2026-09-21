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

const EXTRACTION_PROMPT = `You are analyzing a screenshot of an InstaPay (Egyptian instant payment) transaction confirmation.

Extract the following fields as JSON:
{
  "isInstaPayScreenshot": boolean,
  "amount": number or null (numeric value only, no currency symbol),
  "currency": string or null (e.g. "EGP"),
  "recipientHandle": string or null (phone number or handle of the recipient, digits only if phone),
  "recipientName": string or null (name of the recipient as shown),
  "senderName": string or null,
  "transactionTimestamp": string or null (ISO 8601 if possible, else raw as shown),
  "referenceNumber": string or null (transaction reference / ID),
  "status": string or null (e.g. "Successful", "Success", "Completed"),
  "notes": string (a one-line human-readable summary of what you see)
}

Rules:
- Screenshots may be in Arabic or English. Translate field values to English where reasonable but keep names/handles verbatim.
- If a field is not clearly visible, set it to null. Do not guess.
- recipientHandle may be either a mobile number or an InstaPay address such as name@instapay. If it is a mobile number, extract digits only (Egyptian numbers start with 01 and are 11 digits). If it is an address, keep it verbatim including the @ part.
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

  const required = ["screenshotIsInstaPay", "amountMatchesPlanPrice", "recipientMatches"];
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
}) {
  const extracted = await extractScreenshotData({ base64, mimeType });
  const result = runVerificationChecks({
    extracted, expectedAmount, expectedCurrency, expectedRecipientHandle,
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
