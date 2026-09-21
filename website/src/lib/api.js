// Thin fetch wrapper. Always sends cookies so the session travels with requests.

const BASE = import.meta.env.VITE_API_BASE || "";

async function request(path, { method = "GET", body, signal } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      // The server compares this against its own clock. Billing periods and
      // plan expiry depend on an accurate date, so a badly-wrong device is
      // refused rather than silently given the wrong answer.
      "X-Client-Time": String(Date.now()),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { error: text.slice(0, 300) }; }
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.code;
    if (data?.code === "CLOCK_SKEW") {
      err.serverTime = data.server_time;
      err.skewMs = data.skew_ms;
    }
    throw err;
  }
  return data;
}

export const api = {
  config:  ()      => request("/api/config"),
  me:      ()      => request("/api/auth/me"),
  signup:  (body)  => request("/api/auth/signup", { method: "POST", body }),
  login:   (body)  => request("/api/auth/login",  { method: "POST", body }),
  logout:  ()      => request("/api/auth/logout", { method: "POST" }),
  updateMe:(body)  => request("/api/auth/me", { method: "PATCH", body }),
  changePassword: (body) => request("/api/auth/password", { method: "POST", body }),
  mySearches: ()   => request("/api/me/searches"),
  storedAnalysis: (id) => request(`/api/me/searches/${id}`),

  analyze: (handle, signal) =>
    request(`/api/ml/analyze/${encodeURIComponent(handle)}`, { signal }),
  cf:      (handle, signal) =>
    request(`/api/cf/${encodeURIComponent(handle)}`, { signal }),

  admin: {
    stats:    ()             => request("/api/admin/stats"),
    users:    (params = {})  => {
      const q = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== "" && v != null)
      ).toString();
      return request(`/api/admin/users${q ? `?${q}` : ""}`);
    },
    user:     (id)           => request(`/api/admin/users/${id}`),
    update:   (id, body)     => request(`/api/admin/users/${id}`, { method: "PATCH", body }),
    remove:   (id)           => request(`/api/admin/users/${id}`, { method: "DELETE" }),
    searches: (limit = 100)  => request(`/api/admin/searches?limit=${limit}`),
  },
};
