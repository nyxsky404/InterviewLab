import WebSocket from "ws";
import { config } from "../config/config.js";
import { prisma } from "../data/prisma.js";
import {
  buildInstructions,
  buildDeliveryInstructions,
  buildDirectivePrompt,
  buildGreeting,
  buildFunctionDefs,
} from "../prompts/interviewer.js";
import { handleFunctionCall, parseArguments } from "./functionHandlers.js";
import { orchestrator } from "../langGraph/orchestrator.js";

const DEEPGRAM_AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";
const KEEPALIVE_MS = 8000;

const WRAP_UP_INSTRUCTION =
  "TIME CHECK: The interview is almost out of time. Do NOT start any new topics or questions. Finish the current thread briefly, then give one short closing line thanking the candidate and telling them their feedback is on the way, call submit_evaluation, and stop.";

const FINAL_CLOSE_INSTRUCTION =
  "TIME IS UP. Stop the current topic immediately. In your very next turn, give the candidate one or two sentences of overall feedback, thank them, tell them their full report is ready, call submit_evaluation, and stop. Do not ask anything else.";

const CLOSE_TRIGGER_MESSAGE =
  "We're out of time now, so let's wrap up. Please share my overall feedback and then close out the interview.";

const COMPLETE_FALLBACK_MS = 4000;

const END_CALL_MESSAGE =
  "That's all the time we have for today. Thank you so much for walking me through your work — it was great hearing about it. Your full feedback report is on its way. Take care!";

