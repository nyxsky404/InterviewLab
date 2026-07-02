import { query } from "../db/pool.js";

export async function createInterview(userId, type) {
  const { rows } = await query(
    `INSERT INTO interviews (user_id, type) VALUES ($1, $2)
     RETURNING id, type, status, started_at`,
    [userId, type]
  );
  return rows[0];
}

export async function listInterviewsByUser(userId) {
  const { rows } = await query(
    `SELECT i.id, i.type, i.status, i.started_at, i.ended_at,
            f.overall_score
       FROM interviews i
       LEFT JOIN feedback f ON f.interview_id = i.id
      WHERE i.user_id = $1
      ORDER BY i.started_at DESC`,
    [userId]
  );
  return rows;
}

export async function findOwnedInterview(id, userId) {
  const { rows } = await query(`SELECT * FROM interviews WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ]);
  return rows[0] || null;
}

// Interview + the candidate profile the voice agent needs, used to authorize
// and configure the WebSocket session on the HTTP upgrade.
export async function findVoiceSession(interviewId, userId) {
  const { rows } = await query(
    `SELECT i.id, i.type, i.status, u.name, u.job_role, u.experience_level
       FROM interviews i JOIN users u ON u.id = i.user_id
      WHERE i.id = $1 AND i.user_id = $2`,
    [interviewId, userId]
  );
  return rows[0] || null;
}

export async function completeInterview(id) {
  await query(
    `UPDATE interviews SET status = 'completed', ended_at = now()
      WHERE id = $1 AND status <> 'completed'`,
    [id]
  );
}

export async function setDeepgramRequestId(id, requestId) {
  await query(`UPDATE interviews SET deepgram_request_id = $1 WHERE id = $2`, [requestId, id]);
}

// Candidate profile + type for the post-call evaluator.
export async function getEvaluationContext(interviewId) {
  const { rows } = await query(
    `SELECT i.type, u.name, u.job_role, u.experience_level
       FROM interviews i JOIN users u ON u.id = i.user_id
      WHERE i.id = $1`,
    [interviewId]
  );
  return rows[0] || null;
}
