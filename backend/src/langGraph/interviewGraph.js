//               START
//                 |
//          entryRouter(state)
//           /             \
//          /               \
// generateQuestion    evaluateAnswer
//       |                    |
//      END          adjustDifficulty
//                           |
//                     decideRoute
//                           |
//                  routeCondition()
//                     /          \
//                    /            \
//          generateQuestion   closing
//                 |                 |
//                END               END

// Interview starts

// questionCount = 0
//         ↓
// generateQuestion
//         ↓
// questionCount = 1

// User answers
//         ↓
// evaluateAnswer
//         ↓
// generateQuestion
//         ↓
// questionCount = 2

import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { InterviewState } from "./state.js";
import {
  evaluateAnswer,
  adjustDifficulty,
  decideRoute,
  generateQuestion,
  closing,
} from "./nodes.js";

function entryRouter(state) {
  return (state.questionCount || 0) === 0 ? "generateQuestion" : "evaluateAnswer";
}

function routeCondition(state) {
  return state.route === "wrapup" ? "closing" : "generateQuestion";
}

export function buildInterviewGraph() {
  const checkpointer = new MemorySaver();

  const workflow = new StateGraph(InterviewState)
    .addNode("evaluateAnswer", evaluateAnswer)
    .addNode("adjustDifficulty", adjustDifficulty)
    .addNode("decideRoute", decideRoute)
    .addNode("generateQuestion", generateQuestion)
    .addNode("closing", closing)
    .addConditionalEdges(START, entryRouter)
    .addEdge("evaluateAnswer", "adjustDifficulty")
    .addEdge("adjustDifficulty", "decideRoute")
    .addConditionalEdges("decideRoute", routeCondition)
    .addEdge("generateQuestion", END)
    .addEdge("closing", END);

  return workflow.compile({ checkpointer });
}