export function attachVoiceProxy(client, ctx) {
  const { interviewId, type, user, jdText } = ctx;
  let seq = 0;
  let settingsApplied = false;
  let keepAlive = null;
  let wrapTimer = null;
  let postNudgeTimer = null;
  let completeFallback = null;
  let maxDurationTimer = null;
  let endCallFallback = null;
  let endCallCeiling = null;
  let endCallRetry = null;
  let endCallInjected = false;
  let sawEndCallSpeech = false;
  let wantEndCall = false;
  let pendingComplete = false;
  let closing = false;
  let sawCloseSpeech = false;
  let completeSent = false;
  const mediaBuffer = [];

  let graphMode = config.graph.enabled;
  let answerBuffer = [];
  let graphBusy = false;

  prisma.transcription
    .findFirst({
      where: { interviewId: Number(interviewId) },
      orderBy: { seq: "desc" },
      select: { seq: true },
    })
    .then((transcription) => {
      seq = transcription?.seq || 0;
    });

  const dg = new WebSocket(DEEPGRAM_AGENT_URL, {
    headers: { Authorization: `Token ${config.deepgramApiKey}` },
  });

  dg.on("open", async () => {
    if (graphMode) {
      try {
        await orchestrator.start(interviewId, { type, user, jdText });
      } catch (err) {
        console.error("[voiceProxy] graph start failed — autonomous fallback:", err.message);
        graphMode = false;
      }
    }
    dg.send(JSON.stringify(buildSettings({ type, user, jdText, graphMode })));
    keepAlive = setInterval(() => {
      if (dg.readyState === WebSocket.OPEN) dg.send(JSON.stringify({ type: "KeepAlive" }));
    }, KEEPALIVE_MS);
  });

  dg.on("message", async (data, isBinary) => {
    if (isBinary) {
      sendBinary(client, data);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    await onDeepgramEvent(msg);
  });

  dg.on("close", (code, reason) => {
    const why = reason?.toString?.() || "";
    console.log(`[voiceProxy] deepgram closed (code=${code}${why ? `, reason=${why}` : ""})`);
    cleanup();
    sendJson(client, { type: "closed" });
    if (client.readyState === WebSocket.OPEN) client.close();
    markAbandonedIfUnfinished();
  });

  dg.on("error", (err) => {
    console.error("[voiceProxy] deepgram error:", err.message);
    sendJson(client, { type: "error", message: "Voice service error" });
  });

  async function onDeepgramEvent(msg) {
    switch (msg.type) {
      case "Welcome":
        if (msg.request_id) {
          await prisma.interview.update({
            where: { id: Number(interviewId) },
            data: { deepgramRequestId: msg.request_id },
          });
        }
        break;

      case "SettingsApplied":
        settingsApplied = true;
        for (const chunk of mediaBuffer) dg.send(chunk);
        mediaBuffer.length = 0;
        sendJson(client, { type: "ready" });
        startLimitTimers();
        break;

      case "ConversationText": {
        if (msg.role === "user" && normalizeText(msg.content) === normalizeText(CLOSE_TRIGGER_MESSAGE)) {
          break;
        }
        if (msg.role === "user" && wantEndCall && !endCallInjected && !sawEndCallSpeech && !completeSent) {
          clearTimer(endCallRetry);
          injectEndCall();
        }
        seq += 1;
        await prisma.transcription.create({
          data: {
            interviewId: Number(interviewId),
            seq,
            role: msg.role,
            content: msg.content,
          },
        });
        sendJson(client, { type: "transcript", role: msg.role, content: msg.content });
        if (graphMode && msg.role === "user") bufferUserSpeech(msg.content);
        break;
      }

      case "UserStartedSpeaking":
        sendJson(client, { type: "state", value: "user_speaking" });
        break;

      case "AgentThinking":
        // Deepgram's endpointer has decided the candidate's turn is over and the
        // agent is now processing it. This is the true end-of-turn boundary, so
        // flush the whole answer as exactly ONE director step here — no matter how
        // many pause-separated transcript segments it arrived in. Firing on this
        // event (rather than a fixed timer) is also early enough to run the
        // director while the agent is still thinking, so the directive can land
        // before it speaks.
        endUserTurn();
        break;

      case "AgentStartedSpeaking":
        sendJson(client, { type: "state", value: "agent_speaking" });
        // Backstop: if AgentThinking wasn't emitted, close out the turn here.
        // A no-op when AgentThinking already flushed it (buffer is empty).
        endUserTurn();
        if (closing) sawCloseSpeech = true;
        if (endCallInjected && !sawEndCallSpeech) {
          sawEndCallSpeech = true;
          clearTimer(endCallCeiling);
          clearTimer(endCallFallback);
          endCallFallback = setTimeout(
            () => finishComplete("max_duration_fallback"),
            config.limits.endCallFallbackMs
          );
        }
        break;

      case "AgentAudioDone":
        sendJson(client, { type: "state", value: "agent_done" });
        if (pendingComplete) { finishComplete("agent_closed"); break; }
        if (endCallInjected && sawEndCallSpeech) { finishComplete("max_duration"); break; }
        if (wantEndCall) break;
        if (closing && sawCloseSpeech) { finishComplete("graceful_close"); break; }
        break;

      case "InjectionRefused":
        console.warn("[voiceProxy] closing line refused (user speaking) — will retry");
        if (!completeSent && wantEndCall && !sawEndCallSpeech) {
          endCallInjected = false;
          clearTimer(endCallRetry);
          endCallRetry = setTimeout(injectEndCall, config.limits.injectRetryMs);
        }
        break;

      case "FunctionCallRequest":
        await onFunctionCalls(msg.functions || []);
        break;

      case "Error":
        console.error("[voiceProxy] agent Error:", msg.description || msg);
        sendJson(client, { type: "error", message: msg.description || "Agent error" });
        break;

      case "Warning":
        console.warn("[voiceProxy] agent Warning:", msg.description || msg);
        break;

      default:
        break;
    }
  }

  async function onFunctionCalls(functions) {
    for (const fn of functions) {
      const args = parseArguments(fn.arguments);
      console.log(`[voiceProxy] function call: ${fn.name} (client_side=${fn.client_side})`);
      const result = await handleFunctionCall(interviewId, fn.name, args, { type });
      if (fn.client_side !== false) {
        dg.send(
          JSON.stringify({
            type: "FunctionCallResponse",
            id: fn.id,
            name: fn.name,
            content: JSON.stringify(result),
          })
        );
      }
      if (fn.name === "submit_evaluation") {
        pendingComplete = true;
        clearTimer(completeFallback);
        completeFallback = setTimeout(() => finishComplete("eval_fallback"), COMPLETE_FALLBACK_MS);
      }
    }
  }

  client.on("message", (data, isBinary) => {
    if (isBinary) {
      if (dg.readyState !== WebSocket.OPEN) return;
      if (settingsApplied) dg.send(data);
      else mediaBuffer.push(data);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "end") closeAll();
  });

  client.on("close", closeAll);
  client.on("error", () => closeAll());

  function closeAll() {
    cleanup();
    if (dg.readyState === WebSocket.OPEN || dg.readyState === WebSocket.CONNECTING) dg.close();
  }

  // Accumulate the candidate's speech as pause-separated transcript segments
  // arrive. We do NOT run the director here — the turn isn't over yet — we just
  // collect until an end-of-turn signal (AgentThinking / AgentStartedSpeaking)
  // flushes the whole answer as one step.
  function bufferUserSpeech(text) {
    if (closing || completeSent) return;
    if (text && text.trim()) answerBuffer.push(text.trim());
  }

  function endUserTurn() {
    if (!graphMode || closing || completeSent || wantEndCall) return;
    runGraphStep();
  }

  async function runGraphStep() {
    if (graphBusy || completeSent || !graphMode) return;
    const answer = answerBuffer.join(" ").trim();
    if (!answer) return;
    answerBuffer = [];
    graphBusy = true;
    try {
      const res = await orchestrator.submitAnswer(interviewId, answer);
      if (completeSent) return;
      console.log(
        `[voiceProxy] director: ${res.route} (q${res.questionCount}, diff ${res.difficulty})`
      );
      sendJson(client, {
        type: "director",
        route: res.route,
        stage: res.stage,
        difficulty: res.difficulty,
        questionCount: res.questionCount,
      });
      if (res.done) directorClose(res.directive);
      else if (res.directive) pushDirective(res.directive);
    } catch (err) {
      console.error("[voiceProxy] graph step failed:", err.message);
    } finally {
      graphBusy = false;
    }
  }

  function pushDirective(directive) {
    if (dg.readyState !== WebSocket.OPEN || !directive) return;
    dg.send(JSON.stringify({ type: "UpdatePrompt", prompt: buildDirectivePrompt(directive) }));
  }

  function directorClose(directive) {
    if (closing || pendingComplete || completeSent) return;
    console.log("[voiceProxy] director closing the interview");
    closing = true;
    sawCloseSpeech = false;
    clearTimer(postNudgeTimer);
    if (dg.readyState === WebSocket.OPEN) {
      dg.send(
        JSON.stringify({ type: "UpdatePrompt", prompt: buildDirectivePrompt(directive, { closing: true }) })
      );
      dg.send(JSON.stringify({ type: "InjectUserMessage", content: CLOSE_TRIGGER_MESSAGE }));
    }
  }

  function startLimitTimers() {
    wrapTimer = setTimeout(nudgeWrapUp, config.limits.softWrapMs);
    maxDurationTimer = setTimeout(endCallOnMaxDuration, config.limits.maxDurationMs);
  }

  function nudgeWrapUp() {
    if (pendingComplete || completeSent) return;
    console.log("[voiceProxy] soft time limit — nudging agent to wrap up");
    if (dg.readyState === WebSocket.OPEN) {
      dg.send(JSON.stringify({ type: "UpdatePrompt", prompt: WRAP_UP_INSTRUCTION }));
    }
    clearTimer(postNudgeTimer);
    postNudgeTimer = setTimeout(forceGracefulClose, config.limits.postNudgeMs);
  }

  function forceGracefulClose() {
    if (pendingComplete || completeSent) return;
    if (!closing) {
      console.log("[voiceProxy] post-nudge — asking agent to close (graceful, no hard cut)");
      closing = true;
      sawCloseSpeech = false;
    } else {
      console.log("[voiceProxy] agent still going — re-nudging to wrap up");
    }
    if (dg.readyState === WebSocket.OPEN) {
      dg.send(JSON.stringify({ type: "UpdatePrompt", prompt: FINAL_CLOSE_INSTRUCTION }));
      dg.send(JSON.stringify({ type: "InjectUserMessage", content: CLOSE_TRIGGER_MESSAGE }));
    }
    clearTimer(postNudgeTimer);
    postNudgeTimer = setTimeout(forceGracefulClose, config.limits.postNudgeMs);
  }

  function endCallOnMaxDuration() {
    if (pendingComplete || completeSent || wantEndCall) return;
    console.log("[voiceProxy] max duration reached — queueing closing line");
    wantEndCall = true;
    clearTimer(postNudgeTimer);
    clearTimer(endCallCeiling);
    endCallCeiling = setTimeout(
      () => finishComplete("max_duration_ceiling"),
      config.limits.endCallCeilingMs
    );
    injectEndCall();
  }

  function injectEndCall() {
    if (!wantEndCall || endCallInjected || completeSent) return;
    endCallInjected = true;
    sawEndCallSpeech = false;
    console.log("[voiceProxy] queueing closing line (InjectAgentMessage behavior=queue)");
    if (dg.readyState === WebSocket.OPEN) {
      dg.send(
        JSON.stringify({ type: "InjectAgentMessage", message: END_CALL_MESSAGE, behavior: "queue" })
      );
    }
  }

  function finishComplete(reason) {
    if (completeSent) return;
    completeSent = true;
    pendingComplete = false;
    console.log(`[voiceProxy] completing interview (${reason})`);
    cleanup();
    sendJson(client, { type: "complete" });
    setTimeout(() => {
      if (dg.readyState === WebSocket.OPEN || dg.readyState === WebSocket.CONNECTING) dg.close();
    }, 300);
  }

  function cleanup() {
    clearTimer(keepAlive, true);
    keepAlive = null;
    clearTimer(wrapTimer);
    clearTimer(postNudgeTimer);
    clearTimer(completeFallback);
    clearTimer(maxDurationTimer);
    clearTimer(endCallFallback);
    clearTimer(endCallCeiling);
    clearTimer(endCallRetry);
    wrapTimer = postNudgeTimer = completeFallback = null;
    maxDurationTimer = endCallFallback = endCallCeiling = endCallRetry = null;
  }

  function markAbandonedIfUnfinished() {
    prisma.interview
      .updateMany({
        where: { id: Number(interviewId), status: "in_progress" },
        data: { status: "abandoned" },
      })
      .catch((err) => console.error("[voiceProxy] failed to mark abandoned:", err.message));
  }
}

function normalizeText(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clearTimer(t, isInterval = false) {
  if (!t) return;
  if (isInterval) clearInterval(t);
  else clearTimeout(t);
}

function buildSettings({ type, user, jdText, graphMode }) {
  const { voice, llm } = config;
  const think = graphMode
    ? {
        provider: { type: llm.type, model: llm.model, temperature: llm.temperature },
        prompt: buildDeliveryInstructions({ type, user, jdText }),
        functions: [],
      }
    : {
        provider: { type: llm.type, model: llm.model, temperature: llm.temperature },
        prompt: buildInstructions({ type, user, jdText }),
        functions: buildFunctionDefs(type),
      };
  return {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: voice.inputSampleRate },
      output: { encoding: "linear16", sample_rate: voice.outputSampleRate, container: "none" },
    },
    agent: {
      language: "en",
      listen: {
        provider: {
          type: "deepgram",
          version: "v1",
          model: voice.listenModel,
          smart_format: true,
        },
      },
      think,
      speak: {
        provider: { type: "deepgram", model: voice.speakModel },
      },
      greeting: buildGreeting({ type, user }),
    },
  };
}

function sendJson(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function sendBinary(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: true });
}
