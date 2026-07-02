import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, voiceWsUrl } from "../api.js";
import { MicRecorder } from "../audio/recorder.js";
import { PcmPlayer } from "../audio/player.js";

export default function InterviewRoom() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [phase, setPhase] = useState("idle"); // idle | connecting | live | ended
  const [agentState, setAgentState] = useState("listening"); // listening | speaking
  const [transcript, setTranscript] = useState([]);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);

  const wsRef = useRef(null);
  const recorderRef = useRef(null);
  const playerRef = useRef(null);
  const endedRef = useRef(false);
  const scrollRef = useRef(null);
  const stickRef = useRef(true); // whether to keep pinned to the newest line

  // Pin to the bottom, but only while the user hasn't scrolled up to re-read.
  function scrollToBottom() {
    if (!stickRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  function onCaptionsScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  // Timer while live.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Follow new turns. Streaming reveal keeps growing the last bubble after this
  // fires, so StreamingText also calls scrollToBottom on each reveal tick.
  useEffect(() => {
    scrollToBottom();
  }, [transcript]);

  // Tear down on unmount.
  useEffect(() => () => teardown(), []);

  async function begin() {
    setError("");
    setPhase("connecting");
    endedRef.current = false;

    const player = new PcmPlayer();
    playerRef.current = player;

    const recorder = new MicRecorder();
    try {
      await recorder.start((chunk) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(chunk);
      });
      recorderRef.current = recorder;
    } catch {
      setError("Microphone access is required. Please allow it and try again.");
      setPhase("idle");
      return;
    }

    const ws = new WebSocket(voiceWsUrl(id));
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") {
        playerRef.current?.enqueue(event.data);
        return;
      }
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      handleEvent(msg);
    };
    ws.onerror = () => setError("Connection error.");
    ws.onclose = () => {
      if (!endedRef.current) endInterview();
    };
  }

  function handleEvent(msg) {
    switch (msg.type) {
      case "ready":
        setPhase("live");
        break;
      case "transcript":
        // Deepgram emits one ConversationText per spoken segment (usually a
        // sentence), so a single interviewer turn arrives as several events and
        // used to render as several separate blocks. Merge consecutive segments
        // from the same speaker into one growing bubble; the StreamingText
        // component reveals the appended tail so it reads as live typing.
        setTranscript((t) => {
          const last = t[t.length - 1];
          if (last && last.role === msg.role) {
            const merged = { ...last, content: `${last.content} ${msg.content}`.trim() };
            return [...t.slice(0, -1), merged];
          }
          return [...t, { role: msg.role, content: msg.content }];
        });
        break;
      case "state":
        if (msg.value === "agent_speaking") setAgentState("speaking");
        else if (msg.value === "user_speaking") {
          playerRef.current?.interrupt(); // barge-in
          setAgentState("listening");
        } else if (msg.value === "agent_done") setAgentState("listening");
        break;
      case "error":
        setError(msg.message || "Something went wrong.");
        break;
      case "complete":
        // The interviewer wrapped up on its own (or hit the time cap). Let its
        // closing line finish, then go to the report — no button press needed.
        gracefulEnd();
        break;
      case "closed":
        endInterview();
        break;
      default:
        break;
    }
  }

  // Interviewer-initiated close: stop the mic immediately, let the buffered
  // closing audio play out, then finalize and navigate to the report.
  async function gracefulEnd() {
    if (endedRef.current) return;
    endedRef.current = true;
    setPhase("ended");
    recorderRef.current?.stop(); // stop capturing; keep the player alive to drain
    await new Promise((r) => setTimeout(r, 2200));
    teardown();
    try {
      await api.finishInterview(id);
    } catch {
      /* report route will still render */
    }
    navigate(`/interview/${id}/report`);
  }

  function teardown() {
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    recorderRef.current?.stop();
    playerRef.current?.close();
    wsRef.current = null;
  }

  async function endInterview() {
    if (endedRef.current) return;
    endedRef.current = true;
    setPhase("ended");

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "end" }));
      } catch {
        /* ignore */
      }
    }
    teardown();

    try {
      await api.finishInterview(id);
    } catch {
      /* report route will still render */
    }
    navigate(`/interview/${id}/report`);
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div className="room">
      {phase === "idle" && (
        <div className="card room-start">
          <h1>Behavioral interview</h1>
          <p className="muted">
            This is a spoken conversation. Your AI interviewer will greet you and start asking
            questions — just answer out loud, like a real interview. You can interrupt it any time.
          </p>
          <ul className="muted small tips">
            <li>Find a quiet spot and use headphones if you can.</li>
            <li>Speak naturally; the interviewer follows up on what you say.</li>
            <li>Click “End interview” whenever you’re done to get your report.</li>
          </ul>
          {error && <div className="error">{error}</div>}
          <button className="btn primary big" onClick={begin}>
            Allow mic &amp; start
          </button>
        </div>
      )}

      {(phase === "connecting" || phase === "live" || phase === "ended") && (
        <div className="stage">
          <div className="stage-top">
            <span className="tag">Behavioral</span>
            {phase === "live" && <span className="timer">{mmss}</span>}
            {phase === "connecting" && <span className="muted">Connecting…</span>}
          </div>

          <div className={`orb ${agentState}`}>
            <div className="orb-core" />
            <div className="orb-label">
              {phase === "connecting"
                ? "Connecting…"
                : agentState === "speaking"
                  ? "Interviewer speaking"
                  : "Listening…"}
            </div>
          </div>

          <div className="captions" ref={scrollRef} onScroll={onCaptionsScroll}>
            {transcript.length === 0 && phase === "live" && (
              <p className="muted center">The interviewer will begin shortly…</p>
            )}
            {transcript.map((turn, i) => (
              <div key={i} className={`caption ${turn.role}`}>
                <span className="who">{turn.role === "assistant" ? "Interviewer" : "You"}</span>
                <StreamingText
                  text={turn.content}
                  animate={true}
                  onReveal={scrollToBottom}
                />
              </div>
            ))}
          </div>

          {error && <div className="error">{error}</div>}

          <button
            className="btn danger"
            onClick={endInterview}
            disabled={phase === "ended"}
          >
            {phase === "ended" ? "Wrapping up…" : "End interview"}
          </button>
        </div>
      )}
    </div>
  );
}

