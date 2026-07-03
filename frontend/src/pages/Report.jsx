import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import Brand from "../components/Brand.jsx";
import { typeMeta } from "../interviewTypes.jsx";
import "../styles/dashboard.css";
import "../styles/report.css";

// Turn a 0–100 score into something meaningful. This is the single biggest
// "what does my number mean?" gap a bare score leaves open.
const SCORE_BANDS = [
  { min: 85, label: "Outstanding", tone: "great", color: "#29bc9b" },
  { min: 70, label: "Strong", tone: "good", color: "#0070f3" },
  { min: 55, label: "Developing", tone: "warn", color: "#f5a623" },
  { min: 0, label: "Needs work", tone: "bad", color: "#ee0000" },
];

function bandFor(score) {
  if (score == null) return null;
  return SCORE_BANDS.find((b) => score >= b.min) || SCORE_BANDS[SCORE_BANDS.length - 1];
}

export default function Report() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getInterview(id)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) {
    return (
      <div className="page-center">
        <div className="card report-empty">
          <h2>Couldn't load this report</h2>
          <p>{error}</p>
          <Link className="btn primary" to="/">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="page-center">
        <div className="spinner" aria-label="Loading report" />
      </div>
    );
  }

  const {
    interview,
    transcriptions = [],
    feedback,
    metrics,
    timeline = [],
    star = [],
    rubric,
  } = data;
  const meta = typeMeta(interview.type);
  const score = feedback?.overallScore ?? null;
  const band = bandFor(score);
  const exchanges = feedback?.exchanges || [];
  const perComp = feedback?.perCompetency || [];
  const scoreMap = Object.fromEntries(perComp.map((c) => [c.competency, c]));

  // The interview never really happened — no transcriptions, no feedback worth showing.
  if (!feedback && transcriptions.length === 0) {
    return (
      <div className="page-center">
        <div className="card report-empty">
          <h2>No conversation yet</h2>
          <p>This session ended before any conversation happened, so there's nothing to review.</p>
          <button className="btn primary" onClick={() => navigate("/")}>
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  const started = new Date(interview.startedAt);
  const durationMin =
    interview.endedAt != null
      ? Math.max(1, Math.round((new Date(interview.endedAt) - started) / 60000))
      : null;

  // Merge consecutive same-speaker STT segments into whole turns, the same way
  // the live captions do, so the transcript reads naturally.
  const mergedTranscriptions = [];
  for (const t of transcriptions) {
    const last = mergedTranscriptions[mergedTranscriptions.length - 1];
    if (last && last.role === t.role) last.content = `${last.content} ${t.content}`.trim();
    else mergedTranscriptions.push({ role: t.role, content: t.content });
  }

  return (
    <div className="report">
      <header className="topbar">
        <Brand />
        <Link className="btn small" to="/">
          ← Dashboard
        </Link>
      </header>

      {/* Hero: the number, what it means, and the session facts. */}
      <section className="card fade-up">
        <div className="hero">
          <ScoreRing score={score} color={band?.color} />
          <div className="hero-main">
            <div className="hero-meta">
              <span>{meta.label} interview</span>
              <span>with {rubric?.interviewer || meta.interviewer}</span>
              <span>{started.toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
              {durationMin && <span>{durationMin} min</span>}
            </div>
            <h1>
              Feedback report.
              {band && <span className={`band-pill ${band.tone}`}>{band.label}</span>}
            </h1>
            <p className="summary">
              {feedback?.summary ||
                "The written evaluation isn't available for this session — the breakdown below is built from the interviewer's live assessments."}
            </p>
          </div>
        </div>
      </section>

      {feedback?.verdict && (
        <section className="card verdict-card fade-up">
          <div className="verdict-head">Hiring manager verdict</div>
          <p className="verdict-body">{feedback.verdict}</p>
        </section>
      )}

      {feedback?.topPriorities?.length > 0 && (
        <section className="card fade-up">
          <h3>What to fix first</h3>
          <p className="hint">In order of impact on your next interview.</p>
          <ol className="priorities">
            {feedback.topPriorities.slice(0, 3).map((p, i) => (
              <li key={i}>
                <span className="pri-num">{i + 1}</span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="report-grid">
        {/* Competency breakdown, labeled by the type's own rubric. */}
        <section className="card">
          <h3>Competency breakdown</h3>
          <p className="hint">Scored 1–5 against a {meta.label.toLowerCase()} rubric.</p>
          {(rubric?.competencies || []).map((c) => {
            const entry = scoreMap[c.key];
            const s = entry?.score ?? null;
            return (
              <div key={c.key} className="bar-row">
                <div className="bar-top">
                  <span className="bar-name">{c.label}</span>
                  <span className="bar-score">{s != null ? `${s}/5` : "—"}</span>
                </div>
                <div className="bar-hint">{c.hint}</div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: s != null ? `${(s / 5) * 100}%` : 0 }}
                  />
                </div>
                {entry?.evidence && <div className="bar-evidence">“{entry.evidence}”</div>}
              </div>
            );
          })}
        </section>

        <div>
          {/* Phase ratings (STAR for behavioral, design coverage for SD, …) */}
          {star.some((s) => s.rating != null) && (
            <section className="card" style={{ marginTop: 0 }}>
              <h3>{rubric?.phaseTitle || "Coverage"}</h3>
              <p className="hint">How completely each phase came through.</p>
              {star.map((s) => (
                <div key={s.phase} className="phase-row">
                  <span className="phase-name">{s.phase}</span>
                  {s.rating != null ? (
                    <Stars value={s.rating} />
                  ) : (
                    <span className="not-covered">not covered</span>
                  )}
                </div>
              ))}
            </section>
          )}

          {timeline.length > 0 && (
            <section className="card">
              <h3>Topics explored</h3>
              <p className="hint">What the interviewer got to — and what it didn't.</p>
              <div className="timeline-chips">
                {timeline.map((t) => (
                  <span key={t.topic} className={`tl-chip ${t.covered ? "covered" : ""}`}>
                    {t.covered ? "✓" : "·"} {t.label}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Question-by-question review from the transcript evaluator. */}
      {exchanges.length > 0 && (
        <section className="card fade-up">
          <h3>Question-by-question review</h3>
          <p className="hint">Every substantive exchange, rated with a concrete improvement.</p>
          {exchanges.map((e, i) => (
            <div key={i} className="exchange">
              <div className="exchange-head">
                <span className="exchange-q">{e.question}</span>
                <span className={`rating-pill ${e.rating}`}>{e.rating}</span>
              </div>
              {e.answer_gist && <div className="exchange-gist">You: {e.answer_gist}</div>}
              <div className="exchange-comment">{e.comment}</div>
              {e.improvement && (
                <div className="exchange-improve">
                  <b>Try:</b>
                  <span>{e.improvement}</span>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      <div className="report-grid">
        <section className="card">
          <h3>Strengths</h3>
          <FeedbackList items={feedback?.strengths} empty="No strengths captured." icon="✓" tone="pos" />
        </section>
        <section className="card">
          <h3>Growth areas</h3>
          <FeedbackList items={feedback?.growthAreas} empty="No growth areas captured." icon="→" tone="neg" />
        </section>
      </div>

      {/* Honest, measured delivery numbers — counted, not estimated. */}
      {metrics && metrics.answersGiven > 0 && (
        <section className="card fade-up">
          <h3>Delivery</h3>
          <p className="hint">Measured from your transcript — nothing here is estimated.</p>
          <div className="metrics-grid">
            <Metric value={`${metrics.talkRatio}%`} label="Your share of the talking" />
            <Metric value={metrics.answersGiven} label="Answers given" />
            <Metric value={`${metrics.avgAnswerWords}`} label="Avg words per answer" />
            <Metric value={metrics.quantifiedAnswers} label="Answers citing numbers" />
            <Metric value={metrics.fillerWords} label="Filler words" />
            <Metric value={`${metrics.fillerRate}%`} label="Filler rate" />
          </div>
        </section>
      )}

      <section className="card">
        <details className="transcript-details">
          <summary>Full transcript ({mergedTranscriptions.length} turns)</summary>
          <div className="report-transcript">
            {mergedTranscriptions.length === 0 ? (
              <p className="muted">No conversation was recorded.</p>
            ) : (
              mergedTranscriptions.map((t, i) => (
                <div key={i} className={`rt-line ${t.role}`}>
                  <span className="rt-who">
                    {t.role === "assistant" ? rubric?.interviewer || "Interviewer" : "You"}
                  </span>
                  <div className="rt-text">{t.content}</div>
                </div>
              ))
            )}
          </div>
        </details>
      </section>
    </div>
  );
}

// Animated circular score gauge.
function ScoreRing({ score, color }) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const r = 58;
  const c = 2 * Math.PI * r;
  const pct = score != null ? Math.max(0, Math.min(100, score)) : 0;
  const offset = drawn ? c - (pct / 100) * c : c;

  return (
    <div className="score-ring" style={{ "--ring-color": color }}>
      <svg width="132" height="132" viewBox="0 0 132 132" fill="none">
        <circle className="track" cx="66" cy="66" r={r} strokeWidth="9" fill="none" />
        <circle
          className="fill"
          cx="66"
          cy="66"
          r={r}
          strokeWidth="9"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="value">
        <div>
          <div className="n">{score != null ? score : "—"}</div>
          <div className="of">out of 100</div>
        </div>
      </div>
    </div>
  );
}

function Stars({ value }) {
  // value is 1–5 in 0.5 steps.
  return (
    <span className="stars" title={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, value - (i - 1)));
        return (
          <span key={i} className="star">
            ★
            <span className="star-fg" style={{ width: `${fill * 100}%` }}>
              ★
            </span>
          </span>
        );
      })}
    </span>
  );
}

function Metric({ value, label }) {
  return (
    <div className="metric">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

function FeedbackList({ items, empty, icon, tone }) {
  if (!items || items.length === 0) return <p className="muted small">{empty}</p>;
  return (
    <ul className="feedback-list">
      {items.map((it, i) => (
        <li key={i}>
          <span className={`li-icon ${tone}`}>{icon}</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}
