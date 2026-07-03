const API_BASE = import.meta.env.VITE_API_URL || "";

async function request(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };

  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  signup: (payload) => request("/auth/signup", { method: "POST", body: payload }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request("/auth/me"),
  updateProfile: (payload) => request("/auth/profile", { method: "PATCH", body: payload }),
  createInterview: (type) => request("/interviews", { method: "POST", body: { type } }),
  listInterviews: () => request("/interviews"),
  getInterview: (id) => request(`/interviews/${id}`),
  setInterviewJd: (id, jdText) =>
    request(`/interviews/${id}`, { method: "PATCH", body: { jdText } }),
  finishInterview: (id) => request(`/interviews/${id}/finish`, { method: "POST" }),
};

// Build the WebSocket URL for the voice session. In dev this is same-origin
// (Vite proxy); in production it points at VITE_API_URL (the Render backend).
// Auth travels via the httpOnly cookie, sent automatically on the upgrade request.
export function voiceWsUrl(interviewId) {
  if (API_BASE) {
    const wsBase = API_BASE.replace(/^http/, "ws");
    return `${wsBase}/api/interviews/${interviewId}/voice`;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/api/interviews/${interviewId}/voice`;
}
