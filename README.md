# 🎙️ Voice Mock Interview Platform

A full-stack platform where candidates have a **real, dynamic voice conversation** with an AI
interviewer. It listens to what you actually say, follows up on vague answers, pushes back on weak
ones, acknowledges strong ones, and decides what to ask next from the **full conversation context** —
there is no question bank and no text chat.

One interview type is built end-to-end and properly: **Behavioral**.

---

## Setup (5 commands)

**Prerequisites:** Node ≥ 20, Docker, a [Deepgram API key](https://console.deepgram.com/) (free credit
on signup), and a [Groq API key](https://console.groq.com/keys) (free tier — powers the interview
director and the feedback generator; the app still runs without it, just less adaptively — see below).

```bash
cp backend/.env.example backend/.env   # 1. paste DEEPGRAM_API_KEY, GROQ_API_KEY, JWT_SECRET
docker compose up -d                   # 2. start PostgreSQL
(cd backend && npm install && npm run db:migrate)   # 3. install + push Prisma schema
(cd frontend && npm install)           # 4. install the client
(cd backend && npm run dev &) && (cd frontend && npm run dev)   # 5. Express (:3000) + Vite (:5173)
```

Open **http://localhost:5173**, sign up, and start a behavioral interview. Use headphones to avoid
echo. That's the whole thing.

> Two external AI credentials: `DEEPGRAM_API_KEY` (hard requirement — this is the entire voice layer,
> nothing works without it) and `GROQ_API_KEY` (soft requirement — the adaptive director and the
> feedback report degrade to heuristics if it's missing, they don't crash). No OpenAI/Anthropic key
> is used directly; Deepgram brokers Claude on our behalf for speech (see below).

---

## The core loop (what makes it feel real)

```
 Browser (mic)  ──PCM16 16kHz──►  Express proxy  ──►  Deepgram Voice Agent
                                       │                 ├─ STT (Nova-3)
 Browser (audio) ◄──PCM16 24kHz──  Express proxy  ◄──    ├─ LLM  (managed Claude — voice/delivery)
                                       │                 └─ TTS (Aura-2)
                                       │
                                       └──►  LangGraph director (Groq gpt-oss-120b) ──► "next move"
                              persists turns + assessments, feeds the director's decision back in
```

There are two brains, each doing a different job:

- **Deepgram-managed Claude** handles the actual *speaking* — turn-taking, barge-in, and voicing
  whatever it's told to say next. This is the part that makes it sound and flow like a real call.
- **A LangGraph state machine** (`backend/src/langGraph/`) decides *what the next move is*. After
  every answer, a graph run does `evaluateAnswer → adjustDifficulty → decideRoute → generateQuestion
  | finalFeedback`. The routing is adaptive: a vague/weak answer routes to a follow-up node, a strong
  one raises difficulty and moves to a new topic, and running coverage/elapsed-time routes to a
  natural wrap-up. Session state (transcript, running scores, streaks, resume/JD context, timing) is
  held in a `MemorySaver` checkpoint keyed per interview, so the graph always reasons over the whole
  conversation — never a single turn in isolation.
- The proxy wires them together: the director's decision is pushed into the live call via Deepgram's
  `UpdatePrompt`, and Claude voices it on its next turn. Feature-flagged (`GRAPH_DRIVEN`, default on);
  turning it off falls back to a single autonomous Deepgram prompt with no external director.

