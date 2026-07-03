import { Prisma } from "@prisma/client";
import { config } from "../config/config.js";
import { prisma } from "../data/prisma.js";
import { getInterviewTypeConfig, getTopicLabels } from "../domain/interviewTypes.js";
import { clampInt } from "../utils/clamp.js";

// Flatten an interview (+ its user) into the context the evaluators expect.
function buildUserContext(interview) {
  if (!interview) return null;
  return {
    type: interview.type,
    jdText: interview.jdText,
    name: interview.user.name,
    jobRole: interview.user.jobRole,
    experienceLevel: interview.user.experienceLevel,
    resumeText: interview.user.resumeText,
    skills: interview.user.skills,
    yearsExperience: interview.user.yearsExperience,
  };
}

// Insert one live rubric judgment (called from the record_assessment tool).
// The topic is validated against the interview type's rubric so a hallucinated
// tag can't corrupt the timeline.
export async function recordAssessment(interviewId, { competency, topic, score, note }, type) {
  const topics = getTopicLabels(type);
  await prisma.assessment.create({
    data: {
      interviewId: Number(interviewId),
      competency,
      topic: topics[topic] ? topic : null,
      score: Math.round(score),
      note: note || null,
    },
  });
}

// Real answer-quality metrics derived from the transcript + logged assessments.
// Everything here is measured, not estimated — no invented benchmarks.
export function computeMetrics(transcriptions, assessments) {
  const answers = transcriptions.filter((t) => t.role === "user");
  const questions = transcriptions.filter((t) => t.role === "assistant");
  const wordCounts = answers.map((t) => countWords(t.content));
  const totalWords = wordCounts.reduce((s, n) => s + n, 0);

  // "Metrics cited" = answers that lean on a concrete number (%, counts, time,
  // multipliers). A rough but honest proxy for quantified, evidence-led answers.
  const quantifiedAnswers = answers.filter((t) => /\d/.test(t.content) &&
    /(\d+\s*%|\d+x\b|\$\d|\bpercent\b|\d[\d,]*\s*(users|requests|ms|seconds|minutes|hours|days|weeks|months|engineers|people|times))/i.test(t.content)
  ).length;

  // Delivery: filler words per 100 spoken words, counted from the candidate's
  // actual transcript. STT drops some fillers, so treat this as a floor.
  const candidateText = answers.map((t) => t.content || "").join(" ");
  const fillerMatches =
    candidateText.match(/\b(um+|uh+|erm?|ah+|you know|i mean|sort of|kind of|basically)\b/gi) || [];
  const interviewerWords = questions.reduce((s, t) => s + countWords(t.content), 0);

  return {
    answersGiven: answers.length,
    questionsAsked: questions.length,
    avgAnswerWords: answers.length ? Math.round(totalWords / answers.length) : 0,
    longestAnswerWords: wordCounts.length ? Math.max(...wordCounts) : 0,
    evidencePoints: assessments.length,
    competenciesCovered: new Set(assessments.map((a) => a.competency)).size,
    quantifiedAnswers,
    fillerWords: fillerMatches.length,
    fillerRate: totalWords ? Math.round((fillerMatches.length / totalWords) * 1000) / 10 : 0,
    candidateWords: totalWords,
    interviewerWords,
    // Share of all spoken words that were the candidate's. Healthy interviews
    // sit well above 50% — the candidate should be doing most of the talking.
    talkRatio: totalWords + interviewerWords
      ? Math.round((totalWords / (totalWords + interviewerWords)) * 100)
      : 0,
  };
}

function countWords(s) {
  return (s || "").trim().split(/\s+/).filter(Boolean).length;
}

// Which beats the interview actually reached, in coverage order, plus the ones
// it never got to — this is the honest "what did the interviewer explore"
// picture, straight from the logged per-answer tags.
export function computeTimeline(assessments, type) {
  const labels = getTopicLabels(type);
  const firstSeen = new Map();
  for (const a of assessments) {
    if (a.topic && labels[a.topic] && !firstSeen.has(a.topic)) {
      firstSeen.set(a.topic, a.createdAt);
    }
  }
  return Object.keys(labels).map((key) => ({
    topic: key,
    label: labels[key],
    covered: firstSeen.has(key),
  }));
}

