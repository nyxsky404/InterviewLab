import { ChatGroq } from "@langchain/groq";
import { config } from "../config/config.js";

// Lazy initialization
function buildGroqModel(extra = {}) {
  return new ChatGroq({
    model: config.graph.model,
    temperature: config.graph.temperature,
    maxRetries: 2,
    ...extra,
  });
}

let groqModel = null;
let groqJsonModel = null;

// caching
function getGroqModel() {
  return (groqModel ||= buildGroqModel());
}

function getGroqJsonModel() {
  return (groqJsonModel ||= buildGroqModel({ response_format: { type: "json_object" } }));
}

// Ask the model for a JSON object (evaluateAnswer ) and parse it.
export async function chatJSON({ system, user }) {
  const model = getGroqJsonModel();
  const res = await model.invoke([
    ["system", system],
    ["human", user],
  ]);
  const content = typeof res.content === "string" ? res.content : String(res.content ?? "");
  return JSON.parse(content);
}

// Ask the model for a short spoken line (a question / closing remark). Returns trimmed plain text.
export async function chatText({ system, user }) {
  const model = getGroqModel();
  const res = await model.invoke([
    ["system", system],
    ["human", user],
  ]);
  const content = typeof res.content === "string" ? res.content : String(res.content ?? "");
  return content.trim();
}
