// Rate limits on two actions that would otherwise let one account behave like
// many: relinking the Codeforces handle, and analysing a handle that is not
// the linked one.
//
// Both are enforced here rather than in the route bodies so the numbers exist
// in exactly one place; the API also reports them to the client, so the UI
// never has to restate them and cannot drift out of sync.

export const HANDLE_CHANGE_DAYS = 182;          // ~6 months

// Analysing someone else's handle. Plus buys frequency, not exemption.
export const OTHER_HANDLE_DAYS = { free: 91, pro: 7 };   // ~3 months / 1 week

// Analysing your OWN handle. Two constraints at once: a weekly allowance, and
// a minimum gap between runs. The gap matters on its own -- a rating barely
// moves inside a day, so three runs in an afternoon spend real compute to
// show the same numbers three times.
export const OWN_HANDLE_PER_WEEK = { free: 1, pro: 3 };
export const OWN_HANDLE_GAP_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Plus is `plan = 'pro'` and an expiry that has not passed. An account whose
 *  term lapsed keeps the row but falls back to the free cadence. */
export function isPlus(user) {
  if (!user || user.plan !== "pro") return false;
  if (!user.plus_expires_at) return true;     // admin-granted, no expiry
  return new Date(user.plus_expires_at).getTime() > Date.now();
}

/** Shared shape: when the next use is allowed, given the last one. */
function window_(lastAt, days) {
  const periodMs = days * DAY_MS;
  if (!lastAt) {
    return { allowed: true, next_at: null, days_remaining: 0, period_days: days };
  }
  const nextMs = new Date(lastAt).getTime() + periodMs;
  const remaining = nextMs - Date.now();
  return {
    allowed: remaining <= 0,
    next_at: new Date(nextMs).toISOString(),
    days_remaining: Math.max(0, Math.ceil(remaining / DAY_MS)),
    period_days: days,
  };
}

/**
 * May this account analyse its OWN handle right now?
 *
 * Unlike the other windows this has two limits: N runs in a rolling week AND
 * a gap since the last one. Whichever bites first is reported, so the message
 * tells the user the thing that is actually blocking them rather than the
 * more generous of the two.
 *
 * `recentRuns` is the timestamps of this account's own-handle analyses in the
 * last 7 days, newest first. The caller reads them, because quotas.js has no
 * database access.
 */
export function ownHandleWindow(user, recentRuns = []) {
  const plan = isPlus(user) ? "pro" : "free";
  const allowance = OWN_HANDLE_PER_WEEK[plan];
  const times = recentRuns
    .map((t) => new Date(t).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a);

  const used = times.length;
  const remaining = Math.max(0, allowance - used);
  const base = { plan, used, allowance, remaining, per_week: allowance };

  // The 24h gap, checked first: it is the limit a user hits most often.
  if (times.length) {
    const since = Date.now() - times[0];
    if (since < OWN_HANDLE_GAP_MS) {
      const nextMs = times[0] + OWN_HANDLE_GAP_MS;
      return {
        ...base, allowed: false, reason: "TOO_SOON",
        next_at: new Date(nextMs).toISOString(),
        retry_after_seconds: Math.ceil((nextMs - Date.now()) / 1000),
      };
    }
  }

  // Then the weekly allowance. The window rolls, so the next slot opens when
  // the oldest run in the window ages out.
  if (used >= allowance) {
    const oldest = times[times.length - 1];
    const nextMs = oldest + 7 * DAY_MS;
    return {
      ...base, allowed: false, reason: "WEEKLY_LIMIT",
      next_at: new Date(nextMs).toISOString(),
      retry_after_seconds: Math.max(0, Math.ceil((nextMs - Date.now()) / 1000)),
    };
  }

  return { ...base, allowed: true, reason: null, next_at: null,
           retry_after_seconds: 0 };
}

/** May this account relink its Codeforces handle right now? */
export function handleChangeWindow(user) {
  return window_(user?.cf_handle_changed_at, HANDLE_CHANGE_DAYS);
}

/** May this account analyse a handle other than its own right now? */
export function otherHandleWindow(user) {
  const days = OTHER_HANDLE_DAYS[isPlus(user) ? "pro" : "free"];
  return { ...window_(user?.other_handle_run_at, days), plan: isPlus(user) ? "pro" : "free" };
}

/** Human phrasing for a refusal, used verbatim in API errors. */
export function waitMessage(days) {
  if (days <= 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}
