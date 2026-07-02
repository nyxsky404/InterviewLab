import { recordAssessment } from "./reportService.js";

// Handle a FunctionCallRequest emitted by the Deepgram-managed LLM.
// Returns a small JSON-serializable payload sent back as FunctionCallResponse
// so the agent's speech is never paused.
export async function handleFunctionCall(interviewId, name, args) {
  try {
    switch (name) {
      case "record_assessment":
        await recordAssessment(interviewId, args);
        return { ok: true };

      // submit_evaluation is purely a "the interview is over" signal —
      // voiceProxy uses it to trigger the graceful close. The actual report is
      // written post-call from the transcript (see finalizeInterview), so there
      // is nothing to persist here.
      case "submit_evaluation":
        return { ok: true };

      default:
        return { ok: false, error: `Unknown function: ${name}` };
    }
  } catch (err) {
    console.error(`[functionHandlers] ${name} failed:`, err.message);
    return { ok: false, error: err.message };
  }
}

// Deepgram may send arguments as a JSON string or an already-parsed object.
export function parseArguments(raw) {
  if (raw == null) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
