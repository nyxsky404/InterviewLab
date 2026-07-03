// Thin fetch wrapper that sends the httpOnly auth cookie and unwraps JSON / errors.
async function request(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };

  const res = await fetch(`/api${path}`, {
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

// Build the WebSocket URL for the voice session (same origin -> Vite proxy).
// Auth travels via the httpOnly cookie, sent automatically on the upgrade request.
export function voiceWsUrl(interviewId) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/api/interviews/${interviewId}/voice`;
}
