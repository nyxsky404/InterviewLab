import {
  finalizeInterview,
  computeMetrics,
  computeTimeline,
  computePhaseRatings,
} from "../services/reportService.js";
import { config } from "../config/config.js";
import { prisma } from "../data/prisma.js";
import { TYPE_KEYS, getClientRubric } from "../domain/interviewTypes.js";

const JD_MAX_CHARS = config.limits.jdMaxChars;

function cleanJd(value) {
  if (typeof value !== "string") return null;
  if (value.length > JD_MAX_CHARS) {
    const err = new Error(`jdText must be ${JD_MAX_CHARS.toLocaleString()} characters or fewer`);
    err.status = 400;
    throw err;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

export async function create(req, res) {
  const type = (req.body?.type).toLowerCase();
  if (!TYPE_KEYS.includes(type)) {
    return res.status(400).json({ error: `Unknown interview type "${type}"` });
  }
  const interview = await prisma.interview.create({
    data: { userId: Number(req.userId), type },
    select: { id: true, type: true, status: true, startedAt: true },
  });
  return res.status(201).json({ interview });
}

export async function patchJd(req, res) {
  let jdText;
  try {
    jdText = cleanJd(req.body?.jdText);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const result = await prisma.interview.updateManyAndReturn({
    where: { id: Number(req.params.id), userId: Number(req.userId), status: "in_progress" },
    data: { jdText },
    select: { id: true, type: true, status: true, startedAt: true },
  });
  const interview = result[0];
  if (!interview) {
    return res.status(404).json({ error: "Interview not found or already completed" });
  }
  return res.json({ interview });
}

export async function list(req, res) {
  const rows = await prisma.interview.findMany({
    where: { userId: Number(req.userId) },
    orderBy: { startedAt: "desc" },
    include: { feedback: { select: { overallScore: true } } },
  });
  const interviews = rows.map((interview) => ({
    id: interview.id,
    type: interview.type,
    status: interview.status,
    startedAt: interview.startedAt,
    endedAt: interview.endedAt,
    overallScore: interview.feedback?.overallScore ?? null,
  }));
  return res.json({ interviews });
}

export async function finishAndGenerateFeedback(req, res) {
  const interview = await prisma.interview.findFirst({
    where: { id: Number(req.params.id), userId: Number(req.userId) },
  });
  if (!interview) return res.status(404).json({ error: "Interview not found" });

  await prisma.interview.updateMany({
    where: { id: interview.id, status: { not: "completed" } },
    data: { status: "completed", endedAt: new Date() },
  });
  const feedback = await finalizeInterview(interview.id);
  return res.json({ ok: true, feedback });
}

export async function getReport(req, res) {
  const interview = await prisma.interview.findFirst({
    where: { id: Number(req.params.id), userId: Number(req.userId) },
  });
  if (!interview) return res.status(404).json({ error: "Interview not found" });

  const [transcriptions, feedback, assessments] = await Promise.all([
    prisma.transcription.findMany({
      where: { interviewId: interview.id },
      orderBy: { seq: "asc" },
    }),
    prisma.feedback.findUnique({ where: { interviewId: interview.id } }),
    prisma.assessment.findMany({
      where: { interviewId: interview.id },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const star = feedback?.star?.length
    ? feedback.star
    : computePhaseRatings(assessments, interview.type);

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
    transcriptions,
    feedback,
    assessments,
    metrics: computeMetrics(transcriptions, assessments),
    timeline,
    star,
    rubric: getClientRubric(interview.type),
  });
}
