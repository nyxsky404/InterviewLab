import WebSocket from "ws";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { buildInstructions, buildGreeting, FUNCTION_DEFS } from "../prompts/interviewer.js";
import { handleFunctionCall, parseArguments } from "./functionHandlers.js";

const DEEPGRAM_AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";
const KEEPALIVE_MS = 8000;

// Appended to the live prompt (via UpdatePrompt) when the soft time limit hits,
// so the agent starts closing on its own instead of opening new topics.
const WRAP_UP_INSTRUCTION =
  "TIME CHECK: The interview is almost out of time. Do NOT start any new topics or questions. Finish the current thread briefly, then give one short closing line thanking the candidate and telling them their feedback is on the way, call submit_evaluation, and stop.";

// Firm final instruction sent if the agent is still going after the post-nudge
// grace. Unlike the soft nudge, this tells it to close *right now*; we then end
// on the next speech boundary (the goodbye it speaks in response) so the cut
// always lands after a finished sentence, never mid-word.
const FINAL_CLOSE_INSTRUCTION =
  "TIME IS UP. Stop the current topic immediately. In your very next turn, give the candidate one or two sentences of overall feedback, thank them, tell them their full report is ready, call submit_evaluation, and stop. Do not ask anything else.";

// Synthetic candidate turn injected alongside FINAL_CLOSE_INSTRUCTION. Per the
// Deepgram docs, UpdatePrompt is config-only — it changes future turns but does
// NOT make the agent take one, so in a lull the appended "wrap up" instruction
// sits unused and the agent never reacts. InjectUserMessage injects a user turn
// the agent MUST respond to, so it actually delivers its close now. We suppress
// this line from the transcript (it isn't something the candidate really said).
const CLOSE_TRIGGER_MESSAGE =
  "We're out of time now, so let's wrap up. Please share my overall feedback and then close out the interview.";

// If the model calls submit_evaluation but no AgentAudioDone follows (e.g. it
// closed without a spoken line), end anyway after this grace period.
const COMPLETE_FALLBACK_MS = 4000;

// Deterministic closing line the SERVER makes the agent speak when the hard
// duration cap is hit (Vapi's `endCallMessage` analog). Unlike the nudges, this
// doesn't ask the model to close — we inject it as the agent's own speech via
// InjectAgentMessage, then end on its AgentAudioDone so the goodbye plays in
// full. Deepgram also emits a ConversationText for it, so it lands in `turns`
// and the transcript-based report stays complete.
const END_CALL_MESSAGE =
  "That's all the time we have for today. Thank you so much for walking me through your work — it was great hearing about it. Your full feedback report is on its way. Take care!";

