import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";

// The full behavioral rubric. We always show every competency (even the ones a
// given interview didn't reach) so the candidate sees their whole profile, not
// just the two or three areas that happened to come up.
const COMPETENCIES = [
  ["ownership", "Ownership", "What they personally drove vs. the team"],
  ["communication", "Communication", "Clarity, structure, and pacing of answers"],
  ["star_structure", "STAR structure", "Situation → Task → Action → Result storytelling"],
  ["self_awareness", "Self-awareness", "Reflection on mistakes and what they'd change"],
  ["impact", "Impact", "Measurable outcomes and validated results"],
];

// Turn a 0–100 score into something meaningful. This is the single biggest
// "what does my number mean?" gap a bare score leaves open.
const SCORE_BANDS = [
  { min: 90, label: "Outstanding", tone: "great", blurb: "Interview-ready. Strong, specific, and self-aware across the board." },
  { min: 80, label: "Strong", tone: "great", blurb: "Competitive for most roles. A few areas would push this to outstanding." },
  { min: 70, label: "Competitive", tone: "good", blurb: "Solid foundation. Tightening ownership and depth would make this stand out." },
  { min: 60, label: "Needs Improvement", tone: "warn", blurb: "The story is there, but answers need more specifics and reflection." },
  { min: 0, label: "Significant Work", tone: "bad", blurb: "Focus on structure and concrete examples before the next interview." },
];

function bandFor(score) {
  if (score == null) return null;
  return SCORE_BANDS.find((b) => score >= b.min) || SCORE_BANDS[SCORE_BANDS.length - 1];
}

