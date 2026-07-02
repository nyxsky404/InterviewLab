import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

const TYPES = [
  {
    id: "behavioral",
    label: "Behavioral",
    blurb: "Communication, STAR structure, self-awareness.",
    available: true,
  },
  { id: "technical", label: "Technical", blurb: "Depth of knowledge, problem-solving.", available: false },
  {
    id: "system_design",
    label: "System Design",
    blurb: "Architecture, tradeoffs, communicating complexity.",
    available: false,
  },
  { id: "hr", label: "HR / Culture Fit", blurb: "Motivation, values, judgment.", available: false },
];

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [interviews, setInterviews] = useState([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listInterviews().then((d) => setInterviews(d.interviews)).catch(() => {});
  }, []);

  async function start(typeId) {
    setStarting(true);
    setError("");
    try {
      const { interview } = await api.createInterview(typeId);
      navigate(`/interview/${interview.id}`);
    } catch (err) {
      setError(err.message);
      setStarting(false);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <div className="brand">🎙️ Mock Interview</div>
          <div className="muted small">
            {user.name} · {user.jobRole} · {user.experienceLevel}
          </div>
        </div>
        <button className="btn ghost" onClick={logout}>
          Log out
        </button>
      </header>

      <section>
        <h2>Start a new interview</h2>
        <div className="type-grid">
          {TYPES.map((t) => (
            <button
              key={t.id}
              className={`type-card ${t.available ? "" : "disabled"}`}
              disabled={!t.available || starting}
              onClick={() => t.available && start(t.id)}
            >
              <div className="type-head">
                <span className="type-label">{t.label}</span>
                {!t.available && <span className="pill">Coming soon</span>}
              </div>
              <p className="muted small">{t.blurb}</p>
            </button>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
      </section>

      <section>
        <h2>Past sessions</h2>
        {interviews.length === 0 ? (
          <p className="muted">No interviews yet. Start one above.</p>
        ) : (
          <div className="session-list">
            {interviews.map((iv) => (
              <SessionRow key={iv.id} iv={iv} navigate={navigate} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SessionRow({ iv, navigate }) {
  const date = new Date(iv.started_at).toLocaleString();
  const done = iv.status === "completed";
  return (
    <div className="session-row">
      <div>
        <div className="session-type">{iv.type}</div>
        <div className="muted small">{date}</div>
      </div>
      <div className="session-right">
        <span className={`status ${done ? "done" : "open"}`}>{iv.status}</span>
        {iv.overall_score != null && <span className="score-chip">{iv.overall_score}/100</span>}
        {done ? (
          <button className="btn small" onClick={() => navigate(`/interview/${iv.id}/report`)}>
            View report
          </button>
        ) : (
          <button className="btn small" onClick={() => navigate(`/interview/${iv.id}`)}>
            Resume
          </button>
        )}
      </div>
    </div>
  );
}
