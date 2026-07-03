//   evaluateAnswer   → score the answer the candidate just gave (LLM-judged)
//   adjustDifficulty → nudge difficulty up on strength, down on weakness
//   decideRoute      → the ADAPTIVE BRANCH: follow-up / harder / new topic / wrap
//   generateQuestion → produce the next spoken question for the chosen branch
//   closing          → produce the closing line and mark the session done

import { config } from "../config/config.js";
import { getInterviewTypeConfig } from "../domain/interviewTypes.js";
import { promptFor, backgroundSection } from "../prompts/interviewer.js";
import { recordAssessment } from "../services/reportService.js";
import { chatJSON, chatText } from "./model.js";

export async function evaluateAnswer(state) {
  const rubric = getInterviewTypeConfig(state.type);
  const evaluation = await llmEvaluate(state, rubric);

  // Persist through the same validated path the record_assessment tool used, so
  // the post-call report and timeline see the graph's judgments.
  try {
    await recordAssessment(
      state.interviewId,
      {
        competency: evaluation.competency,
        topic: evaluation.topic,
        score: evaluation.score,
        note: evaluation.note,
      },
      state.type
    );
  } catch (err) {
    console.warn("[graph] recordAssessment failed:", err.message);
  }

  const weak = evaluation.score <= 2;
  const strong = evaluation.score >= 4;
  return {
    lastEvaluation: evaluation,
    assessments: [evaluation],
    coverage: evaluation.topic ? [evaluation.topic] : [],
    runningScores: { [evaluation.competency]: evaluation.score },
    weakStreak: weak ? (state.weakStreak || 0) + 1 : 0,
    strongStreak: strong ? (state.strongStreak || 0) + 1 : 0,
  };
}

async function llmEvaluate(state, rubric) {
  const compEnum = rubric.competencies.map((c) => `${c.key} (${c.hint})`).join("; ");
  const topicEnum = rubric.topics.map((t) => `${t.key} (${t.label})`).join("; ");
  const system = `You are a rigorous ${rubric.label} interview evaluator. Judge ONLY what the answer supports — never credit unstated detail. Return a strict JSON object:
{"competency": <one key from: ${rubric.competencies.map((c) => c.key).join(", ")}>,
 "topic": <one key from: ${rubric.topics.map((t) => t.key).join(", ")}>,
 "score": <integer 1-5, 1=weak/vague/evasive, 3=adequate but thin, 5=specific+credible+complete>,
 "strength": <"weak"|"adequate"|"strong">,
 "note": <one short sentence justifying the score, referencing their actual words>}
Competencies: ${compEnum}
Topics: ${topicEnum}
Calibrate to a ${state.user?.experienceLevel || "mid"}-level ${state.user?.jobRole || "engineer"}.`;
  const user = `Interviewer asked: "${state.lastQuestion || "(opening)"}"
Candidate answered: "${state.lastAnswer}"
Current thread topic: ${state.currentTopic || "(none yet)"}.`;

  const raw = await chatJSON({ system, user });
  return normalizeEvaluation(raw, state, rubric);
}

function normalizeEvaluation(raw, state, rubric) {
  const compKeys = rubric.competencies.map((c) => c.key);
  const topicKeys = rubric.topics.map((t) => t.key);
  const score = clamp(raw?.score, 1, 5) ?? 3;
  return {
    competency: compKeys.includes(raw?.competency) ? raw.competency : compKeys[0],
    topic: topicKeys.includes(raw?.topic) ? raw.topic : state.currentTopic || topicKeys[0],
    score,
    strength: score <= 2 ? "weak" : score >= 4 ? "strong" : "adequate",
    note: typeof raw?.note === "string" && raw.note.trim() ? raw.note.trim() : "Assessed by director.",
  };
}

function clamp(n, min, max) {
  const v = Math.round(Number(n));
  if (Number.isNaN(v)) return null;
  return Math.min(max, Math.max(min, v));
}

export function adjustDifficulty(state) {
  let d = state.difficulty ?? 2;
  const score = state.lastEvaluation?.score ?? 3;
  if (score >= 4) d += (state.strongStreak || 0) >= 2 ? 2 : 1;
  else if (score <= 2) d -= 1;
  d = Math.max(1, Math.min(5, d));
  return { difficulty: d };
}