export default function Report() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getInterview(id)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="page center error">{error}</div>;
  if (!data) return <div className="center muted">Loading report…</div>;

  const { interview, turns, feedback, assessments = [], metrics, star = [], timeline = [] } = data;

  // Deepgram emits one row per spoken segment, so a single turn arrives as
  // several rows. Merge consecutive same-speaker segments into one block, the
  // same way the live captions do, so the transcript reads as whole turns.
  const mergedTurns = [];
  for (const t of turns) {
    const last = mergedTurns[mergedTurns.length - 1];
    if (last && last.role === t.role) last.content = `${last.content} ${t.content}`.trim();
    else mergedTurns.push({ role: t.role, content: t.content });
  }
  const perComp = feedback?.per_competency || [];
  const score = feedback?.overall_score ?? null;
  const band = bandFor(score);

  // Index the live per-answer scores/notes by competency so each rubric row can
  // show its own score and the concrete evidence behind it.
  const byComp = {};
  for (const a of assessments) {
    (byComp[a.competency] ||= []).push(a);
  }
  const scoreMap = Object.fromEntries(perComp.map((c) => [c.competency, c.score]));
  // The post-call evaluator attaches an evidence quote per competency; prefer it
  // over the reconstructed assessment notes when present.
  const evidenceMap = Object.fromEntries(
    perComp.filter((c) => c.evidence).map((c) => [c.competency, c.evidence])
  );

  return (
    <div className="page report">
      <header className="topbar">
        <div className="brand">Interview report</div>
        <Link className="btn ghost" to="/">
          ← Dashboard
        </Link>
      </header>

      {/* Overall score, now with an interpretation and the scale it sits on. */}
      <section className="card score-card">
        <div className="muted small">Overall performance</div>
        <div className="big-score">
          {score != null ? score : "—"}
          <span className="out-of">/100</span>
        </div>
        {band && <div className={`band-pill ${band.tone}`}>{band.label}</div>}
        {band && <p className="summary">{band.blurb}</p>}
        {feedback?.summary && <p className="summary muted">{feedback.summary}</p>}
        <ScoreScale score={score} />
      </section>

      {/* The verdict candidates actually want: would I advance, and why. */}
      {feedback?.verdict && (
        <section className="card verdict-card">
          <div className="verdict-head">Hiring manager verdict</div>
          <p className="verdict-body">{feedback.verdict}</p>
        </section>
      )}

      {/* The single most actionable takeaway — what to fix first. */}
      {feedback?.top_priorities?.length > 0 && (
        <section className="card priorities-card">
          <h3>Top 3 things to improve</h3>
          <ol className="priorities">
            {feedback.top_priorities.slice(0, 3).map((p, i) => (
              <li key={i}>
                <span className="pri-num">{i + 1}</span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Measured answer-quality signals — everything here is counted from the
          transcript, not estimated. */}
      {metrics && <MetricsPanel metrics={metrics} />}

      {/* STAR breakdown + what the interviewer actually explored. Both are
          derived from the per-answer story-beat tags, so they reflect the real
          shape of the conversation. */}
      {(star.some((s) => s.rating != null) || timeline.length > 0) && (
        <div className="report-grid">
          {star.some((s) => s.rating != null) && <StarPanel star={star} />}
          {timeline.length > 0 && <TimelinePanel timeline={timeline} />}
        </div>
      )}

      <div className="report-grid">
        <section className="card">
          <h3>Competency breakdown</h3>
          {COMPETENCIES.map(([key, label, hint]) => {
            const s = scoreMap[key];
            const llmEvidence = evidenceMap[key];
            const notes = byComp[key] || [];
            return (
              <div key={key} className="bar-row">
                <div className="bar-label">
                  {label}
                  {s != null ? (
                    <span className="muted small"> · {s}/5</span>
                  ) : (
                    <span className="muted small"> · not assessed</span>
                  )}
                  <div className="muted small comp-hint">{hint}</div>
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${s != null ? (s / 5) * 100 : 0}%`, opacity: s != null ? 1 : 0.25 }}
                  />
                </div>
                {llmEvidence ? (
                  <ul className="evidence">
                    <li>
                      <span className={`tag ${s >= 4 ? "pos" : s <= 2 ? "neg" : "mid"}`}>
                        evidence
                      </span>
                      “{llmEvidence}”
                    </li>
                  </ul>
                ) : notes.length > 0 ? (
                  <ul className="evidence">
                    {notes.slice(0, 2).map((n, i) => (
                      <li key={i}>
                        <span className={`tag ${n.score >= 4 ? "pos" : n.score <= 2 ? "neg" : "mid"}`}>
                          {n.score}/5
                        </span>
                        {n.note}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </section>

        <section className="card">
          <h3>Strengths</h3>
          <List items={feedback?.strengths} empty="No strengths captured." icon="✓" iconClass="pos" />
          <h3 style={{ marginTop: 22 }}>Growth areas</h3>
          <List
            items={feedback?.growth_areas}
            empty="No growth areas captured."
            icon="→"
            iconClass="neg"
          />
        </section>
      </div>

      <section className="card transcript-card">
        <h3>Transcript</h3>
        <div className="muted small">
          {interview.type} · {new Date(interview.started_at).toLocaleString()}
        </div>
        <div className="transcript">
          {mergedTurns.length === 0 ? (
            <p className="muted">No conversation was recorded.</p>
          ) : (
            mergedTurns.map((t, i) => (
              <div key={i} className={`caption ${t.role}`}>
                <span className="who">{t.role === "assistant" ? "Interviewer" : "You"}</span>
                <span className="what">{t.content}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ScoreScale({ score }) {
  return (
    <div className="scale">
      {SCORE_BANDS.slice().reverse().map((b) => {
        const active = bandFor(score)?.label === b.label;
        return (
          <div key={b.label} className={`scale-step ${b.tone} ${active ? "active" : ""}`}>
            <div className="scale-range">
              {b.min}
              {b.min === 90 ? "+" : `–${nextMax(b.min)}`}
            </div>
            <div className="scale-name">{b.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function nextMax(min) {
  const idx = SCORE_BANDS.findIndex((b) => b.min === min);
  return idx > 0 ? SCORE_BANDS[idx - 1].min - 1 : 100;
}

function MetricsPanel({ metrics }) {
  const items = [
    ["Answers given", metrics.answersGiven],
    ["Follow-ups asked", metrics.questionsAsked],
    ["Avg. answer length", `${metrics.avgAnswerWords} words`],
    ["Longest answer", `${metrics.longestAnswerWords} words`],
    ["Evidence points scored", metrics.evidencePoints],
    ["Answers with metrics", metrics.quantifiedAnswers],
  ];
  return (
    <section className="card metrics-card">
      <h3>Answer quality</h3>
      <div className="metrics-grid">
        {items.map(([label, value]) => (
          <div key={label} className="metric">
            <div className="metric-value">{value}</div>
            <div className="metric-label muted small">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StarPanel({ star }) {
  return (
    <section className="card">
      <h3>STAR storytelling</h3>
      <div className="muted small" style={{ marginBottom: 12 }}>
        How completely each part of your stories came through.
      </div>
      {star.map((s) => (
        <div key={s.phase} className="star-row">
          <div className="star-name">{s.phase}</div>
          {s.rating != null ? (
            <Stars value={s.rating} />
          ) : (
            <span className="muted small">not covered</span>
          )}
        </div>
      ))}
    </section>
  );
}

function Stars({ value }) {
  // value is 1–5 in 0.5 steps.
  return (
    <div className="stars" title={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, value - (i - 1)));
        return (
          <span key={i} className="star">
            <span className="star-bg">★</span>
            <span className="star-fg" style={{ width: `${fill * 100}%` }}>
              ★
            </span>
          </span>
        );
      })}
    </div>
  );
}

function TimelinePanel({ timeline }) {
  return (
    <section className="card">
      <h3>Interview timeline</h3>
      <div className="muted small" style={{ marginBottom: 12 }}>
        The story beats your interviewer explored — and the ones they didn't get to.
      </div>
      <ul className="timeline">
        {timeline.map((t) => (
          <li key={t.topic} className={t.covered ? "done" : "missed"}>
            <span className="tl-mark">{t.covered ? "✓" : "⚠"}</span>
            <span>{t.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function List({ items, empty, icon, iconClass }) {
  if (!items || items.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul className="feedback-list">
      {items.map((it, i) => (
        <li key={i}>
          <span className={`li-icon ${iconClass}`}>{icon}</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}
