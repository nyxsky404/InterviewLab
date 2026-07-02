import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import {
  finalizeInterview,
  getAssessments,
  computeMetrics,
  computeTimeline,
  computeStarRatings,
} from "../services/evaluation.js";

export const interviewsRouter = Router();

// Only "behavioral" is fully implemented; picker offers the rest as "coming soon".
const SUPPORTED_TYPES = ["behavioral"];

interviewsRouter.use(requireAuth);

// Create a new interview session.
interviewsRouter.post("/", async (req, res) => {
  const type = (req.body?.type || "behavioral").toLowerCase();
  if (!SUPPORTED_TYPES.includes(type)) {
    return res.status(400).json({ error: `Interview type "${type}" is not available yet` });
  }
  const { rows } = await query(
    `INSERT INTO interviews (user_id, type) VALUES ($1, $2)
     RETURNING id, type, status, started_at`,
    [req.userId, type]
  );
  return res.status(201).json({ interview: rows[0] });
});

// List the current user's interviews (with overall score if evaluated).
interviewsRouter.get("/", async (req, res) => {
  const { rows } = await query(
    `SELECT i.id, i.type, i.status, i.started_at, i.ended_at,
            f.overall_score
       FROM interviews i
       LEFT JOIN feedback f ON f.interview_id = i.id
      WHERE i.user_id = $1
      ORDER BY i.started_at DESC`,
    [req.userId]
  );
  return res.json({ interviews: rows });
});

// Full detail: interview + transcript + feedback.
interviewsRouter.get("/:id", async (req, res) => {
  const interview = await getOwnedInterview(req.params.id, req.userId);
  if (!interview) return res.status(404).json({ error: "Interview not found" });

  const [{ rows: turns }, { rows: feedbackRows }, assessments] = await Promise.all([
    query(`SELECT role, content, seq, created_at FROM turns WHERE interview_id = $1 ORDER BY seq`, [
      interview.id,
    ]),
    query(`SELECT * FROM feedback WHERE interview_id = $1`, [interview.id]),
    getAssessments(interview.id),
  ]);

  // Prefer the report the post-call evaluator wrote; fall back to values derived
  // from the in-session assessments when the LLM report is absent.
  const feedback = feedbackRows[0] || null;
  const star = feedback?.star?.length ? feedback.star : computeStarRatings(assessments);

  // A story beat counts as covered if EITHER the post-call evaluator flagged it
  // OR the live interviewer logged an assessment against it. Relying on the
  // evaluator alone blanks the whole timeline whenever that model names topics
  // loosely; folding in the in-session tags keeps it honest to what happened.
  const liveCovered = new Set(
    computeTimeline(assessments).filter((t) => t.covered).map((t) => t.topic)
  );
  const baseTimeline = feedback?.timeline?.length ? feedback.timeline : computeTimeline(assessments);
  const timeline = baseTimeline.map((t) => ({
    ...t,
    covered: t.covered || liveCovered.has(t.topic),
  }));

  return res.json({
    interview,
    turns,
    feedback,
    assessments,
    metrics: computeMetrics(turns, assessments),
    timeline,
    star,
  });
});

// Close the session and generate the report from the transcript (falling back
// to the in-session assessments if the external evaluator is unavailable).
interviewsRouter.post("/:id/finish", async (req, res) => {
  const interview = await getOwnedInterview(req.params.id, req.userId);
  if (!interview) return res.status(404).json({ error: "Interview not found" });

  await query(
    `UPDATE interviews SET status = 'completed', ended_at = now()
      WHERE id = $1 AND status <> 'completed'`,
    [interview.id]
  );
  const feedback = await finalizeInterview(interview.id);
  return res.json({ ok: true, feedback });
});

async function getOwnedInterview(id, userId) {
  const { rows } = await query(`SELECT * FROM interviews WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ]);
  return rows[0] || null;
}
