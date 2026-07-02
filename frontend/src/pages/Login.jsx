import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

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
      <form className="card auth-card" onSubmit={submit}>
        <h1>Welcome back</h1>
        <p className="muted">Log in to practice a mock interview.</p>

        <label>Email</label>
        <input type="email" value={form.email} onChange={set("email")} required />

        <label>Password</label>
        <input type="password" value={form.password} onChange={set("password")} required />

        {error && <div className="error">{error}</div>}

        <button className="btn primary" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
        <p className="muted center">
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </form>
    </div>
  );
}
