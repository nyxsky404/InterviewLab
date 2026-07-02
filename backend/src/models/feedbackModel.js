import { query } from "../db/pool.js";

export async function findFeedback(interviewId) {
  const { rows } = await query(`SELECT * FROM feedback WHERE interview_id = $1`, [interviewId]);
  return rows[0] || null;
}

// Full upsert used by the transcript evaluator — writes every report column.
export async function upsertFeedback(interviewId, f) {
  const { rows } = await query(
    `INSERT INTO feedback
       (interview_id, overall_score, summary, verdict, top_priorities,
        per_competency, strengths, growth_areas, star, timeline, exchanges)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (interview_id) DO UPDATE SET
       overall_score = EXCLUDED.overall_score,
       summary       = EXCLUDED.summary,
       verdict       = EXCLUDED.verdict,
       top_priorities= EXCLUDED.top_priorities,
       per_competency= EXCLUDED.per_competency,
       strengths     = EXCLUDED.strengths,
       growth_areas  = EXCLUDED.growth_areas,
       star          = EXCLUDED.star,
       timeline      = EXCLUDED.timeline,
       exchanges     = EXCLUDED.exchanges
     RETURNING *`,
    [
      interviewId,
      f.overall_score ?? null,
      f.summary || "",
      f.verdict || "",
      JSON.stringify(f.top_priorities || []),
      JSON.stringify(f.per_competency || []),
      JSON.stringify(f.strengths || []),
      JSON.stringify(f.growth_areas || []),
      JSON.stringify(f.star || []),
      JSON.stringify(f.timeline || []),
      JSON.stringify(f.exchanges || []),
    ]
  );
  return rows[0];
}

// Fallback path (no external evaluator): write the assessment-derived report,
// but never clobber a report that already exists.
export async function insertFeedbackIfAbsent(interviewId, f) {
  const { rows } = await query(
    `INSERT INTO feedback (interview_id, overall_score, summary, verdict, top_priorities, per_competency, strengths, growth_areas)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (interview_id) DO NOTHING
     RETURNING *`,
    [
      interviewId,
      f.overall_score ?? null,
      f.summary || "",
      f.verdict || "",
      JSON.stringify(f.top_priorities || []),
      JSON.stringify(f.per_competency || []),
      JSON.stringify(f.strengths || []),
      JSON.stringify(f.growth_areas || []),
    ]
  );
  if (rows[0]) return rows[0];
  return findFeedback(interviewId);
}
