import { query } from "../db/pool.js";

// One live rubric judgment logged by the in-session LLM (record_assessment).
export async function addAssessment(interviewId, { competency, topic, score, note }) {
  await query(
    `INSERT INTO assessments (interview_id, competency, topic, score, note) VALUES ($1, $2, $3, $4, $5)`,
    [interviewId, competency, topic, score, note]
  );
}

export async function listAssessments(interviewId) {
  const { rows } = await query(
    `SELECT competency, topic, score, note, created_at
       FROM assessments
      WHERE interview_id = $1
      ORDER BY created_at`,
    [interviewId]
  );
  return rows;
}

// Average score (1–5) per competency across the session.
export async function averageByCompetency(interviewId) {
  const { rows } = await query(
    `SELECT competency,
            ROUND(AVG(score)::numeric, 1) AS avg_score,
            COUNT(*)::int AS samples
       FROM assessments
      WHERE interview_id = $1
      GROUP BY competency
      ORDER BY competency`,
    [interviewId]
  );
  return rows.map((r) => ({
    competency: r.competency,
    score: Number(r.avg_score),
    samples: r.samples,
  }));
}

// Noted judgments ordered strongest-first (drives fallback strengths/growth).
export async function listNotedAssessments(interviewId) {
  const { rows } = await query(
    `SELECT competency, score, note FROM assessments
      WHERE interview_id = $1 AND note IS NOT NULL AND note <> ''
      ORDER BY score DESC`,
    [interviewId]
  );
  return rows;
}
