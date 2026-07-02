import {
  createInterview,
  listInterviewsByUser,
  findOwnedInterview,
  completeInterview,
} from "../models/interviewModel.js";
import { listTurns } from "../models/turnModel.js";
import { listAssessments } from "../models/assessmentModel.js";
import { findFeedback } from "../models/feedbackModel.js";
import {
  finalizeInterview,
  computeMetrics,
  computeTimeline,
  computePhaseRatings,
} from "../services/reportService.js";
import { TYPE_KEYS, publicRubric } from "../domain/interviewTypes.js";

export async function create(req, res) {
  const type = (req.body?.type || "behavioral").toLowerCase();
  if (!TYPE_KEYS.includes(type)) {
    return res.status(400).json({ error: `Unknown interview type "${type}"` });
  }
  const interview = await createInterview(req.userId, type);
  return res.status(201).json({ interview });
}

export async function list(req, res) {
  const interviews = await listInterviewsByUser(req.userId);
  return res.json({ interviews });
}

// Full detail: interview + transcript + feedback.
export async function detail(req, res) {
  const interview = await findOwnedInterview(req.params.id, req.userId);
  if (!interview) return res.status(404).json({ error: "Interview not found" });

  const [turns, feedback, assessments] = await Promise.all([
    listTurns(interview.id),
    findFeedback(interview.id),
    listAssessments(interview.id),
  ]);

  // Prefer the report the post-call evaluator wrote; fall back to values derived
  // from the in-session assessments when the LLM report is absent.
  const star = feedback?.star?.length
    ? feedback.star
    : computePhaseRatings(assessments, interview.type);

  // A topic counts as covered if EITHER the post-call evaluator flagged it
  // OR the live interviewer logged an assessment against it. Relying on the
  // evaluator alone blanks the whole timeline whenever that model names topics
  // loosely; folding in the in-session tags keeps it honest to what happened.
  const liveCovered = new Set(
    computeTimeline(assessments, interview.type).filter((t) => t.covered).map((t) => t.topic)
  );
  const baseTimeline = feedback?.timeline?.length
    ? feedback.timeline
    : computeTimeline(assessments, interview.type);
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
    rubric: publicRubric(interview.type),
  });
}

// Close the session and generate the report from the transcript (falling back
// to the in-session assessments if the external evaluator is unavailable).
export async function finish(req, res) {
  const interview = await findOwnedInterview(req.params.id, req.userId);
  if (!interview) return res.status(404).json({ error: "Interview not found" });

  await completeInterview(interview.id);
  const feedback = await finalizeInterview(interview.id);
  return res.json({ ok: true, feedback });
}
