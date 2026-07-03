// Build and compile the graph once at server start, then reuse the same graph instance for all user & interview to avoid recompiling on every request.

import { buildInterviewGraph } from "./interviewGraph.js";

const graph = buildInterviewGraph();

function threadConfig(interviewId) {
  return { configurable: { thread_id: `interview-${interviewId}` } };
}

function startingDifficulty(user) {
  const level = String(user?.experienceLevel).toLowerCase();
  if (level === "senior") return 3;
  if (level === "junior") return 1;
  return 2;
}

// Initialize a new interview session and generate the opening question.
async function start(interviewId, ctx) {
  const input = {
    interviewId: String(interviewId),
    type: ctx.type,
    user: ctx.user || {},
    jdText: ctx.jdText || "",
    difficulty: startingDifficulty(ctx.user),
    startedAt: Date.now(),
  };
  const out = await graph.invoke(input, threadConfig(interviewId));
  return { directive: out.directive, state: out };
}

// Process the candidate's answer and return the next interview step.
async function submitAnswer(interviewId, answerText) {
  const out = await graph.invoke(
    {
      lastAnswer: answerText,
      transcript: [{ role: "user", content: answerText }],
      answers: [answerText],
    },
    threadConfig(interviewId)
  );
  return {
    directive: out.directive,
    done: Boolean(out.done),
    route: out.route,
    stage: out.stage,
    difficulty: out.difficulty,
    questionCount: out.questionCount,
    evaluation: out.lastEvaluation,
  };
}

export const orchestrator = { start, submitAnswer };
