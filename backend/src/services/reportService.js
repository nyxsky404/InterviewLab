import { config } from "../config/index.js";
import {
  addAssessment,
  averageByCompetency,
  listNotedAssessments,
} from "../models/assessmentModel.js";
import { listTurns } from "../models/turnModel.js";
import { getEvaluationContext } from "../models/interviewModel.js";
import { findFeedback, upsertFeedback, insertFeedbackIfAbsent } from "../models/feedbackModel.js";
import { typeProfile, topicLabelMap } from "../domain/interviewTypes.js";

// Insert one live rubric judgment (called from the record_assessment tool).
// The topic is validated against the interview type's rubric so a hallucinated
// tag can't corrupt the timeline.
export async function recordAssessment(interviewId, { competency, topic, score, note }, type) {
  const topics = topicLabelMap(type);
  await addAssessment(interviewId, {
    competency,
    topic: topics[topic] ? topic : null,
    score: Math.round(score),
    note: note || null,
  });
}

// Real answer-quality metrics derived from the transcript + logged assessments.
// Everything here is measured, not estimated — no invented benchmarks.
export function computeMetrics(turns, assessments) {
  const answers = turns.filter((t) => t.role === "user");
  const questions = turns.filter((t) => t.role === "assistant");
  const wordCounts = answers.map((t) => countWords(t.content));
  const totalWords = wordCounts.reduce((s, n) => s + n, 0);

  // "Metrics cited" = answers that lean on a concrete number (%, counts, time,
  // multipliers). A rough but honest proxy for quantified, evidence-led answers.
  const quantifiedAnswers = answers.filter((t) => /\d/.test(t.content) &&
    /(\d+\s*%|\d+x\b|\$\d|\bpercent\b|\d[\d,]*\s*(users|requests|ms|seconds|minutes|hours|days|weeks|months|engineers|people|times))/i.test(t.content)
  ).length;

  return {
    answersGiven: answers.length,
    questionsAsked: questions.length,
    avgAnswerWords: answers.length ? Math.round(totalWords / answers.length) : 0,
    longestAnswerWords: wordCounts.length ? Math.max(...wordCounts) : 0,
    evidencePoints: assessments.length,
    competenciesCovered: new Set(assessments.map((a) => a.competency)).size,
    quantifiedAnswers,
  };
}

function countWords(s) {
  return (s || "").trim().split(/\s+/).filter(Boolean).length;
}

// Which beats the interview actually reached, in coverage order, plus the ones
// it never got to — this is the honest "what did the interviewer explore"
// picture, straight from the logged per-answer tags.
export function computeTimeline(assessments, type) {
  const labels = topicLabelMap(type);
  const firstSeen = new Map();
  for (const a of assessments) {
    if (a.topic && labels[a.topic] && !firstSeen.has(a.topic)) {
      firstSeen.set(a.topic, a.created_at);
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
  return typeProfile(type).phases.map(([phase, topics]) => {
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
  const existing = await findFeedback(interviewId);
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

  const ctx = await getEvaluationContext(interviewId);
  const type = ctx?.type;
  const perCompetency = await averageByCompetency(interviewId);
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

  return insertFeedbackIfAbsent(interviewId, {
    overall_score: overall,
    summary,
    verdict: deriveVerdict(overall, perCompetency),
    top_priorities: derivePriorities(perCompetency, type),
    per_competency: perCompetency,
    strengths,
    growth_areas: growthAreas,
  });
}

// Run the external transcript evaluator and persist the full report. Returns
// null (so the caller can fall back) if there's nothing to evaluate.
async function evaluateAndSave(interviewId) {
  const [turns, ctx] = await Promise.all([
    listTurns(interviewId),
    getEvaluationContext(interviewId),
  ]);
  if (!turns.length) return null;

  // Dynamic import avoids a static circular dependency (the evaluator imports
  // the shared TOPIC_META / STAR_PHASES shapes from this module).
  const { evaluateTranscript } = await import("./transcriptEvaluator.js");
  const report = await evaluateTranscript({
    turns,
    user: ctx,
    type: ctx?.type,
  });
  return upsertFeedback(interviewId, {
    ...report,
    overall_score: clampInt(report.overall_score, 0, 100),
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

  const rows = await listNotedAssessments(interviewId);

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
    typeProfile(type).competencies.map((c) => [c.key, c.tip])
  );
  return [...perCompetency]
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((c) => tips[c.competency] || `Strengthen your ${humanizeCompetency(c.competency)}.`);
}

function clampInt(n, min, max) {
  const v = Math.round(Number(n));
  if (Number.isNaN(v)) return null;
  return Math.min(max, Math.max(min, v));
}
