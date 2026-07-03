import { StateSchema, ReducedValue } from "@langchain/langgraph";
import { z } from "zod";

function appendList(itemSchema = z.any()) {
  return new ReducedValue(z.array(itemSchema).default(() => []), {
    reducer: (prev, next) => prev.concat(next ?? []),
  });
}

export const InterviewState = new StateSchema({
  //Context (set once at start)
  interviewId: z.string().nullable().default(null),
  type: z.string().default("behavioral"),
  user: z.record(z.string(), z.any()).default(() => ({})), // { name, jobRole, resumeText, ... }
  jdText: z.string().default(""),

  //Conversation memory
  transcript: appendList(), // [{ role: "assistant"|"user", content }]
  answers: appendList(), // candidate answers
  assessments: appendList(), // [{ competency, topic, score, strength, note }]
  
  coverage: new ReducedValue(z.array(z.string()).default(() => []), {
    // Set-union of topic keys the interview has actually explored.
    reducer: (prev, next) => Array.from(new Set([...(prev || []), ...(next ?? [])])),
  }),
  runningScores: new ReducedValue(
    z.record(z.string(), z.array(z.number())).default(() => ({})),
    {
      inputSchema: z.record(z.string(), z.number()),
      reducer: (prev, next) => {
        const out = { ...(prev || {}) };
        for (const [k, v] of Object.entries(next || {})) out[k] = [...(out[k] || []), v];
        return out;
      },
    },
  ),

  //Adaptive control
  stage: z.string().default("opening"), // opening → probing → wrapping → closed
  difficulty: z.number().default(2), // 1 (gentle) … 5 (hard)
  weakStreak: z.number().default(0), // consecutive weak answers
  strongStreak: z.number().default(0), // consecutive strong answers
  currentTopic: z.string().nullable().default(null),
  sameTopicProbes: z.number().default(0), // how many turns we've stayed on currentTopic
  questionCount: z.number().default(0), // questions asked so far
  route: z.string().nullable().default(null), // last branch taken: followup|harder|newtopic|wrapup

  //Outputs
  lastQuestion: z.string().default(""),
  lastAnswer: z.string().default(""),
  lastEvaluation: z.any().nullable().default(null), // { competency, topic, score, strength, note }
  directive: z.string().default(""), // NEXT MOVE text pushed to the voice agent
  done: z.boolean().default(false), // director has decided to close

  startedAt: z.number().default(0),
});
