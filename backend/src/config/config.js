import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  deepgramApiKey: process.env.DEEPGRAM_API_KEY,
  llm: {
    type: process.env.LLM_PROVIDER || "anthropic",
    model: process.env.LLM_MODEL || "claude-sonnet-4-6",
    temperature: Number(process.env.LLM_TEMPERATURE || 0.6),
  },
  // full transcription feedback
  evaluation: {
    provider: process.env.EVAL_PROVIDER || "groq",
    apiKey: process.env.GROQ_API_KEY || "",
    baseUrl: process.env.EVAL_BASE_URL || "https://api.groq.com/openai/v1",
    model: process.env.EVAL_MODEL || "openai/gpt-oss-120b",
    enabled: Boolean(process.env.GROQ_API_KEY),
  },
  // live call evaluation
  graph: {
    enabled: process.env.GRAPH_DRIVEN !== "false", // default on
    maxQuestions: Number(process.env.GRAPH_MAX_QUESTIONS || 9),
    model: process.env.GRAPH_MODEL || process.env.EVAL_MODEL || "openai/gpt-oss-120b",
    temperature: Number(process.env.GRAPH_TEMPERATURE || 0.5),
  },
  voice: {
    listenModel: process.env.STT_MODEL || "nova-3",
    speakModel: process.env.TTS_MODEL || "aura-2-thalia-en",
    inputSampleRate: 16000,
    outputSampleRate: 24000,
  },
  limits: {
    jdMaxChars: Number(process.env.JD_MAX_CHARS || 2000),
    resumeMaxChars: Number(process.env.RESUME_MAX_CHARS || 3500),
    softWrapMs: Number(process.env.SOFT_WRAP_MS || 7 * 60 * 1000),
    postNudgeMs: Number(process.env.POST_NUDGE_MS || 60 * 1000),
    maxDurationMs: Number(process.env.MAX_DURATION_MS || 11 * 60 * 1000),
    endCallFallbackMs: Number(process.env.END_CALL_FALLBACK_MS || 20 * 1000),
    injectRetryMs: Number(process.env.INJECT_RETRY_MS || 1500),
    endCallCeilingMs: Number(process.env.END_CALL_CEILING_MS || 60 * 1000),
  },
};
