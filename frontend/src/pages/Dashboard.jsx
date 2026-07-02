import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import Brand from "../components/Brand.jsx";
import { INTERVIEW_TYPES, TypeIcon, typeMeta } from "../interviewTypes.jsx";
import "../styles/dashboard.css";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [interviews, setInterviews] = useState([]);
  const [startingType, setStartingType] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listInterviews().then((d) => setInterviews(d.interviews)).catch(() => {});
  }, []);

  async function start(typeId) {
    setStartingType(typeId);
    setError("");
    try {
      const { interview } = await api.createInterview(typeId);
      navigate(`/interview/${interview.id}`);
    } catch (err) {
      setError(err.message);
      setStartingType(null);
    }
  }

  const initials = (user.name || "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="shell">
      <header className="topbar">
        <Brand />
        <div className="topbar-right">
          <div className="user-chip">
            <span className="avatar">{initials}</span>
            <span className="who">
              <span className="name">{user.name}</span>
              <br />
              <span className="role">
                {user.jobRole} · {user.experienceLevel}
              </span>
            </span>
          </div>
          <button className="btn ghost small" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <section className="fade-up">
        <div className="section-head">
          <h2>Start a new interview</h2>
          <p>Pick a format — your interviewer adapts to your role and level.</p>
        </div>
        <div className="type-grid">
          {INTERVIEW_TYPES.map((t) => (
            <button
              key={t.id}
              className="type-card"
              style={{ "--card-accent": t.accent, "--card-soft": t.soft }}
              disabled={startingType !== null}
              onClick={() => start(t.id)}
            >
              <span className="type-icon">
                <TypeIcon icon={t.icon} />
              </span>
              <span className="type-label">{t.label}</span>
              <span className="type-blurb">{t.blurb}</span>
              <span className="type-meta">
                {startingType === t.id ? "Starting…" : `with ${t.interviewer} · ~10 min · voice`}
              </span>
            </button>
          ))}
        </div>
        {error && <div className="error-banner">{error}</div>}
      </section>

      <section className="fade-up">
        <div className="section-head">
          <h2>Past sessions</h2>
        </div>
        <div className="session-list">
          {interviews.length === 0 ? (
            <div className="empty-state">
              No interviews yet — pick a format above to run your first one.
            </div>
          ) : (
            interviews.map((iv) => <SessionRow key={iv.id} iv={iv} navigate={navigate} />)
          )}
        </div>
      </section>
    </div>
  );
}

function SessionRow({ iv, navigate }) {
  const meta = typeMeta(iv.type);
  const done = iv.status === "completed";
  const date = new Date(iv.started_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = new Date(iv.started_at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="session-row">
      <div className="session-left">
        <span className="type-icon" style={{ background: meta.soft, color: meta.accent }}>
          <TypeIcon icon={meta.icon} size={17} />
        </span>
        <div>
          <div className="session-title">{meta.label} interview</div>
          <div className="session-date">
            {date} · {time}
          </div>
        </div>
      </div>
      <div className="session-right">
        {iv.overall_score != null && <span className="score-chip">{iv.overall_score}</span>}
        <span className={`pill ${done ? "done" : "open"}`}>
          {done ? "Completed" : "In progress"}
        </span>
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
