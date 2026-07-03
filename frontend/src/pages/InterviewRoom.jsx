import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Mic, MicOff, Captions, ScrollText, PhoneOff } from "lucide-react";
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

  useEffect(() => {
    api
      .getInterview(id)
      .then((d) => {
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

  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

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
      const speaking = now - lastActive < 220;
      if (speaking !== agentOn) {
        agentOn = speaking;
        setAgentSpeaking(speaking);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase]);

  useEffect(() => {
    const el = panelRef.current;
    if (el && showTranscript) el.scrollTop = el.scrollHeight;
  }, [transcript, showTranscript]);

  useEffect(() => {
    const live = phase === "live" && !muted && !agentSpeaking;
    recorderRef.current?.setMuted(!live);
  }, [phase, muted, agentSpeaking]);

  useEffect(() => () => teardown(), []);

  async function begin() {
    setError("");
    setPhase("connecting");
    endedRef.current = false;

    try {
      if (jd.trim() !== (interview?.jdText || "")) {
        await api.setInterviewJd(id, jd.trim());
      }
    } catch {}

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
        playInterviewSound(meta, "start");
        break;
      case "transcript":
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
        if (msg.value === "user_speaking") playerRef.current?.interrupt();
        break;
      case "error":
        if (!everLiveRef.current) failConnection(msg.message || "Voice service error.");
        else setError(msg.message || "Something went wrong.");
        break;
      case "complete":
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

  async function gracefulEnd() {
    if (endedRef.current) return;
    endedRef.current = true;
    setPhase("ended");
    recorderRef.current?.stop();
    await new Promise((r) => setTimeout(r, 2200));
    teardown();
    playInterviewSound(meta, "end");
    try {
      await api.finishInterview(id);
    } catch {}
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
      } catch {}
    }
    teardown();
    playInterviewSound(meta, "end");

    try {
      await api.finishInterview(id);
    } catch {}
    navigate(`/interview/${id}/report`);
  }

  function teardown() {
    try {
      wsRef.current?.close();
    } catch {}
    recorderRef.current?.stop();
    playerRef.current?.close();
    wsRef.current = null;
  }

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
  const micLive = phase === "live" && !muted && !agentSpeaking;

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
            {agentSpeaking || muted ? <MicOff size={20} /> : <Mic size={20} />}
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
            <Captions size={20} />
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
            <PhoneOff size={22} />
          </button>
          <span className="ctl-label">End interview</span>
        </span>

        <span className="ctl-wrap">
          <button
            className={`ctl ${showTranscript ? "active" : ""}`}
            onClick={() => setShowTranscript((v) => !v)}
            aria-label="Toggle transcript"
          >
            <ScrollText size={20} />
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
