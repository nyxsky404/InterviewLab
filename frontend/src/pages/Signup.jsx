import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

const LEVELS = [
  { value: "junior", label: "Junior (0–2 yrs)" },
  { value: "mid", label: "Mid (2–5 yrs)" },
  { value: "senior", label: "Senior (5–8 yrs)" },
  { value: "staff", label: "Staff+ (8+ yrs)" },
];

export default function Signup() {
  const { onAuthed } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    jobRole: "",
    experienceLevel: "mid",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api.signup(form);
      onAuthed(res);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Create your account</h1>
        <p className="muted">Set up a quick profile so the interviewer can tailor questions.</p>

        <label>Full name</label>
        <input value={form.name} onChange={set("name")} placeholder="Casey Candidate" required />

        <label>Target job role</label>
        <input
          value={form.jobRole}
          onChange={set("jobRole")}
          placeholder="Backend Engineer"
          required
        />

        <label>Experience level</label>
        <select value={form.experienceLevel} onChange={set("experienceLevel")}>
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>

        <label>Email</label>
        <input type="email" value={form.email} onChange={set("email")} required />

        <label>Password</label>
        <input
          type="password"
          value={form.password}
          onChange={set("password")}
          placeholder="At least 6 characters"
          required
        />

        {error && <div className="error">{error}</div>}

        <button className="btn primary" disabled={busy}>
          {busy ? "Creating…" : "Sign up"}
        </button>
        <p className="muted center">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