// Reveals text a word-chunk at a time so an interviewer turn reads like an LLM
// streaming tokens — bursts of a couple words, each fading in — rather than a
// mechanical character-by-character typewriter. Note: Deepgram's Voice Agent
// sends finalized text per segment (not token-by-token), so this is a
// client-side reveal, not true token streaming — but it gives the same feel and
// stays roughly in sync with the spoken audio. When the bubble's text grows
// (more segments merged in), we keep revealing from where we left off. Both
// speakers animate so a recognized user sentence streams in word-by-word too,
// instead of the whole STT segment appearing at once.
function StreamingText({ text, animate, onReveal }) {
  // Split into tokens that each keep their trailing whitespace, so joining a
  // prefix of them reconstructs the text exactly (no lost/added spaces).
  const tokens = text.match(/\S+\s*/g) || [];
  const [shown, setShown] = useState(animate ? 0 : tokens.length);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!animate) {
      setShown(tokens.length);
      onReveal?.();
      return;
    }
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setShown((s) => {
        // Reveal 1–2 words per tick so the cadence feels organic, not metronomic.
        const step = 1 + Math.round(Math.random());
        const next = Math.min(tokens.length, s + step);
        if (next >= tokens.length) clearInterval(timerRef.current);
        return next;
      });
      // Keep the growing bubble in view as it types out.
      onReveal?.();
    }, 90);
    return () => clearInterval(timerRef.current);
  }, [text, animate]);

  const streaming = animate && shown < tokens.length;
  return (
    <span className="what">
      {tokens.slice(0, shown).map((tok, i) => (
        <span key={i} className="tok">
          {tok}
        </span>
      ))}
      {streaming && <span className="caret" />}
    </span>
  );
}
