import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, voiceWsUrl } from "../api.js";
import { useAuth } from "../auth.jsx";
import { MicRecorder } from "../audio/recorder.js";
import { PcmPlayer } from "../audio/player.js";
import { playInterviewSound } from "../audio/sfx.js";
import { typeMeta } from "../interviewTypes.jsx";
import VoiceOrb from "../components/VoiceOrb.jsx";
import "../styles/orb.css";
import "../styles/room.css";

const JD_MAX_CHARS = 2000;

// phase: lobby -> connecting -> live -> ended
//                       \-> failed (connection died before the call started)
export default function InterviewRoom() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [interview, setInterview] = useState(null);
  const [jd, setJd] = useState("");
  const [jdOpen, setJdOpen] = useState(false);
  const [phase, setPhase] = useState("lobby");
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);

  const wsRef = useRef(null);
  const recorderRef = useRef(null);
  const playerRef = useRef(null);
  const endedRef = useRef(false);
  const everLiveRef = useRef(false);
  const transcriptRef = useRef([]);
  const blobRef = useRef(null);
  const rafRef = useRef(0);
  const panelRef = useRef(null);

  const meta = typeMeta(interview?.type);

  // Load the interview so the room knows its type; completed ones go straight
  // to their report.
  useEffect(() => {
    api
      .getInterview(id)
      .then((d) => {
        // Completed sessions go to their report. Abandoned ones can't be
        // resumed either (the interviewer has no memory of the dropped call),
        // so send them to the report too — it renders gracefully from
        // whatever partial transcript/assessments exist.
        if (d.interview.status === "completed" || d.interview.status === "abandoned") {
          navigate(`/interview/${id}/report`, { replace: true });
        } else {
          setInterview(d.interview);
          if (d.interview.jdText) {
            setJd(d.interview.jdText);
            setJdOpen(true);
          }
        }
      })
      .catch((e) => {
        setError(e.message);
        setPhase("failed");
      });
  }, [id]);

  // Session timer.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Drive the voice blob from the agent's REAL output level, and derive
  // "is the interviewer talking" from actual client playback — not the server's
  // done-streaming signal, which fires seconds before the buffered audio ends.
  // This is what gates the candidate's mic, so it must track what they hear.
  useEffect(() => {
    if (phase !== "live" && phase !== "connecting") return;
    let agentOn = false;
    let lastActive = 0;
    const tick = () => {
      const player = playerRef.current;
      const agentLevel = player?.getLevel() ?? 0;
      if (blobRef.current) {
        blobRef.current.style.setProperty("--level", Math.min(1, agentLevel * 2.6).toFixed(3));
      }
      const now = performance.now();
      if (player?.isActive()) lastActive = now;
      const speaking = now - lastActive < 220; // brief hangover bridges buffer gaps
      if (speaking !== agentOn) {
        agentOn = speaking;
        setAgentSpeaking(speaking);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase]);

  // Keep the transcript panel pinned to the newest line.
  useEffect(() => {
    const el = panelRef.current;
    if (el && showTranscript) el.scrollTop = el.scrollHeight;
  }, [transcript, showTranscript]);

  // The candidate's mic is only live on their turn: it's auto-silenced the
  // instant the interviewer starts talking, and restored when the interviewer
  // finishes (unless the candidate manually muted). The only way to talk over
  // the interviewer is the explicit "tap to interrupt" barge-in below.
  useEffect(() => {
    const live = phase === "live" && !muted && !agentSpeaking;
    recorderRef.current?.setMuted(!live);
  }, [phase, muted, agentSpeaking]);

  useEffect(() => () => teardown(), []);

  async function begin() {
    setError("");
    setPhase("connecting");
    endedRef.current = false;

    // Persist the (optional) job description before the voice socket opens, so
    // the server reads it into the interviewer's prompt on connect.
    try {
      if (jd.trim() !== (interview?.jdText || "")) {
        await api.setInterviewJd(id, jd.trim());
      }
    } catch {
      /* non-fatal: the interview still runs, just untailored to the JD */
    }

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
      setError("Microphone access is required. Allow it in your browser and try again.");
      setPhase("lobby");
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
    ws.onerror = () => {
      if (!everLiveRef.current) failConnection("Couldn't reach the voice service.");
    };
    ws.onclose = () => {
      if (endedRef.current) return;
      // A close before the call ever went live is a failure, not a finished
      // interview — don't dump the candidate onto an empty report.
      if (!everLiveRef.current && transcriptRef.current.length === 0) {
        failConnection("The voice connection closed before the interview could start.");
      } else {
        endInterview();
      }
    };
  }

  function handleEvent(msg) {
    switch (msg.type) {
      case "ready":
        everLiveRef.current = true;
        setPhase("live");
        playInterviewSound(meta, "start"); // per-type "interview begins" chime
        break;
      case "transcript":
        // Deepgram emits one ConversationText per spoken segment (usually a
        // sentence), so a single turn arrives as several events. Merge
        // consecutive segments from the same speaker into one growing entry.
        setTranscript((t) => {
          const last = t[t.length - 1];
          const next =
            last && last.role === msg.role
              ? [...t.slice(0, -1), { ...last, content: `${last.content} ${msg.content}`.trim() }]
              : [...t, { role: msg.role, content: msg.content }];
          transcriptRef.current = next;
          return next;
        });
        break;
      case "state":
        // `agentSpeaking` is derived from real client playback in the RAF loop
        // (the server's agent_speaking/agent_done fire relative to streaming,
        // not playback). Here we only honor a server-side barge-in.
        if (msg.value === "user_speaking") playerRef.current?.interrupt();
        break;
      case "error":
        if (!everLiveRef.current) failConnection(msg.message || "Voice service error.");
        else setError(msg.message || "Something went wrong.");
        break;
      case "complete":
        // The interviewer wrapped up on its own (or hit the time cap). Let its
        // closing line finish, then go to the report — no button press needed.
        gracefulEnd();
        break;
      case "closed":
        if (endedRef.current) break;
        if (!everLiveRef.current && transcriptRef.current.length === 0) {
          failConnection("The voice connection closed before the interview could start.");
        } else {
          endInterview();
        }
        break;
      default:
        break;
    }
  }

  function failConnection(message) {
    if (endedRef.current) return;
    endedRef.current = true;
    teardown();
    setError(message);
    setPhase("failed");
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
    playInterviewSound(meta, "end"); // per-type "interview complete" chime
    try {
      await api.finishInterview(id);
    } catch {
      /* report route will still render */
    }
    navigate(`/interview/${id}/report`);
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
    playInterviewSound(meta, "end"); // per-type "interview complete" chime

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

  // The mic button does one of two jobs depending on whose turn it is:
  //  • interviewer talking → "tap to interrupt": cut its audio and hand the
  //    floor back to the candidate (also clears any manual mute).
  //  • candidate's turn → normal mute / unmute toggle.
  // The recorder's actual muted state is reconciled by the effect above.
  function onMicClick() {
    if (agentSpeaking) {
      playerRef.current?.interrupt();
      setAgentSpeaking(false);
      if (muted) setMuted(false);
    } else {
      setMuted((m) => !m);
    }
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const lastTurn = transcript[transcript.length - 1];
  const jdLen = jd.length;
  // Mic is "live" whenever it's the candidate's turn — the interviewer isn't
  // talking and they haven't manually muted. Drives the on-air chip.
  const micLive = phase === "live" && !muted && !agentSpeaking;

  // ── Lobby / failed ──────────────────────────────────────────────────────
  if (phase === "lobby" || phase === "failed") {
    return (
      <div className="lobby">
        <div className="lobby-card fade-up">
          <VoiceOrb meta={meta} variant="lobby" />
          <h1>{meta.label} interview</h1>
          <p className="with">
            with {meta.interviewer} · AI interviewer · ~10 minutes · voice only
          </p>
          <ul className="lobby-tips">
            <li>Find a quiet spot — headphones help a lot.</li>
            <li>Just talk naturally. The interviewer listens and follows up on what you say.</li>
            <li>Your mic mutes while the interviewer speaks — tap the mic to interrupt and jump in.</li>
            <li>End whenever you like — your feedback report is generated either way.</li>
          </ul>

          <div className="lobby-setup">
            <div className={`setup-status ${user?.hasResume ? "on" : ""}`}>
              <span className="dot" />
              {user?.hasResume ? (
                <span>
                  Personalized from your resume. The interviewer will reference your real work.
                </span>
              ) : (
                <span>
                  No resume on file — add one from the dashboard for questions tailored to your
                  experience.
                </span>
              )}
            </div>

            {jdOpen ? (
              <div className="jd-field">
                <label htmlFor="jd">Tailor to a job description (optional)</label>
                <textarea
                  id="jd"
                  value={jd}
                  onChange={(e) => setJd(e.target.value)}
                  placeholder="Paste the job description you're targeting."
                  rows={5}
                  maxLength={JD_MAX_CHARS}
                />
                <div className="jd-foot">
                  <span className="subtle small">
                    {jdLen.toLocaleString()} / {JD_MAX_CHARS.toLocaleString()}
                  </span>
                </div>
              </div>
            ) : (
              <button type="button" className="jd-toggle" onClick={() => setJdOpen(true)}>
                + Tailor to a job description
              </button>
            )}
          </div>

          {error && <div className="lobby-error">{error}</div>}
          <button className="btn primary big block" onClick={begin} disabled={!interview}>
            {interview ? "Join interview" : "Loading…"}
          </button>
          <button className="btn ghost block" onClick={() => navigate("/")}>
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  // ── Live stage ──────────────────────────────────────────────────────────
  return (
    <div className={`room ${agentSpeaking ? "speaking" : "listening"} ${phase}`}>
      <header className="room-top">
        <div className="left">
          <span className="room-pill">
            <span className="rec-dot" />
            {meta.label}
          </span>
        </div>
        <div className="right">
          <span className="room-pill room-timer">
            {phase === "connecting" ? "Connecting…" : mmss}
          </span>
        </div>
      </header>

      <main className="room-stage">
        <VoiceOrb meta={meta} ref={blobRef} />

        <div className="stage-id">
          <div className="name">{meta.interviewer}</div>
          <div className="status">
            {phase === "connecting" ? "Setting up your interview…" : agentSpeaking ? "Speaking…" : ""}
          </div>
        </div>

        <div className={`speaking-chip ${micLive ? "on" : ""}`}>
          <span className="eq">
            <i />
            <i />
            <i />
          </span>
          You're speaking
        </div>
      </main>

      <div className="captions">
        {showCaptions && lastTurn && (
          <div className={`caption-bubble ${lastTurn.role}`} key={transcript.length}>
            <span className="speaker">
              {lastTurn.role === "assistant" ? meta.interviewer : "You"}
            </span>
            <CaptionText text={lastTurn.content} />
          </div>
        )}
      </div>

      <footer className="room-controls">
        <span className="ctl-wrap">
          <button
            className={`ctl mic ${agentSpeaking || muted ? "muted" : ""}`}
            onClick={onMicClick}
            aria-label={
              agentSpeaking
                ? "Tap to interrupt the interviewer"
                : muted
                  ? "Unmute microphone"
                  : "Mute microphone"
            }
          >
            {agentSpeaking || muted ? <MicOffIcon /> : <MicIcon />}
          </button>
          <span className="ctl-label">
            {agentSpeaking ? "Tap to interrupt" : muted ? "Unmute" : "Mute"}
          </span>
        </span>

        <span className="ctl-wrap">
          <button
            className={`ctl ${showCaptions ? "active" : ""}`}
            onClick={() => setShowCaptions((v) => !v)}
            aria-label="Toggle captions"
          >
            <CaptionsIcon />
          </button>
          <span className="ctl-label">Captions</span>
        </span>

        <span className="ctl-wrap">
          <button
            className="ctl end"
            onClick={endInterview}
            disabled={phase === "ended"}
            aria-label="End interview"
          >
            <EndCallIcon />
          </button>
          <span className="ctl-label">End interview</span>
        </span>

        <span className="ctl-wrap">
          <button
            className={`ctl ${showTranscript ? "active" : ""}`}
            onClick={() => setShowTranscript((v) => !v)}
            aria-label="Toggle transcript"
          >
            <TranscriptIcon />
          </button>
          <span className="ctl-label">Transcript</span>
        </span>
      </footer>

      <aside className={`transcript-panel ${showTranscript ? "open" : ""}`}>
        <div className="transcript-head">
          Transcript
          <button onClick={() => setShowTranscript(false)} aria-label="Close transcript">
            ×
          </button>
        </div>
        <div className="transcript-body" ref={panelRef}>
          {transcript.length === 0 && (
            <p className="t-line">
              <span className="t-text" style={{ color: "var(--stage-text-2)" }}>
                The conversation will appear here.
              </span>
            </p>
          )}
          {transcript.map((t, i) => (
            <div key={i} className={`t-line ${t.role}`}>
              <span className="t-who">{t.role === "assistant" ? meta.interviewer : "You"}</span>
              <div className="t-text">{t.content}</div>
            </div>
          ))}
        </div>
      </aside>

      {phase === "ended" && (
        <div className="room-ended">
          <div className="panel">
            <div className="spinner" />
            Wrapping up and writing your feedback report…
          </div>
        </div>
      )}

      {error && phase === "live" && <div className="lobby-error">{error}</div>}
    </div>
  );
}

// Reveals new words with a fade as segments stream in, so captions read like
// live speech instead of popping in as whole sentences. Deepgram sends
// finalized text per segment; this animates the growing tail only.
function CaptionText({ text }) {
  const tokens = text.match(/\S+\s*/g) || [];
  const [shown, setShown] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setShown((s) => {
        const step = 1 + Math.round(Math.random());
        const next = Math.min(tokens.length, s + step);
        if (next >= tokens.length) clearInterval(timerRef.current);
        return next;
      });
    }, 80);
    return () => clearInterval(timerRef.current);
  }, [text]);

  return (
    <span className="caption-text">
      {tokens.slice(0, shown).map((tok, i) => (
        <span key={i} className="tok">
          {tok}
        </span>
      ))}
    </span>
  );
}

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="7" y="2" width="6" height="10" rx="3" fill="currentColor" />
      <path
        d="M4.5 9.5a.9.9 0 0 1 1.8 0 3.7 3.7 0 0 0 7.4 0 .9.9 0 0 1 1.8 0 5.5 5.5 0 0 1-4.6 5.4V17a.9.9 0 0 1-1.8 0v-2.1A5.5 5.5 0 0 1 4.5 9.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M13 8.6V5a3 3 0 0 0-5.7-1.3L13 9.4v-.8ZM7 8.4l6 6a3 3 0 0 1-6-.4V8.4Z"
        fill="currentColor"
      />
      <path
        d="M4.5 9.5a.9.9 0 0 1 1.8 0 3.7 3.7 0 0 0 5.9 3l1.3 1.3a5.5 5.5 0 0 1-2.6 1.1V17a.9.9 0 0 1-1.8 0v-2.1A5.5 5.5 0 0 1 4.5 9.5Zm10.2 1.9-1.4-1.4c.2-.5.4-1 .4-1.5a.9.9 0 0 1 1.8 0c0 1-.3 2-.8 2.9Z"
        fill="currentColor"
      />
      <rect
        x="2.2"
        y="3.5"
        width="1.9"
        height="20"
        rx="0.95"
        transform="rotate(-45 2.2 3.5)"
        fill="currentColor"
      />
    </svg>
  );
}

function CaptionsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 4.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 14V6A1.5 1.5 0 0 1 3 4.5Zm1.5 6.8c0 1.5 1.1 2.5 2.6 2.5.8 0 1.5-.3 2-.8l-1-1c-.2.3-.5.4-.9.4-.7 0-1.2-.5-1.2-1.2s.5-1.2 1.2-1.2c.4 0 .7.1.9.4l1-1a2.7 2.7 0 0 0-2-.8c-1.5 0-2.6 1-2.6 2.7Zm6 0c0 1.5 1.1 2.5 2.6 2.5.8 0 1.5-.3 2-.8l-1-1c-.2.3-.5.4-.9.4-.7 0-1.2-.5-1.2-1.2s.5-1.2 1.2-1.2c.4 0 .7.1.9.4l1-1a2.7 2.7 0 0 0-2-.8c-1.5 0-2.6 1-2.6 2.7Z"
        fill="currentColor"
      />
    </svg>
  );
}

function TranscriptIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4 3.5h12a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Zm2.5 3.5a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5h-7Zm0 3a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5h-7Zm0 3a.75.75 0 0 0 0 1.5h4a.75.75 0 0 0 0-1.5h-4Z"
        fill="currentColor"
      />
    </svg>
  );
}

function EndCallIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path
        d="M11 8.5c-3.6 0-6.8 1.3-9 3.4-.5.5-.6 1.3-.2 1.9l1.2 1.8c.4.6 1.1.8 1.7.5l2.5-1.1c.5-.2.9-.8.9-1.4v-1.3c1.9-.5 3.9-.5 5.8 0v1.3c0 .6.4 1.2.9 1.4l2.5 1.1c.6.3 1.3 0 1.7-.5l1.2-1.8c.4-.6.3-1.4-.2-1.9-2.2-2.1-5.4-3.4-9-3.4Z"
        fill="currentColor"
      />
    </svg>
  );
}
