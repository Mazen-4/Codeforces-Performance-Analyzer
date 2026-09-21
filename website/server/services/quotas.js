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
