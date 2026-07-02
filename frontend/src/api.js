const TOKEN_KEY = "liveai_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Thin fetch wrapper that attaches the JWT and unwraps JSON / errors.
async function request(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  signup: (payload) => request("/auth/signup", { method: "POST", body: payload }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload }),
  me: () => request("/auth/me"),
  createInterview: (type) => request("/interviews", { method: "POST", body: { type } }),
  listInterviews: () => request("/interviews"),
  getInterview: (id) => request(`/interviews/${id}`),
  finishInterview: (id) => request(`/interviews/${id}/finish`, { method: "POST" }),
};

// Build the WebSocket URL for the voice session (same origin -> Vite proxy).
export function voiceWsUrl(interviewId) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/api/interviews/${interviewId}/voice?token=${getToken()}`;
}
