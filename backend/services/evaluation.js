import { query } from "../db/pool.js";
import { config } from "../config.js";

// Aggregate the live per-answer assessments into an average score (1–5) per
// competency. This is the structured signal the LLM logged during the session.
export async function computePerCompetency(interviewId) {
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

// All raw per-answer judgments the LLM logged live. These carry the concrete
// evidence (the one-line note per answer) that turns a score into something the
// candidate can actually learn from, so the report surfaces them directly.
export async function getAssessments(interviewId) {
  const { rows } = await query(
    `SELECT competency, topic, score, note, created_at
       FROM assessments
      WHERE interview_id = $1
      ORDER BY created_at`,
    [interviewId]
  );
  return rows;
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

// Insert one live rubric judgment (called from the record_assessment tool).
export async function recordAssessment(interviewId, { competency, topic, score, note }) {
  await query(
    `INSERT INTO assessments (interview_id, competency, topic, score, note) VALUES ($1, $2, $3, $4, $5)`,
    [interviewId, competency, TOPIC_META[topic] ? topic : null, Math.round(score), note || null]
  );
}

// The canonical story beats, in the order an interview tends to work through
// them, with the label shown on the timeline. Mirrors TOPICS in the prompt.
export const TOPIC_META = {
  situation: "Situation / setup",
  problem: "The core problem",
  team: "Team & their role",
  ownership: "Personal ownership",
  alternatives: "Alternatives weighed",
  tradeoff: "The key tradeoff",
  validation: "Results & validation",
  mistake: "Mistakes & surprises",
  conflict: "Conflict / disagreement",
  reflection: "Reflection & hindsight",
};

// How each beat rolls up into a STAR phase (Reflection kept separate — it's the
// dimension candidates most often skip and the one worth calling out on its own).
export const STAR_PHASES = [
  ["Situation", ["situation", "problem"]],
  ["Task", ["team"]],
  ["Action", ["ownership", "alternatives", "tradeoff"]],
  ["Result", ["validation"]],
  ["Reflection", ["mistake", "conflict", "reflection"]],
];

// Which story beats the interview actually reached, in coverage order, plus the
// ones it never got to — this is the honest "what did the interviewer explore"
// picture, straight from the logged per-answer tags.
export function computeTimeline(assessments) {
  const firstSeen = new Map();
  for (const a of assessments) {
    if (a.topic && TOPIC_META[a.topic] && !firstSeen.has(a.topic)) {
      firstSeen.set(a.topic, a.created_at);
    }
  }
  return Object.keys(TOPIC_META).map((key) => ({
    topic: key,
    label: TOPIC_META[key],
    covered: firstSeen.has(key),
  }));
}

// Average the per-answer scores within each STAR phase into a 1–5 rating. Phases
// the interview never touched come back null (rendered as "not covered").
export function computeStarRatings(assessments) {
  const byTopic = {};
  for (const a of assessments) {
    if (a.topic) (byTopic[a.topic] ||= []).push(a.score);
  }
  return STAR_PHASES.map(([phase, topics]) => {
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
  const existing = await query(`SELECT * FROM feedback WHERE interview_id = $1`, [interviewId]);
  if (existing.rows[0]) return existing.rows[0];

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

  const perCompetency = await computePerCompetency(interviewId);
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

  const { rows } = await query(
    `INSERT INTO feedback (interview_id, overall_score, summary, verdict, top_priorities, per_competency, strengths, growth_areas)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (interview_id) DO NOTHING
     RETURNING *`,
    [
      interviewId,
      overall,
      summary,
      deriveVerdict(overall, perCompetency),
      JSON.stringify(derivePriorities(perCompetency)),
      JSON.stringify(perCompetency),
      JSON.stringify(strengths),
      JSON.stringify(growthAreas),
    ]
  );
  if (rows[0]) return rows[0];
  const reread = await query(`SELECT * FROM feedback WHERE interview_id = $1`, [interviewId]);
  return reread.rows[0] || null;
}

// Run the external transcript evaluator and persist the full report. Returns
// null (so the caller can fall back) if there's nothing to evaluate.
async function evaluateAndSave(interviewId) {
  const [{ rows: turns }, { rows: userRows }, { rows: itvRows }] = await Promise.all([
    query(`SELECT role, content FROM turns WHERE interview_id = $1 ORDER BY seq`, [interviewId]),
    query(
      `SELECT u.name, u.job_role, u.experience_level
         FROM interviews i JOIN users u ON u.id = i.user_id
        WHERE i.id = $1`,
      [interviewId]
    ),
    query(`SELECT type FROM interviews WHERE id = $1`, [interviewId]),
  ]);
  if (!turns.length) return null;

  // Dynamic import avoids a static circular dependency (the evaluator imports
  // the shared TOPIC_META / STAR_PHASES shapes from this module).
  const { evaluateTranscript } = await import("./groqEvaluation.js");
  const report = await evaluateTranscript({
    turns,
    user: userRows[0],
    type: itvRows[0]?.type,
  });
  return persistFeedback(interviewId, report);
}

// Full upsert used by the transcript evaluator — writes every report column,
// including the LLM-authored per-competency evidence, STAR ratings, and timeline.
async function persistFeedback(interviewId, f) {
  const { rows } = await query(
    `INSERT INTO feedback
       (interview_id, overall_score, summary, verdict, top_priorities,
        per_competency, strengths, growth_areas, star, timeline)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (interview_id) DO UPDATE SET
       overall_score = EXCLUDED.overall_score,
       summary       = EXCLUDED.summary,
       verdict       = EXCLUDED.verdict,
       top_priorities= EXCLUDED.top_priorities,
       per_competency= EXCLUDED.per_competency,
       strengths     = EXCLUDED.strengths,
       growth_areas  = EXCLUDED.growth_areas,
       star          = EXCLUDED.star,
       timeline      = EXCLUDED.timeline
     RETURNING *`,
    [
      interviewId,
      clampInt(f.overall_score, 0, 100),
      f.summary || "",
      f.verdict || "",
      JSON.stringify(f.top_priorities || []),
      JSON.stringify(f.per_competency || []),
      JSON.stringify(f.strengths || []),
      JSON.stringify(f.growth_areas || []),
      JSON.stringify(f.star || []),
      JSON.stringify(f.timeline || []),
    ]
  );
  return rows[0];
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

  const { rows } = await query(
    `SELECT competency, score, note FROM assessments
      WHERE interview_id = $1 AND note IS NOT NULL AND note <> ''
      ORDER BY score DESC`,
    [interviewId]
  );

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
// Built from the lowest-scoring competencies so the advice targets real gaps.
const IMPROVEMENT_TIPS = {
  ownership:
    "State exactly what you personally built end-to-end before crediting the team.",
  communication:
    "Open each answer with a one-sentence headline, then walk through situation, action, and result.",
  star_structure:
    "Finish every story with a concrete Result, and don't skip the Situation that set it up.",
  self_awareness:
    "End each story with a genuine reflection — what went wrong and what you'd do differently now.",
  impact:
    "Back every metric with its sample size, time window, and how it was measured.",
};

export function derivePriorities(perCompetency) {
  if (!perCompetency.length) return [];
  return [...perCompetency]
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((c) => IMPROVEMENT_TIPS[c.competency] || `Strengthen your ${humanizeCompetency(c.competency)}.`);
}

function clampInt(n, min, max) {
  const v = Math.round(Number(n));
  if (Number.isNaN(v)) return null;
  return Math.min(max, Math.max(min, v));
}