// Average the per-answer scores within each of the type's phases (STAR for
// behavioral, design coverage for system design, …) into a 1–5 rating. Phases
// the interview never touched come back null (rendered as "not covered").
export function computePhaseRatings(assessments, type) {
  const byTopic = {};
  for (const a of assessments) {
    if (a.topic) (byTopic[a.topic] ||= []).push(a.score);
  }
  return getInterviewTypeConfig(type).phases.map(([phase, topics]) => {
    const scores = topics.flatMap((t) => byTopic[t] || []);
    const rating = scores.length
      ? Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 2) / 2
      : null;
    return { phase, rating, samples: scores.length };
  });
}

// Ensure a feedback row exists once an interview ends. If a report was already
// written (e.g. a prior /finish call), return it; otherwise generate one from the
// transcript, falling back to the per-answer assessments so it's never empty.
export async function finalizeInterview(interviewId) {
  const id = Number(interviewId);
  const existing = await prisma.feedback.findUnique({ where: { interviewId: id } });
  if (existing) return existing;

  // Primary path: an external LLM reads the full transcript and writes the whole
  // report. Best quality + no dependency on in-session tool calls. If it's not
  // configured or the call fails, we fall through to the assessment synthesis.
  if (config.evaluation.enabled) {
    try {
      const fromLLM = await evaluateAndSave(interviewId);
      if (fromLLM) return fromLLM;
    } catch (err) {
      console.error("[evaluation] transcript report failed, falling back:", err.message);
    }
  }

  // Only the type is needed on the fallback path — no user join required.
  const interview = await prisma.interview.findUnique({
    where: { id },
    select: { type: true },
  });
  const type = interview?.type;
  const competencyRows = await prisma.assessment.groupBy({
    by: ["competency"],
    where: { interviewId: id },
    _avg: { score: true },
    _count: { score: true },
    orderBy: { competency: "asc" },
  });
  const perCompetency = competencyRows.map((row) => ({
    competency: row.competency,
    score: Math.round(Number(row._avg.score || 0) * 10) / 10,
    samples: row._count.score,
  }));
  const overall = perCompetency.length
    ? Math.round(
        (perCompetency.reduce((sum, c) => sum + c.score, 0) / perCompetency.length / 5) * 100
      )
    : null;

  // Build strengths/growth from the notes the interviewer logged live, so an
  // auto-ended report is still concrete without any external LLM call.
  const { strengths, growthAreas, summary } = await synthesizeFromAssessments(
    interviewId,
    perCompetency,
    overall
  );

  try {
    return await prisma.feedback.create({
      data: {
        interviewId: id,
        overallScore: overall,
        summary,
        verdict: deriveVerdict(overall, perCompetency),
        topPriorities: derivePriorities(perCompetency, type),
        perCompetency,
        strengths,
        growthAreas,
        star: [],
        timeline: [],
        exchanges: [],
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return prisma.feedback.findUnique({ where: { interviewId: id } });
    }
    throw err;
  }
}

// Run the external transcript evaluator and persist the full report. Returns
// null (so the caller can fall back) if there's nothing to evaluate.
async function evaluateAndSave(interviewId) {
  const id = Number(interviewId);
  const [transcriptions, ctx] = await Promise.all([
    prisma.transcription.findMany({
      where: { interviewId: id },
      orderBy: { seq: "asc" },
    }),
    prisma.interview.findUnique({
      where: { id },
      include: { user: true },
    }),
  ]);
  if (!transcriptions.length) return null;
  const userContext = buildUserContext(ctx);

  // Dynamic import avoids a static circular dependency (the evaluator imports
  // the shared TOPIC_META / STAR_PHASES shapes from this module).
  const { evaluateTranscript } = await import("./transcriptEvaluator.js");
  const report = await evaluateTranscript({
    transcriptions,
    user: userContext,
    type: userContext?.type,
  });
  const data = {
    overallScore: clampInt(report.overall_score, 0, 100),
    summary: report.summary || "",
    verdict: report.verdict || "",
    topPriorities: report.top_priorities || [],
    perCompetency: report.per_competency || [],
    strengths: report.strengths || [],
    growthAreas: report.growth_areas || [],
    star: report.star || [],
    timeline: report.timeline || [],
    exchanges: report.exchanges || [],
  };
  return prisma.feedback.upsert({
    where: { interviewId: id },
    create: { interviewId: id, ...data },
    update: data,
  });
}

// Turn the live per-answer assessments into a concrete summary + strengths +
// growth areas. Used only for the fallback path (no external evaluator).
async function synthesizeFromAssessments(interviewId, perCompetency, overall) {
  if (!perCompetency.length) {
    return {
      strengths: [],
      growthAreas: [],
      summary: "Not enough of the interview was completed to generate detailed feedback.",
    };
  }

  const rows = await prisma.assessment.findMany({
    where: {
      interviewId: Number(interviewId),
      note: { not: null },
      NOT: { note: "" },
    },
    orderBy: { score: "desc" },
    select: { competency: true, score: true, note: true },
  });

  // Highest-scoring notes become strengths; lowest-scoring become growth areas.
  const strengths = rows
    .filter((r) => r.score >= 4)
    .slice(0, 3)
    .map((r) => r.note);
  const growthAreas = rows
    .filter((r) => r.score <= 3)
    .slice(-3)
    .map((r) => r.note);

  const ranked = [...perCompetency].sort((a, b) => b.score - a.score);
  const top = humanizeCompetency(ranked[0]?.competency);
  const low = humanizeCompetency(ranked[ranked.length - 1]?.competency);
  const summary =
    `Auto-summarized from in-session assessments (the interview wrapped up before a final evaluation was submitted). ` +
    `Overall performance landed around ${overall ?? "—"}/100, strongest on ${top}` +
    (low && low !== top ? `, with the most room to grow on ${low}.` : ".");

  return { strengths, growthAreas, summary };
}

function humanizeCompetency(key) {
  if (!key) return "";
  return key.replace(/_/g, " ");
}

// A short hiring-manager narrative: advance / hold, keyed off the score band and
// the candidate's strongest / weakest measured competency. Honest and grounded
// in the same numbers shown on the report — no invented specifics.
export function deriveVerdict(overall, perCompetency) {
  if (overall == null) {
    return "Not enough of the interview was completed to reach a hiring decision.";
  }
  const ranked = [...perCompetency].sort((a, b) => b.score - a.score);
  const strong = humanizeCompetency(ranked[0]?.competency);
  const weak = humanizeCompetency(ranked[ranked.length - 1]?.competency);

  let lead;
  if (overall >= 80) lead = "If this were a real interview, you'd advance comfortably.";
  else if (overall >= 70) lead = "If this were a real interview, you'd likely advance to the next round.";
  else if (overall >= 60) lead = "If this were a real interview, this would be a borderline call.";
  else lead = "If this were a real interview, you likely wouldn't advance yet.";

  const strongClause = strong ? ` Your ${strong} came through as the strongest signal` : "";
  const weakClause =
    weak && weak !== strong
      ? `, but I'd want stronger evidence on ${weak} before making a hiring decision.`
      : strong
        ? "."
        : "";
  return `${lead}${strongClause}${weakClause}`;
}

// The single most useful takeaway: a short, ordered list of what to fix first.
// Built from the lowest-scoring competencies, using the type rubric's
// prescriptive tips so the advice targets real gaps.
export function derivePriorities(perCompetency, type) {
  if (!perCompetency.length) return [];
  const tips = Object.fromEntries(
    getInterviewTypeConfig(type).competencies.map((c) => [c.key, c.tip])
  );
  return [...perCompetency]
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((c) => tips[c.competency] || `Strengthen your ${humanizeCompetency(c.competency)}.`);
}
