import { config } from "../config.js";
import { COMPETENCIES, TOPICS } from "../prompts/interviewer.js";
import { TOPIC_META, STAR_PHASES } from "./evaluation.js";

// Post-call report generation. Reads the FULL transcript once the interview
// ends and returns the structured feedback. The LLM supplies judgments only —
// the server owns every label, enum, and shape — so a sloppy model response
// can't corrupt the report. Throws on any failure so the caller can fall back
// to the in-session assessment synthesis.

const COMPETENCY_HINTS = {
  communication: "clarity, structure, and pacing of answers",
  star_structure: "telling a complete Situation → Task → Action → Result story",
  self_awareness: "reflecting honestly on mistakes and what they'd change",
  ownership: "distinguishing what they personally did from the team's work",
  impact: "measurable, validated outcomes",
};

export async function evaluateTranscript({ turns, user, type }) {
  if (!config.evaluation.enabled) throw new Error("evaluation LLM not configured");

  const dialogue = turns
    .filter((t) => t.content && t.content.trim())
    .map((t) => `${t.role === "assistant" ? "INTERVIEWER" : "CANDIDATE"}: ${t.content.trim()}`)
    .join("\n");
  if (!dialogue) throw new Error("empty transcript");

  const raw = await callChatCompletion({
    system: buildSystemPrompt(),
    user: buildUserPrompt({ dialogue, user, type }),
  });

  return normalize(raw);
}

function buildSystemPrompt() {
  const compList = COMPETENCIES.map((c) => `- ${c}: ${COMPETENCY_HINTS[c] || c}`).join("\n");
  const topicList = TOPICS.map((t) => `- ${t}: ${TOPIC_META[t]}`).join("\n");
  return `You are a seasoned engineering hiring manager writing structured feedback on a behavioral interview. You judge only what the transcript supports — never invent details, numbers, or quotes the candidate did not actually give. Be specific, fair, and direct.

Score these competencies 1 (weak) to 5 (excellent):
${compList}

Rate each STAR phase 1-5 based on how completely the candidate's stories covered it, or null if it never came up. The phases are Situation, Task, Action, Result, Reflection.

These are the story beats an interview can cover:
${topicList}

Respond with ONLY a JSON object in exactly this shape (no prose, no markdown):
{
  "overall_score": <int 0-100>,
  "verdict": "<2-3 sentences addressed to the candidate: would they advance, what made their case credible, what you'd need to see more of>",
  "summary": "<2-3 sentence overall summary>",
  "strengths": ["<concrete strength tied to something they actually said>", ...],
  "growth_areas": ["<prescriptive: name the gap, then what to do differently next time>", ...],
  "top_priorities": ["<the single most important fix>", "<second>", "<third>"],
  "competencies": { "<competency>": { "score": <1-5>, "evidence": "<short quote or close paraphrase from the transcript>" }, ... },
  "star": { "Situation": <1-5 or null>, "Task": <1-5 or null>, "Action": <1-5 or null>, "Result": <1-5 or null>, "Reflection": <1-5 or null> },
  "covered_topics": ["<topic key the interviewer actually explored>", ...]
}`;
}

function buildUserPrompt({ dialogue, user, type }) {
  const role = user?.job_role || "software engineer";
  const level = user?.experience_level || "mid";
  return `Interview type: ${type || "behavioral"}
Candidate: ${user?.name || "the candidate"} — target role: ${role}, experience level: ${level}
Calibrate your scores to a ${level}-level ${role}.

TRANSCRIPT:
${dialogue}`;
}

async function callChatCompletion({ system, user }) {
  const res = await fetch(`${config.evaluation.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.evaluation.apiKey}`,
    },
    body: JSON.stringify({
      model: config.evaluation.model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`evaluation LLM ${res.status}: ${detail.slice(0, 300)}`);
  }
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error("evaluation LLM returned no content");
  return JSON.parse(content);
}

// Coerce the model's raw JSON into the exact structures the DB + report expect.
// Anything malformed is dropped rather than trusted.
function normalize(raw) {
  const comps = raw?.competencies || {};
  const per_competency = COMPETENCIES.map((c) => ({
    competency: c,
    score: clamp(comps[c]?.score, 1, 5),
    evidence: str(comps[c]?.evidence),
  })).filter((c) => c.score != null);

  const starIn = raw?.star || {};
  const star = STAR_PHASES.map(([phase]) => ({
    phase,
    rating: clamp(starIn[phase], 1, 5),
  }));

  // The model is asked for topic *keys*, but often echoes the label or a loose
  // variant ("Situation / setup", "situation setup"). Match tolerantly against
  // both keys and labels so a naming mismatch doesn't blank the timeline.
  const coveredRaw = Array.isArray(raw?.covered_topics) ? raw.covered_topics : [];
  const covered = new Set();
  for (const item of coveredRaw) {
    const key = matchTopicKey(item);
    if (key) covered.add(key);
  }
  const timeline = Object.keys(TOPIC_META).map((key) => ({
    topic: key,
    label: TOPIC_META[key],
    covered: covered.has(key),
  }));

  return {
    overall_score: clamp(raw?.overall_score, 0, 100),
    verdict: str(raw?.verdict),
    summary: str(raw?.summary),
    strengths: arr(raw?.strengths),
    growth_areas: arr(raw?.growth_areas),
    top_priorities: arr(raw?.top_priorities).slice(0, 3),
    per_competency,
    star,
    timeline,
  };
}

// Resolve a model-supplied topic string to a canonical TOPIC_META key, matching
// on the key itself or its human label, ignoring case and non-alphanumerics.
const TOPIC_LOOKUP = (() => {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const map = new Map();
  for (const [key, label] of Object.entries(TOPIC_META)) {
    map.set(norm(key), key);
    map.set(norm(label), key);
  }
  return { norm, map };
})();
function matchTopicKey(item) {
  if (item == null) return null;
  return TOPIC_LOOKUP.map.get(TOPIC_LOOKUP.norm(item)) || null;
}

function clamp(n, min, max) {
  const v = Math.round(Number(n));
  if (Number.isNaN(v)) return null;
  return Math.min(max, Math.max(min, v));
}
function str(v) {
  return typeof v === "string" ? v.trim() : "";
}
function arr(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter(Boolean);
}
