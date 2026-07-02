import { config } from "../config/index.js";
import { typeProfile, topicLabelMap } from "../domain/interviewTypes.js";

// Post-call report generation. Reads the FULL transcript once the interview
// ends and returns the structured feedback. The LLM supplies judgments only —
// the server owns every label, enum, and shape — so a sloppy model response
// can't corrupt the report. Throws on any failure so the caller can fall back
// to the in-session assessment synthesis.

export async function evaluateTranscript({ turns, user, type }) {
  if (!config.evaluation.enabled) throw new Error("evaluation LLM not configured");
  const rubric = typeProfile(type);

  const dialogue = turns
    .filter((t) => t.content && t.content.trim())
    .map((t) => `${t.role === "assistant" ? "INTERVIEWER" : "CANDIDATE"}: ${t.content.trim()}`)
    .join("\n");
  if (!dialogue) throw new Error("empty transcript");

  const raw = await callChatCompletion({
    system: buildSystemPrompt(rubric),
    user: buildUserPrompt({ dialogue, user, rubric }),
    schema: buildReportSchema(rubric),
  });

  return normalize(raw, rubric);
}

// Strict JSON schema built from the type's rubric, so the model literally
// cannot return a malformed report or invent competency/topic keys.
function buildReportSchema(rubric) {
  const compKeys = rubric.competencies.map((c) => c.key);
  const phaseNames = rubric.phases.map(([name]) => name);
  const scoreOrNull = { type: ["integer", "null"], minimum: 1, maximum: 5 };
  return {
    type: "object",
    properties: {
      overall_score: { type: "integer", minimum: 0, maximum: 100 },
      verdict: { type: "string" },
      summary: { type: "string" },
      strengths: { type: "array", items: { type: "string" } },
      growth_areas: { type: "array", items: { type: "string" } },
      top_priorities: { type: "array", items: { type: "string" } },
      competencies: {
        type: "object",
        properties: Object.fromEntries(
          compKeys.map((k) => [
            k,
            {
              type: "object",
              properties: {
                score: { type: "integer", minimum: 1, maximum: 5 },
                evidence: { type: "string" },
              },
              required: ["score", "evidence"],
              additionalProperties: false,
            },
          ])
        ),
        required: compKeys,
        additionalProperties: false,
      },
      phases: {
        type: "object",
        properties: Object.fromEntries(phaseNames.map((p) => [p, scoreOrNull])),
        required: phaseNames,
        additionalProperties: false,
      },
      covered_topics: {
        type: "array",
        items: { type: "string", enum: rubric.topics.map((t) => t.key) },
      },
      exchanges: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            answer_gist: { type: "string" },
            rating: { type: "string", enum: ["strong", "adequate", "weak"] },
            comment: { type: "string" },
            improvement: { type: "string" },
          },
          required: ["question", "answer_gist", "rating", "comment", "improvement"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "overall_score",
      "verdict",
      "summary",
      "strengths",
      "growth_areas",
      "top_priorities",
      "competencies",
      "phases",
      "covered_topics",
      "exchanges",
    ],
    additionalProperties: false,
  };
}

function buildSystemPrompt(rubric) {
  const compList = rubric.competencies.map((c) => `- ${c.key}: ${c.hint}`).join("\n");
  const topicList = rubric.topics.map((t) => `- ${t.key}: ${t.label}`).join("\n");
  const phaseNames = rubric.phases.map(([name]) => name);
  return `You are a seasoned hiring manager writing structured feedback on a ${rubric.label} interview. You judge only what the transcript supports — never invent details, numbers, or quotes the candidate did not actually give. Be specific, fair, and direct.

Score these competencies 1 (weak) to 5 (excellent):
${compList}

Rate each interview phase 1-5 based on how completely the candidate covered it, or null if it never came up. The phases are: ${phaseNames.join(", ")}.

These are the topics an interview of this type can cover:
${topicList}

Respond with ONLY a JSON object in exactly this shape (no prose, no markdown):
{
  "overall_score": <int 0-100>,
  "verdict": "<2-3 sentences addressed to the candidate: would they advance, what made their case credible, what you'd need to see more of>",
  "summary": "<2-3 sentence overall summary>",
  "strengths": ["<concrete strength tied to something they actually said>", ...],
  "growth_areas": ["<prescriptive: name the gap, then what to do differently next time>", ...],
  "top_priorities": ["<the single most important fix>", "<second>", "<third>"],
  "competencies": { "<competency key>": { "score": <1-5>, "evidence": "<short quote or close paraphrase from the transcript>" }, ... },
  "phases": { ${phaseNames.map((p) => `"${p}": <1-5 or null>`).join(", ")} },
  "covered_topics": ["<topic key the interviewer actually explored>", ...],
  "exchanges": [ { "question": "...", "answer_gist": "...", "rating": "strong|adequate|weak", "comment": "...", "improvement": "..." }, ... ]
}

For "exchanges": walk the transcript and review each substantive question-and-answer exchange (skip the greeting and closing pleasantries; merge a question with its immediate follow-ups when they cover the same thread; at most 8 exchanges). Per exchange:
- "question": the interviewer's question, shortened to its essence.
- "answer_gist": one sentence capturing what the candidate actually answered.
- "rating": strong (specific, credible, complete), adequate (answered but thin), or weak (vague, evasive, or off-target).
- "comment": one or two sentences on what worked or didn't in THIS answer — reference their actual words.
- "improvement": the single concrete change that would most improve this answer; for strong answers, how to make it even sharper.`;
}

