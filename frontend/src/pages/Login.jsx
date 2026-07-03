import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import Brand from "../components/Brand.jsx";
import "../styles/auth.css";

export default function Login() {
  const { onAuthed } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api.login(form);
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
        <span className="eyebrow">Sign in</span>
        <h1>Welcome back.</h1>
        <p className="lede">Pick up where you left off.</p>

        <form onSubmit={submit}>
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
            autoComplete="current-password"
            required
          />

          {error && <div className="error-banner">{error}</div>}

          <button className="btn primary big block" disabled={busy}>
            {busy ? "Signing you in…" : "Log in"}
          </button>
        </form>

        <p className="auth-switch">
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </div>
      <p className="auth-foot">Practice interviews out loud with AI.</p>
    </div>
  );
}
