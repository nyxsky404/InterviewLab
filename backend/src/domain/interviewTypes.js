// Shape per type:
//   label / tagline     — display copy
//   interviewer         — the persona's name (used in the greeting)
//   competencies        — [{ key, label, hint, tip }] scored 1–5 per answer.
//     `hint`  tells the evaluator what the competency means.
//     `tip`   is the prescriptive advice shown when it's the candidate's gap.
//   topics              — [{ key, label }] the beats an interview works through;
//                         each live assessment is tagged with one (drives the
//                         report timeline).
//   phases              — [[phaseName, [topicKeys]]] how beats roll up into the
//                         report's phase panel (STAR for behavioral, etc.).
//   phaseTitle          — heading for that panel.

export const INTERVIEW_TYPES = {
  behavioral: {
    key: "behavioral",
    label: "Behavioral",
    tagline: "Communication, STAR structure, self-awareness",
    interviewer: "Maya Chen",
    phaseTitle: "STAR storytelling",
    competencies: [
      {
        key: "communication",
        label: "Communication",
        hint: "clarity, structure, and pacing of answers",
        tip: "Open each answer with a one-sentence headline, then walk through situation, action, and result.",
      },
      {
        key: "star_structure",
        label: "STAR structure",
        hint: "telling a complete Situation → Task → Action → Result story",
        tip: "Finish every story with a concrete Result, and don't skip the Situation that set it up.",
      },
      {
        key: "self_awareness",
        label: "Self-awareness",
        hint: "reflecting honestly on mistakes and what they'd change",
        tip: "End each story with a genuine reflection — what went wrong and what you'd do differently now.",
      },
      {
        key: "ownership",
        label: "Ownership",
        hint: "distinguishing what they personally did from the team's work",
        tip: "State exactly what you personally built end-to-end before crediting the team.",
      },
      {
        key: "impact",
        label: "Impact",
        hint: "measurable, validated outcomes",
        tip: "Back every metric with its sample size, time window, and how it was measured.",
      },
    ],
    topics: [
      { key: "situation", label: "Situation / setup" },
      { key: "problem", label: "The core problem" },
      { key: "team", label: "Team & their role" },
      { key: "ownership", label: "Personal ownership" },
      { key: "alternatives", label: "Alternatives weighed" },
      { key: "tradeoff", label: "The key tradeoff" },
      { key: "validation", label: "Results & validation" },
      { key: "mistake", label: "Mistakes & surprises" },
      { key: "conflict", label: "Conflict / disagreement" },
      { key: "reflection", label: "Reflection & hindsight" },
    ],
    phases: [
      ["Situation", ["situation", "problem"]],
      ["Task", ["team"]],
      ["Action", ["ownership", "alternatives", "tradeoff"]],
      ["Result", ["validation"]],
      ["Reflection", ["mistake", "conflict", "reflection"]],
    ],
  },

  technical: {
    key: "technical",
    label: "Technical",
    tagline: "Depth of knowledge, problem-solving approach",
    interviewer: "Alex Rivera",
    phaseTitle: "Problem-solving arc",
    competencies: [
      {
        key: "fundamentals",
        label: "Fundamentals",
        hint: "correct, precise understanding of the core concepts in their own stack",
        tip: "Revisit the fundamentals of the tools you use daily — be able to explain how they work, not just how to use them.",
      },
      {
        key: "problem_solving",
        label: "Problem solving",
        hint: "a structured approach to unfamiliar problems: clarify, decompose, reason step by step",
        tip: "Think out loud in steps: restate the problem, name your assumptions, then reason to an answer instead of jumping to one.",
      },
      {
        key: "depth",
        label: "Depth",
        hint: "how far below the surface their knowledge goes — internals, limits, failure modes",
        tip: "For your main tools, learn one level deeper than you use: internals, failure modes, and where they stop scaling.",
      },
      {
        key: "practical_experience",
        label: "Practical experience",
        hint: "evidence of real hands-on production work, not just tutorial familiarity",
        tip: "Anchor answers in real incidents and systems you've shipped — what broke, what you measured, what you changed.",
      },
      {
        key: "communication",
        label: "Communication",
        hint: "explaining technical ideas clearly and adjusting to the listener",
        tip: "Lead with the one-sentence answer, then add detail — don't make the interviewer dig for your point.",
      },
    ],
    topics: [
      { key: "background", label: "Stack & background" },
      { key: "concepts", label: "Core concepts" },
      { key: "reasoning", label: "Working a problem" },
      { key: "tradeoffs", label: "Technical tradeoffs" },
      { key: "debugging", label: "Debugging story" },
      { key: "edge_cases", label: "Edge cases & limits" },
      { key: "production", label: "Production experience" },
      { key: "reflection", label: "Reflection & learning" },
    ],
    phases: [
      ["Understanding", ["background", "concepts"]],
      ["Reasoning", ["reasoning", "tradeoffs"]],
      ["Depth", ["edge_cases", "debugging"]],
      ["Experience", ["production"]],
      ["Reflection", ["reflection"]],
    ],
  },

  system_design: {
    key: "system_design",
    label: "System Design",
    tagline: "Architecture thinking, tradeoffs, communicating complexity",
    interviewer: "Priya Nair",
    phaseTitle: "Design coverage",
    competencies: [
      {
        key: "requirements",
        label: "Requirements",
        hint: "clarifying scope, constraints, and scale before designing",
        tip: "Spend the first minutes on requirements: users, scale, and constraints — never design against an unstated problem.",
      },
      {
        key: "architecture",
        label: "Architecture",
        hint: "a coherent high-level design with sensible components and data flow",
        tip: "Name the components and the data flow between them before drilling into any single piece.",
      },
      {
        key: "scalability",
        label: "Scalability",
        hint: "identifying bottlenecks and how the design grows with load",
        tip: "For every design, identify the first bottleneck under 10x load and say how you'd relieve it.",
      },
      {
        key: "tradeoffs",
        label: "Tradeoffs",
        hint: "weighing alternatives explicitly and justifying choices",
        tip: "For each major choice, name the alternative you rejected and the cost you accepted — that's the tradeoff.",
      },
      {
        key: "communication",
        label: "Communication",
        hint: "structuring complexity so a listener can follow the design",
        tip: "Signpost as you go — 'first requirements, then the write path, then scaling' — so the listener always knows where you are.",
      },
    ],
    topics: [
      { key: "requirements", label: "Requirements & scope" },
      { key: "estimation", label: "Scale estimation" },
      { key: "api_model", label: "API & data model" },
      { key: "high_level", label: "High-level architecture" },
      { key: "storage", label: "Storage choices" },
      { key: "scaling", label: "Scaling strategy" },
      { key: "bottlenecks", label: "Bottlenecks" },
      { key: "reliability", label: "Reliability & failure" },
      { key: "tradeoffs", label: "Tradeoffs weighed" },
      { key: "evolution", label: "Evolution & hindsight" },
    ],
    phases: [
      ["Requirements", ["requirements", "estimation"]],
      ["Design", ["api_model", "high_level", "storage"]],
      ["Scale", ["scaling", "bottlenecks"]],
      ["Reliability", ["reliability"]],
      ["Judgment", ["tradeoffs", "evolution"]],
    ],
  },

  hr: {
    key: "hr",
    label: "HR / Culture Fit",
    tagline: "Motivation, values, situational judgment",
    interviewer: "Jordan Blake",
    phaseTitle: "Interview coverage",
    competencies: [
      {
        key: "motivation",
        label: "Motivation",
        hint: "a credible, specific reason for wanting this role and path",
        tip: "Connect your motivation to specifics — what about this role, team, or problem space actually pulls you.",
      },
      {
        key: "values",
        label: "Values & integrity",
        hint: "consistent values backed by real decisions, not slogans",
        tip: "Back each stated value with a real decision where holding it cost you something.",
      },
      {
        key: "situational_judgment",
        label: "Situational judgment",
        hint: "sensible handling of conflict, pressure, and ambiguity",
        tip: "For conflict stories, show the resolution steps you took — not just that things worked out.",
      },
      {
        key: "self_awareness",
        label: "Self-awareness",
        hint: "honest, specific strengths and weaknesses with evidence of growth",
        tip: "Name a real weakness with a concrete example and what you're doing about it — not a disguised strength.",
      },
      {
        key: "communication",
        label: "Communication",
        hint: "clear, structured, appropriately concise answers",
        tip: "Keep answers to the point: headline first, one strong example, then stop.",
      },
    ],
    topics: [
      { key: "journey", label: "Career story" },
      { key: "motivation", label: "Motivation & why" },
      { key: "goals", label: "Goals & direction" },
      { key: "strengths", label: "Strengths" },
      { key: "weaknesses", label: "Weaknesses" },
      { key: "conflict", label: "Handling conflict" },
      { key: "feedback", label: "Receiving feedback" },
      { key: "pressure", label: "Working under pressure" },
      { key: "culture", label: "Team & culture fit" },
      { key: "reflection", label: "Reflection & growth" },
    ],
    phases: [
      ["Story", ["journey", "motivation"]],
      ["Self-knowledge", ["strengths", "weaknesses"]],
      ["Judgment", ["conflict", "pressure", "feedback"]],
      ["Fit", ["goals", "culture"]],
      ["Reflection", ["reflection"]],
    ],
  },
};

export const TYPE_KEYS = Object.keys(INTERVIEW_TYPES);

export function getInterviewTypeConfig(type) {
  return INTERVIEW_TYPES[type];
}

// Lookup helpers used by the report pipeline.
export function getTopicLabels(type) {
  const p = getInterviewTypeConfig(type);
  return Object.fromEntries(p.topics.map((t) => [t.key, t.label]));
}

export function getCompetencyKeys(type) {
  return getInterviewTypeConfig(type).competencies.map((c) => c.key);
}

// The rubric the client needs to render a report for this type (labels, hints,
// phase panel title) — sent alongside interview detail so the frontend never
// hardcodes a type's competencies.
export function getClientRubric(type) {
  const p = getInterviewTypeConfig(type);
  return {
    type: p.key,
    label: p.label,
    interviewer: p.interviewer,
    phaseTitle: p.phaseTitle,
    competencies: p.competencies.map(({ key, label, hint }) => ({ key, label, hint })),
    topics: p.topics,
  };
}