function buildUserPrompt({ dialogue, user, rubric }) {
  const role = user?.job_role || "software engineer";
  const level = user?.experience_level || "mid";
  return `Interview type: ${rubric.label}
Candidate: ${user?.name || "the candidate"} — target role: ${role}, experience level: ${level}
Calibrate your scores to a ${level}-level ${role}.

TRANSCRIPT:
${dialogue}`;
}

// Call Groq with strict structured output (json_schema). Not every model
// supports it, so on a schema-related rejection retry once with plain JSON
// mode — the prompt describes the same shape and normalize() guards the rest.
async function callChatCompletion({ system, user, schema }) {
  const strictFormat = {
    type: "json_schema",
    json_schema: { name: "interview_report", strict: true, schema },
  };
  try {
    return await postChat({ system, user, responseFormat: strictFormat });
  } catch (err) {
    if (!/\b400\b/.test(err.message)) throw err;
    console.warn("[evaluation] json_schema rejected, retrying with json_object:", err.message);
    return postChat({ system, user, responseFormat: { type: "json_object" } });
  }
}

async function postChat({ system, user, responseFormat }) {
  const res = await fetch(`${config.evaluation.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.evaluation.apiKey}`,
    },
    body: JSON.stringify({
      model: config.evaluation.model,
      temperature: 0.3,
      response_format: responseFormat,
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
function normalize(raw, rubric) {
  const comps = raw?.competencies || {};
  const per_competency = rubric.competencies
    .map((c) => ({
      competency: c.key,
      score: clamp(comps[c.key]?.score, 1, 5),
      evidence: str(comps[c.key]?.evidence),
    }))
    .filter((c) => c.score != null);

  const phasesIn = raw?.phases || raw?.star || {};
  const star = rubric.phases.map(([phase]) => ({
    phase,
    rating: clamp(phasesIn[phase], 1, 5),
  }));

  // The model is asked for topic *keys*, but often echoes the label or a loose
  // variant ("Situation / setup", "situation setup"). Match tolerantly against
  // both keys and labels so a naming mismatch doesn't blank the timeline.
  const labels = topicLabelMap(rubric.key);
  const lookup = buildTopicLookup(labels);
  const coveredRaw = Array.isArray(raw?.covered_topics) ? raw.covered_topics : [];
  const covered = new Set();
  for (const item of coveredRaw) {
    const key = lookup(item);
    if (key) covered.add(key);
  }
  const timeline = Object.keys(labels).map((key) => ({
    topic: key,
    label: labels[key],
    covered: covered.has(key),
  }));

  const exchanges = (Array.isArray(raw?.exchanges) ? raw.exchanges : [])
    .map((e) => ({
      question: str(e?.question),
      answer_gist: str(e?.answer_gist),
      rating: ["strong", "adequate", "weak"].includes(e?.rating) ? e.rating : "adequate",
      comment: str(e?.comment),
      improvement: str(e?.improvement),
    }))
    .filter((e) => e.question && e.comment)
    .slice(0, 8);

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
    exchanges,
  };
}

// Resolve a model-supplied topic string to a canonical topic key, matching on
// the key itself or its human label, ignoring case and non-alphanumerics.
function buildTopicLookup(labels) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const map = new Map();
  for (const [key, label] of Object.entries(labels)) {
    map.set(norm(key), key);
    map.set(norm(label), key);
  }
  return (item) => (item == null ? null : map.get(norm(item)) || null);
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
