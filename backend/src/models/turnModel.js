import { query } from "../db/pool.js";

export async function addTurn(interviewId, seq, role, content) {
  await query(`INSERT INTO turns (interview_id, seq, role, content) VALUES ($1, $2, $3, $4)`, [
    interviewId,
    seq,
    role,
    content,
  ]);
}

export async function listTurns(interviewId) {
  const { rows } = await query(
    `SELECT role, content, seq, created_at FROM turns WHERE interview_id = $1 ORDER BY seq`,
    [interviewId]
  );
  return rows;
}

export async function maxTurnSeq(interviewId) {
  const { rows } = await query(
    `SELECT COALESCE(MAX(seq), 0) AS max FROM turns WHERE interview_id = $1`,
    [interviewId]
  );
  return Number(rows[0].max);
}