export function decideRoute(state) {
  const rubric = getInterviewTypeConfig(state.type);
  const totalTopics = rubric.topics.length;
  const covered = (state.coverage || []).length;
  const qCount = state.questionCount || 0;
  const elapsed = Date.now() - (state.startedAt || Date.now());
  const score = state.lastEvaluation?.score ?? 3;
  const probes = state.sameTopicProbes || 0;

  const timeUp = elapsed >= config.limits.softWrapMs;
  const enoughQuestions = qCount >= config.graph.maxQuestions;
  const enoughCoverage = covered >= Math.min(totalTopics, config.graph.maxQuestions);

  let route;
  if (timeUp || enoughQuestions || enoughCoverage) {
    route = "wrapup";
  } else if (score <= 2) {
    route = probes >= 3 ? "newtopic" : "followup";
  } else if (score >= 4) {
    route = probes >= 2 ? "newtopic" : "harder";
  } else {
    route = probes >= 1 ? "newtopic" : "followup";
  }

  const stage = route === "wrapup" ? "wrapping" : qCount <= 1 ? "opening" : "probing";
  return { route, stage };
}

export async function generateQuestion(state) {
  const rubric = getInterviewTypeConfig(state.type);
  const prompt = promptFor(state.type);

  // Opening turn: use the type's fixed opener
  if ((state.questionCount || 0) === 0) {
    const topic = rubric.topics[0].key;
    return {
      directive: prompt.opener,
      lastQuestion: prompt.opener,
      transcript: [{ role: "assistant", content: prompt.opener }],
      questionCount: 1,
      currentTopic: topic,
      sameTopicProbes: 1,
      stage: "opening",
    };
  }

  const route = state.route || "followup";
  const stayOnTopic = route === "followup" || route === "harder";
  const topic = stayOnTopic ? state.currentTopic || rubric.topics[0].key : nextTopic(state, rubric);

  const directive = await llmQuestion(state, rubric, prompt, route, topic);

  const sameTopicProbes = stayOnTopic ? (state.sameTopicProbes || 0) + 1 : 1;
  return {
    directive,
    lastQuestion: directive,
    transcript: [{ role: "assistant", content: directive }],
    questionCount: (state.questionCount || 0) + 1,
    currentTopic: topic,
    sameTopicProbes,
    stage: "probing",
  };
}

async function llmQuestion(state, rubric, prompt, route, topic) {
  const topicLabel = rubric.topics.find((x) => x.key === topic)?.label || topic;
  const intent = {
    followup: "The candidate's last answer was thin or vague. Ask a focused FOLLOW-UP that makes them get specific on the SAME thread — pin down what they personally did, a real detail, or a number.",
    harder: "The candidate answered well. Turn up the pressure on the SAME thread: change a constraint, probe a failure mode, or ask them to justify a tradeoff.",
    newtopic: `Open a NEW thread on "${topicLabel}". Ask one clean question that gets them talking about it.`,
    wrapup: "Steer toward closing.",
  }[route];

  const recent = (state.transcript || [])
    .slice(-4)
    .map((m) => `${m.role === "assistant" ? "YOU" : "CANDIDATE"}: ${m.content}`)
    .join("\n");

  const system = `You are ${prompt.persona}
You are running a ${rubric.label} interview at difficulty ${state.difficulty}/5 (5 = hardest). ${prompt.focus}
${backgroundSection({ user: state.user, jdText: state.jdText })}
Produce the interviewer's NEXT question ONLY — one or two spoken sentences, conversational, no preamble, no quotes, no markdown. Do not acknowledge or explain; just the question itself.`;

  const user = `Recent exchange:
${recent || "(just getting started)"}

Your intent for the next question: ${intent}
Difficulty ${state.difficulty}/5 — calibrate depth accordingly. Ask ONE thing.`;

  const text = await chatText({ system, user });

  return text.replace(/^["']|["']$/g, "").split("\n")[0].trim() || null;
}

// Return the first uncovered topic, if one exists. Otherwise, return the first topic in the rubric.
function nextTopic(state, rubric) {
  const covered = new Set(state.coverage || []);
  const fresh = rubric.topics.find((t) => !covered.has(t.key));
  return (fresh || rubric.topics[0]).key;
}

export async function closing(state) {
  const rubric = getInterviewTypeConfig(state.type);
  const system = `You are a warm senior interviewer closing a ${rubric.label} interview. In ONE or TWO spoken sentences, thank the candidate by first name, give a brief honest note on how it went overall, and say their full feedback report is on the way. No lists, no scores read aloud.`;
  const user = `Candidate: ${state.user?.name || "the candidate"}. They answered ${
    state.questionCount || 0
  } questions. Write the closing line.`;
  const directive = (await chatText({ system, user })).split("\n")[0].trim();

  return {
    directive,
    done: true,
    stage: "closed",
    route: "wrapup",
    transcript: [{ role: "assistant", content: directive }],
  };
}