// Bridges a browser WebSocket to a Deepgram Voice Agent session.
//   browser mic (binary PCM16)  ->  Express  ->  Deepgram
//   Deepgram TTS (binary PCM16) ->  Express  ->  browser
// Express also persists every ConversationText turn and services the LLM's
// function calls (record_assessment / submit_evaluation) — all server-side.
export function attachVoiceProxy(client, ctx) {
  const { interviewId, type, user } = ctx;
  let seq = 0;
  let settingsApplied = false;
  let keepAlive = null;
  let wrapTimer = null; // soft: nudge the agent to start closing
  let postNudgeTimer = null; // after nudge: firm "wrap up now", re-sent each interval
  let completeFallback = null; // safety net after submit_evaluation
  let maxDurationTimer = null; // hard cap: server-driven close if agent never wraps
  let endCallFallback = null; // safety net if the queued goodbye never completes
  let endCallCeiling = null; // absolute bound on "waiting for the candidate to pause"
  let endCallRetry = null; // retry queueing the goodbye if the user was speaking
  let endCallInjected = false; // we queued END_CALL_MESSAGE; end on ITS AgentAudioDone
  let sawEndCallSpeech = false; // the goodbye turn has actually started speaking
  let wantEndCall = false; // hard cap hit; the server owns the close from here
  let pendingComplete = false; // agent is closing; end after it finishes speaking
  let closing = false; // forced-close armed: end on the agent's next spoken segment
  let sawCloseSpeech = false; // agent has started a new spoken segment since forced close
  let completeSent = false; // guard so we only end once
  const mediaBuffer = []; // mic audio captured before Deepgram is ready

  seedSeq(interviewId).then((n) => {
    seq = n;
  });

  const dg = new WebSocket(DEEPGRAM_AGENT_URL, {
    headers: { Authorization: `Token ${config.deepgramApiKey}` },
  });

  // ── Deepgram -> us ─────────────────────────────────────────────────────
  dg.on("open", () => {
    dg.send(JSON.stringify(buildSettings({ type, user })));
    keepAlive = setInterval(() => {
      if (dg.readyState === WebSocket.OPEN) dg.send(JSON.stringify({ type: "KeepAlive" }));
    }, KEEPALIVE_MS);
  });

  dg.on("message", async (data, isBinary) => {
    if (isBinary) {
      // TTS audio: forward straight to the browser.
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
  });

  dg.on("error", (err) => {
    console.error("[voiceProxy] deepgram error:", err.message);
    sendJson(client, { type: "error", message: "Voice service error" });
  });

  async function onDeepgramEvent(msg) {
    switch (msg.type) {
      case "Welcome":
        if (msg.request_id) {
          await query(`UPDATE interviews SET deepgram_request_id = $1 WHERE id = $2`, [
            msg.request_id,
            interviewId,
          ]);
        }
        break;

      case "SettingsApplied":
        settingsApplied = true;
        // Flush any mic audio captured while we were still configuring.
        for (const chunk of mediaBuffer) dg.send(chunk);
        mediaBuffer.length = 0;
        sendJson(client, { type: "ready" });
        startLimitTimers(); // the interview clock starts now
        break;

      case "ConversationText": {
        // Drop the synthetic close-trigger turn we inject to force the agent's
        // wrap-up — it's a control signal, not something the candidate said, so
        // it must not land in the transcript or the report.
        if (msg.role === "user" && normalizeText(msg.content) === normalizeText(CLOSE_TRIGGER_MESSAGE)) {
          break;
        }
        // Hard cut is armed and the goodbye couldn't be queued yet because the
        // candidate was talking. Their turn just finalized (this event) — they've
        // paused, so try to land the goodbye right now instead of waiting for the
        // next retry tick. Then still persist the turn below.
        if (msg.role === "user" && wantEndCall && !endCallInjected && !sawEndCallSpeech && !completeSent) {
          clearTimer(endCallRetry);
          injectEndCall();
        }
        seq += 1;
        await query(
          `INSERT INTO turns (interview_id, seq, role, content) VALUES ($1, $2, $3, $4)`,
          [interviewId, seq, msg.role, msg.content]
        );
        sendJson(client, { type: "transcript", role: msg.role, content: msg.content });
        break;
      }

      case "UserStartedSpeaking":
        sendJson(client, { type: "state", value: "user_speaking" });
        break;

      case "AgentStartedSpeaking":
        sendJson(client, { type: "state", value: "agent_speaking" });
        // After a forced close, mark that the agent has begun a *new* spoken
        // segment (its closing line) so we end once it finishes, not on the
        // audio that was already in flight when we escalated.
        if (closing) sawCloseSpeech = true;
        // Hard-cap path: the queued goodbye appends AFTER the agent's current
        // turn, so the first AgentStartedSpeaking once it's queued is the goodbye
        // itself. Mark it, and give it a fresh full window to play out.
        if (endCallInjected && !sawEndCallSpeech) {
          sawEndCallSpeech = true;
          // Goodbye is now speaking: drop the "waiting to pause" ceiling and hand
          // off to the tight per-goodbye net, so it always plays out in full.
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
        // If the agent just finished its closing line, end the session now.
        if (pendingComplete) { finishComplete("agent_closed"); break; }
        // Hard-cap path: end only once the *goodbye* has both started and
        // finished — never on the turn that was already in flight when we queued.
        if (endCallInjected && sawEndCallSpeech) { finishComplete("max_duration"); break; }
        // Hard cap has fired and its fixed goodbye is queued behind whatever the
        // agent was doing (e.g. asking another question). Wait for THAT goodbye's
        // boundary — do NOT fall through to graceful_close and end on the
        // dangling question/answer, which would cut before the goodbye plays.
        if (wantEndCall) break;
        // Forced-close path: the agent spoke its goodbye in full — end on this
        // clean boundary instead of waiting for the hard cap.
        if (closing && sawCloseSpeech) { finishComplete("graceful_close"); break; }
        break;

      // Deepgram refuses a queued injection only if the USER is speaking. Reset
      // and retry shortly — the goodbye will land once the candidate pauses.
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
      const result = await handleFunctionCall(interviewId, fn.name, args);
      // Our functions are defined without an endpoint, so Deepgram marks them
      // client_side: true and expects US to send the FunctionCallResponse.
      // (client_side: false means Deepgram executed it server-side and replies
      // itself — nothing for us to do.) Reply unless it's explicitly false.
      if (fn.client_side !== false) {
        // Reply so the agent keeps talking without pausing on the tool call.
        dg.send(
          JSON.stringify({
            type: "FunctionCallResponse",
            id: fn.id,
            name: fn.name,
            content: JSON.stringify(result),
          })
        );
      }
      // The agent submitting its evaluation IS the end of the interview. Let its
      // closing line finish (AgentAudioDone), then wrap up. Fallback in case no
      // spoken close follows.
      if (fn.name === "submit_evaluation") {
        pendingComplete = true;
        clearTimer(completeFallback);
        completeFallback = setTimeout(() => finishComplete("eval_fallback"), COMPLETE_FALLBACK_MS);
      }
    }
  }

  // ── Browser -> us ──────────────────────────────────────────────────────
  client.on("message", (data, isBinary) => {
    if (isBinary) {
      if (dg.readyState !== WebSocket.OPEN) return;
      if (settingsApplied) dg.send(data);
      else mediaBuffer.push(data);
      return;
    }
    // JSON control messages from the browser (e.g. explicit end).
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

  // ── Length guardrails ──────────────────────────────────────────────────
  function startLimitTimers() {
    wrapTimer = setTimeout(nudgeWrapUp, config.limits.softWrapMs);
    // Hard ceiling: independent of the nudges, guaranteed to fire.
    maxDurationTimer = setTimeout(endCallOnMaxDuration, config.limits.maxDurationMs);
  }

  // Soft limit: steer the agent to close itself (it'll call submit_evaluation,
  // which triggers the graceful end). Non-destructive if it's already closing.
  function nudgeWrapUp() {
    if (pendingComplete || completeSent) return;
    console.log("[voiceProxy] soft time limit — nudging agent to wrap up");
    if (dg.readyState === WebSocket.OPEN) {
      dg.send(JSON.stringify({ type: "UpdatePrompt", prompt: WRAP_UP_INSTRUCTION }));
    }
    // If the agent doesn't take the hint, escalate — but still gracefully.
    clearTimer(postNudgeTimer);
    postNudgeTimer = setTimeout(forceGracefulClose, config.limits.postNudgeMs);
  }

  // Post-nudge escalation: the agent is still going. Send a firm "wrap up now"
  // instruction and arm a close that lands on its next finished spoken segment
  // (see AgentStartedSpeaking/AgentAudioDone) — so the goodbye always plays in
  // full, never mid-word. This nudge re-sends every interval, steering the agent
  // to close on its own for the cleanest ending. It's best-effort, not a
  // guarantee: the hard backstop is endCallOnMaxDuration (config.maxDurationMs),
  // which bounds total call length no matter how the agent behaves.
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
      // Steer future turns to close...
      dg.send(JSON.stringify({ type: "UpdatePrompt", prompt: FINAL_CLOSE_INSTRUCTION }));
      // ...then actually trigger a turn. UpdatePrompt alone is inert until the
      // agent next speaks; injecting a user turn makes it respond (and close) now.
      dg.send(JSON.stringify({ type: "InjectUserMessage", content: CLOSE_TRIGGER_MESSAGE }));
    }
    // Keep nudging on the same interval until the agent actually wraps up.
    clearTimer(postNudgeTimer);
    postNudgeTimer = setTimeout(forceGracefulClose, config.limits.postNudgeMs);
  }

  // Hard cap (Vapi `maxDurationSeconds` analog). The nudges never forced an end;
  // this does. We stop nagging the model and instead make IT speak a fixed
  // closing line via InjectAgentMessage — so the call is bounded but still wraps
  // up with a real spoken goodbye, not a mid-word socket cut. behavior:"queue"
  // lets the line play after any in-flight turn rather than being refused. We
  // then end on its AgentAudioDone (see above), with a fallback if none arrives.
  function endCallOnMaxDuration() {
    if (pendingComplete || completeSent || wantEndCall) return;
    console.log("[voiceProxy] max duration reached — queueing closing line");
    wantEndCall = true;
    // Stop the wrap-up nudge loop; the server owns the close from here.
    clearTimer(postNudgeTimer);
    // Bound the "waiting for the candidate to pause" phase with a GENEROUS
    // ceiling. A queued goodbye is refused while the user is speaking, so we keep
    // retrying (see InjectionRefused / user ConversationText) and only fall back
    // to a silent cut if they never stop talking for this long — the genuine
    // last resort. The tight per-goodbye net is armed separately once the
    // goodbye actually starts speaking (see AgentStartedSpeaking).
    clearTimer(endCallCeiling);
    endCallCeiling = setTimeout(
      () => finishComplete("max_duration_ceiling"),
      config.limits.endCallCeilingMs
    );
    injectEndCall();
  }

  // Speak the deterministic closing line. Per Deepgram, InjectAgentMessage with
  // behavior:"queue" appends the line AFTER the agent's current turn and is
  // refused only if the *user* is speaking (unlike "default", which is also
  // refused mid-agent-turn). So we queue it right away — no need to wait for a
  // silent gap — and retry on InjectionRefused if the candidate is mid-word. We
  // then end on the goodbye's OWN AgentAudioDone (endCallInjected+sawEndCallSpeech).
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

  // Tell the browser the interview is over so it drains audio, tears down, and
  // navigates to the report. Then close the Deepgram side. Runs at most once.
  function finishComplete(reason) {
    if (completeSent) return;
    completeSent = true;
    pendingComplete = false;
    console.log(`[voiceProxy] completing interview (${reason})`);
    clearTimer(completeFallback);
    clearTimer(wrapTimer);
    clearTimer(postNudgeTimer);
    clearTimer(maxDurationTimer);
    clearTimer(endCallFallback);
    clearTimer(endCallCeiling);
    clearTimer(endCallRetry);
    sendJson(client, { type: "complete" });
    // Give the browser a beat to receive it before we drop Deepgram.
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
}

// Loose text match so a reformatted echo of our injected trigger still matches.
function normalizeText(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clearTimer(t, isInterval = false) {
  if (!t) return;
  if (isInterval) clearInterval(t);
  else clearTimeout(t);
}

function buildSettings({ type, user }) {
  const { voice, llm } = config;
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
      think: {
        provider: { type: llm.type, model: llm.model, temperature: llm.temperature },
        prompt: buildInstructions({ type, user }),
        functions: FUNCTION_DEFS,
      },
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

async function seedSeq(interviewId) {
  const { rows } = await query(
    `SELECT COALESCE(MAX(seq), 0) AS max FROM turns WHERE interview_id = $1`,
    [interviewId]
  );
  return Number(rows[0].max);
}
