import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import Brand from "../components/Brand.jsx";
import "../styles/auth.css";

const LEVELS = [
  { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid" },
  { value: "senior", label: "Senior" }
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
      <Brand />
      <div className="card auth-card fade-up">
        <span className="eyebrow">Get started</span>
        <h1>Create your account.</h1>
        <p className="lede">A quick profile lets the interviewer tailor its questions to you.</p>

        <form onSubmit={submit}>
          <label htmlFor="name">Full name</label>
          <input
            id="name"
            value={form.name}
            onChange={set("name")}
            placeholder="Casey Candidate"
            autoComplete="name"
            required
          />

          <label htmlFor="jobRole">Target job role</label>
          <input
            id="jobRole"
            value={form.jobRole}
            onChange={set("jobRole")}
            placeholder="Backend Engineer"
            required
          />

          <label>Experience level</label>
          <div className="segmented" role="radiogroup" aria-label="Experience level">
            {LEVELS.map((l) => (
              <button
                key={l.value}
                type="button"
                className={form.experienceLevel === l.value ? "active" : ""}
                onClick={() => setForm({ ...form, experienceLevel: l.value })}
              >
                {l.label}
              </button>
            ))}
          </div>

          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={form.email}
            onChange={set("email")}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={form.password}
            onChange={set("password")}
            placeholder="At least 6 characters"
            autoComplete="new-password"
            required
          />

          {error && <div className="error-banner">{error}</div>}

          <button className="btn primary big block" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
      <p className="auth-foot">Real-time voice interviews with an adaptive AI interviewer.</p>
    </div>
  );
}
