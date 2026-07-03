import { memo, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import Brand from "../components/Brand.jsx";
import ProfileModal from "../components/ProfileModal.jsx";
import { INTERVIEW_TYPES, TypeIcon, typeMeta } from "../interviewTypes.jsx";
import "../styles/dashboard.css";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [interviews, setInterviews] = useState([]);
  const [startingType, setStartingType] = useState(null);
  const [error, setError] = useState("");
  const [showProfile, setShowProfile] = useState(false);

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
  
  async function startOver(typeId) {
    setError("");
    try {
      const { interview } = await api.createInterview(typeId);
      navigate(`/interview/${interview.id}`);
    } catch (err) {
      setError(err.message);
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
          <button
            className="user-chip"
            onClick={() => setShowProfile(true)}
            title="Edit your profile"
          >
            <span className="avatar">{initials}</span>
            <span className="who">
              <span className="name">{user.name}</span>
              <br />
              <span className="role">
                {user.jobRole} · {user.experienceLevel}
              </span>
            </span>
          </button>
          <button className="btn ghost small" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      {!user.hasResume && (
        <button className="personalize-banner fade-up" onClick={() => setShowProfile(true)}>
          <span className="pb-icon">
            <TypeIcon icon="doc" size={18} />
          </span>
          <span className="pb-text">
            <strong>Add your resume for a tailored interview.</strong> The interviewer will ask
            about your real projects, and your report gets a resume-vs-interview gap analysis.
          </span>
          <span className="pb-cta">Add resume →</span>
        </button>
      )}

      <section className="fade-up">
        <div className="section-head">
          <span className="eyebrow">New session</span>
          <h2>Start a new interview.</h2>
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
          <span className="eyebrow">History</span>
          <h2>Past sessions.</h2>
        </div>
        <div className="session-list">
          {interviews.length === 0 ? (
            <div className="empty-state">
              No interviews yet — pick a format above to run your first one.
            </div>
          ) : (
            interviews.map((iv) => (
              <SessionRow key={iv.id} iv={iv} navigate={navigate} onStartOver={startOver} />
            ))
          )}
        </div>
      </section>

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </div>
  );
}

const SessionRow = memo(function SessionRow({ iv, navigate, onStartOver }) {
  const meta = typeMeta(iv.type);
  const done = iv.status === "completed";
  const abandoned = iv.status === "abandoned";
  const date = new Date(iv.startedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = new Date(iv.startedAt).toLocaleTimeString(undefined, {
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
        {iv.overallScore != null && <span className="score-chip">{iv.overallScore}</span>}
        <span className={`pill ${done ? "done" : abandoned ? "abandoned" : "open"}`}>
          {done ? "Completed" : abandoned ? "Abandoned" : "In progress"}
        </span>
        {done ? (
          <button className="btn small" onClick={() => navigate(`/interview/${iv.id}/report`)}>
            View report
          </button>
        ) : abandoned ? (
          <button className="btn small" onClick={() => onStartOver(iv.type)}>
            Start over
          </button>
        ) : (
          <button className="btn small" onClick={() => navigate(`/interview/${iv.id}`)}>
            Resume
          </button>
        )}
      </div>
    </div>
  );
});