This directly implements the brief's LangGraph bonus (adaptive branching, specialized nodes,
persistent state) rather than skipping it — see [Key decisions](#key-decisions--trade-offs) for why
this needed a second, non-Deepgram-managed model.

**Processing each answer before deciding what's next** is also explicit at the Deepgram layer via two
LLM tools registered in Settings:

- `record_assessment(competency, score, note)` — logged after each substantive answer;
- `submit_evaluation(...)` — called once at the close for a first-pass structured wrap-up.

Both are handled server-side (`backend/src/services/functionHandlers.js`) so speech is never
interrupted. The **final** report, though, is generated separately: once an interview ends, the full
transcript + assessments are sent to Groq (`transcriptEvaluator.js`) for a proper structured
evaluation (score, verdict, star rating, per-competency breakdown, strengths, growth areas, priorities,
timeline). If Groq isn't configured, or a session ends abruptly, a fallback aggregates the live
`record_assessment` notes so the report is never empty.

### How an interview ends

Three ways, so it always terminates cleanly (and never runs away on time or cost):

1. **The candidate ends it** — the *End interview* button, available any time.
2. **The interviewer wraps up on its own** — the director routes to `finalFeedback` once coverage/time
   targets are hit and closes naturally. The proxy waits for the closing line to finish, then pushes
   `{type:"complete"}` so the browser auto-navigates to the report.
3. **Server-side guardrails** — at a soft limit (`SOFT_WRAP_MS`, default ~7 min) the proxy nudges the
   agent to close; if it stalls, a post-nudge escalation and a hard cap (`MAX_DURATION_MS`, default
   ~11 min) force a graceful end regardless. The report then uses the assessment-based fallback.

### Why an Express proxy instead of connecting the browser straight to Deepgram

- The Deepgram key stays **server-side**.
- Every `ConversationText` turn is **persisted** to Postgres as it happens.
- The interviewer prompt, tools, and the director's steering are **controlled** centrally.

---

## Key decisions & trade-offs

| Decision | Why |
|---|---|
| **Deepgram Voice Agent** for the whole voice layer | One WebSocket handles STT + LLM + TTS with native barge-in and turn-taking — far less glue and latency than wiring three services together. Managed service, no self-hosted models. |
| **LangGraph director on Groq, separate from Deepgram's managed voice LLM** | Deepgram's `think.provider` only accepts models *it* manages, so it can't be intercepted to run custom graph logic mid-call. To actually get adaptive branching (the brief's bonus) rather than simulate it in one big prompt, the director runs as its own LangGraph app on Groq and steers Deepgram's Claude via `UpdatePrompt`. This is the one deliberate departure from "single LLM credential" — traded for a real, inspectable decision graph instead of a monolithic prompt. Feature-flagged and degrades to heuristic fallbacks with no key, so a missing `GROQ_API_KEY` never breaks the call. |
| **Prisma 6** over raw `pg` | Schema-as-code (`backend/prisma/schema.prisma`) with typed queries and `db push`/migrate workflows, instead of hand-written SQL + a migration runner. |
| **Express proxy** over direct browser→Deepgram | API key stays server-side, every turn is persisted, prompt/tooling is controlled. |
| **linear16 PCM** both directions | Trivial browser capture (AudioWorklet) and gapless playback (AudioContext), no codec handling. Costs a little bandwidth — negligible locally. |
| **Raw `ws`** to Deepgram inside the proxy (not the SDK's socket wrapper) | The v5 SDK's agent socket JSON-parses every frame, which breaks on binary TTS audio in Node. Raw `ws` gives clean control over binary vs. text frames for the relay. |

---

## Cost analysis (third-party AI services)

Deepgram Voice Agent is usage-based; the LangGraph director and final report add a second, separate
LLM bill on Groq.

**Estimate for one ~10-minute behavioral interview:**

| Component | Assumption | Cost |
|---|---|---|
| Deepgram Voice Agent (STT + managed Claude + TTS) | 10 min @ ~$0.075–0.15/min, all-in | ~$0.75 – $1.50 |
| LangGraph director (Groq `gpt-oss-120b`) | ~8–9 graph runs, small growing context per run, Groq's per-token rate is a fraction of frontier-model pricing | ~$0.01 – $0.03 |
| Final report generation (Groq, one call) | Full transcript + assessments in, structured JSON out | ~$0.01 |
| **Total per interview** | | **≈ $0.80 – $1.55** |

**Levers to reduce cost:** switch the Deepgram-managed voice model to a cheaper tier, cap interview
length in the prompt/graph, and trim `record_assessment` frequency. Groq's director/report cost is
close to negligible next to the voice layer, so most savings live in the Deepgram side. At under
$2/interview, unit economics are viable for a freemium practice product. Figures are estimates —
confirm against the [Deepgram](https://deepgram.com/pricing) and [Groq](https://groq.com/pricing/)
pricing pages for your tier.

---

## Tech stack

- **Frontend:** React (Vite), React Router, Web Audio API (AudioWorklet capture + streaming playback).
- **Backend:** Node.js + Express, `ws` for the voice WebSocket proxy.
- **Database:** PostgreSQL via Prisma 6 (`backend/prisma/schema.prisma`).
- **Auth:** email + password, bcrypt hashing, JWT (no OAuth). Candidates self-sign-up.
- **Voice/AI:** Deepgram Voice Agent API (Nova-3 STT · managed Claude · Aura-2 TTS) for the live call;
  LangGraph + Groq (`gpt-oss-120b`) for the adaptive director and final feedback report.

## Project structure

```
backend/
  prisma/                       Prisma 6 schema (users, interviews, transcriptions, assessments, feedback)
  src/config/config.js          env + model config
  src/data/prisma.js            Prisma client + persistence functions
  src/server.js                 Express app + WS upgrade auth
  src/controllers/              auth + interview request handlers
  src/routes/                   authRoutes.js, interviewRoutes.js
  src/middleware/verifyToken.js JWT guard
  src/domain/interviewTypes.js  per-type persona/rubric config
  src/prompts/interviewer.js    interviewer system prompt + Deepgram tool schemas
  src/langGraph/                director graph: state.js, nodes.js, interviewGraph.js, orchestrator.js
  src/services/voiceProxy.js    browser ↔ Deepgram relay + turn persistence + director wiring
  src/services/functionHandlers.js   record_assessment / submit_evaluation handlers
  src/services/transcriptEvaluator.js   Groq-based final report generation
  src/services/reportService.js fallback report aggregation
frontend/src
  pages/                        Signup, Login, Dashboard, InterviewRoom, Report
  audio/                        recorder.js (mic→PCM16), player.js (streaming playback)
  public/pcm-recorder-worklet.js   resample + PCM16 encode in an AudioWorklet
```

## Demo script (for the walkthrough / Loom)

1. **Sign up** with a name, target role, and experience level → land on the dashboard.
2. **Start a Behavioral interview**; the interviewer greets you and asks the first question.
3. Give a **deliberately vague** answer → notice it **follows up / probes** instead of moving on.
4. Give a **strong, specific** answer with a real result → notice it **acknowledges and advances**
   (and raises difficulty).
5. **Interrupt** it mid-sentence → it yields (barge-in).
6. Click **End interview** → the **report** shows an overall score, star rating, per-competency
   review, strengths/growth areas, and the full transcript. It also appears under **Past sessions**.

## Notes & limitations

- Requires a browser with microphone access; use headphones to avoid echo bleed.
- Only the **Behavioral** type is enabled; the picker shows the other three as "coming soon," and the
  prompt/rubric config (`domain/interviewTypes.js`) is type-parameterized so adding one is
  data + prompt work, not a rewrite.
- Without `GROQ_API_KEY`: the director falls back to simpler heuristic routing and the final report
  falls back to assessment aggregation — the interview still runs and produces a report, just less
  adaptively/richly.
