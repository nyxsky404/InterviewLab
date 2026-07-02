import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, ".env") });

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`\n[config] Missing required env var: ${name}`);
    console.error(`[config] Copy .env.example -> .env and fill it in.\n`);
    process.exit(1);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  deepgramApiKey: required("DEEPGRAM_API_KEY"),
  // Deepgram-managed "think" LLM (no BYO credentials/endpoint).
  // Model string must be one Deepgram hosts AND currently resolvable by the
  // upstream provider. The dated snapshot claude-sonnet-4-20250514 is listed in
  // Deepgram's catalog but 404s at Anthropic (deprecated), which kills the call
  // on the first think turn. claude-sonnet-4-6 (Sonnet 4.6) is the current
  // managed Sonnet and is verified working.
  llm: {
    type: process.env.LLM_PROVIDER || "anthropic",
    model: process.env.LLM_MODEL || "claude-sonnet-4-6",
    temperature: Number(process.env.LLM_TEMPERATURE || 0.6),
  },
  // Post-call report generation. A separate, external LLM reads the full
  // transcript after the call ends and produces the structured feedback. This
  // is deliberately decoupled from the Deepgram-managed voice LLM: if the key is
  // absent or the call fails, we fall back to synthesizing from the in-session
  // assessments, so the report is never blank.
  evaluation: {
    provider: process.env.EVAL_PROVIDER || "groq",
    apiKey: process.env.GROQ_API_KEY || "",
    baseUrl: process.env.EVAL_BASE_URL || "https://api.groq.com/openai/v1",
    model: process.env.EVAL_MODEL || "llama-3.3-70b-versatile",
    enabled: Boolean(process.env.GROQ_API_KEY),
  },
  // Deepgram STT (listen) + TTS (speak) models, and the audio formats we
  // negotiate with the browser.
  voice: {
    listenModel: process.env.STT_MODEL || "nova-3",
    speakModel: process.env.TTS_MODEL || "aura-2-thalia-en",
    inputSampleRate: 16000, // browser mic -> Deepgram (linear16 PCM)
    outputSampleRate: 24000, // Deepgram TTS -> browser (linear16 PCM)
  },
  // Interview length guardrails. The prompt aims to wrap up on its own; these
  // are the server-side backstops so a session can't run away on time or cost.
  limits: {
    // Nudge the agent to start closing (UpdatePrompt) once this elapses. Set
    // well before the intended end so the agent has runway to finish the current
    // thread, deliver its closing feedback, and say goodbye.
    softWrapMs: Number(process.env.SOFT_WRAP_MS || 7 * 60 * 1000),
    // After the soft nudge, escalate to a firm "wrap up now" instruction and
    // then keep re-sending it on this interval until the agent actually closes.
    postNudgeMs: Number(process.env.POST_NUDGE_MS || 60 * 1000),
    // Hard ceiling on total call length (Vapi calls this `maxDurationSeconds`).
    // If the agent still hasn't closed by now, the server takes over: it injects
    // a fixed closing line the agent SPEAKS (InjectAgentMessage, analogous to
    // Vapi's `endCallMessage`) and ends on the resulting AgentAudioDone — a
    // bounded call that still wraps up, never a mid-word socket cut. This is the
    // real backstop the nudges lack.
    maxDurationMs: Number(process.env.MAX_DURATION_MS || 11 * 60 * 1000),
    // Safety net: if the queued goodbye never produces an AgentAudioDone (e.g.
    // a dropped socket), end anyway after this grace so the session can't hang.
    // Re-armed once the goodbye starts speaking, so it always plays in full.
    endCallFallbackMs: Number(process.env.END_CALL_FALLBACK_MS || 20 * 1000),
    // If queueing the goodbye is refused because the candidate is mid-word,
    // retry on this interval until they pause and it lands.
    injectRetryMs: Number(process.env.INJECT_RETRY_MS || 1500),
    // Absolute ceiling on the hard-cut "waiting to speak the goodbye" phase. A
    // queued goodbye is refused while the candidate is talking, so if they never
    // stop we keep retrying up to this bound rather than cutting them off after
    // a few seconds. Generous, so any normal pause lands a full spoken goodbye
    // first; only a non-stop talker ever hits this silent last resort.
    endCallCeilingMs: Number(process.env.END_CALL_CEILING_MS || 60 * 1000),
  },
};
