# InterviewLab

Voice-only AI mock interview platform. You talk, an AI interviewer listens and responds in real time (native barge-in, no push-to-talk), and afterward you get a scored report with per-question review.

> Screenshot: _add a screenshot of the interview room / report page here._

## Features

- **Real-time voice interview** over a single WebSocket — no separate STT/LLM/TTS round trips, low-latency native barge-in.
- **Adaptive interview brain** (LangGraph) that scores each answer, adjusts difficulty, and decides the next question/topic/wrap-up live — with heuristic fallbacks if no LLM key is configured.
- **Resume + JD personalization** — paste your resume once (reused across interviews) and a job description per interview; both feed the interviewer's prompt and the final gap analysis.
- **Graceful call ending** — soft nudge → escalation → hard cap, all designed to end on a spoken goodbye rather than a mid-sentence cut.
- **Scored feedback report** — overall score ring, per-competency breakdown, STAR/phase timeline, strengths & growth areas, per-question review.
- **Auth** — JWT + bcrypt, cookie-based sessions.
- One interview type fully implemented (**Behavioral**); Technical / System Design / HR are stubbed as "coming soon".

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 (Vite), React Router |
| Backend | Node.js, Express, `ws` (raw WebSocket) |
| Database | PostgreSQL 16 (Docker), Prisma 6 ORM |
| Voice engine | [Deepgram Voice Agent API](https://developers.deepgram.com/) — single WS: STT (Nova-3) + LLM + TTS (Aura-2), native barge-in |
| Interview LLM | Deepgram-managed `think` model (Anthropic Claude, no bring-your-own key) |
| Interview brain | LangGraph (`@langchain/langgraph`) + Groq (`gpt-oss-120b`) for live scoring/routing, with heuristic fallback |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` |

## Architecture

```
Browser (React)
   │  mic PCM ──────────────────────────────┐
   │  audio out ◄────────────────────────┐  │
   │                                      │  │
   ▼ REST (auth, interviews CRUD)         │  │
Express API ──────────────► PostgreSQL    │  │
   │                        (Prisma)      │  │
   │                                      │  │
   ▼ WS /api/interviews/:id/voice         │  │
Voice Proxy (voiceProxy.js) ◄─────────────┘  │
   │  raw `ws` (not the Deepgram SDK socket — │
   │  it JSON-parses binary audio and breaks) │
   ▼                                          │
Deepgram Voice Agent ─────────────────────────┘
   (STT Nova-3 → think.provider=anthropic → TTS Aura-2)

LangGraph director (backend/src/langGraph/) runs alongside the proxy:
evaluateAnswer → adjustDifficulty → decideRoute → generateQuestion | finalFeedback
pushes next-question directives into the agent via UpdatePrompt.
```

Key point: the Deepgram key and interview prompt live **only server-side**; the browser only ever talks to the Express proxy.

## Project Structure

```
.
├── docker-compose.yml        # PostgreSQL 16, host port 5433
├── backend/
│   ├── prisma/schema.prisma  # User, Interview, Transcription, Assessment, Feedback
│   └── src/
│       ├── server.js         # HTTP + WS upgrade (JWT + ownership check) entrypoint
│       ├── app.js            # Express app: /api/auth, /api/interviews
│       ├── config/config.js  # All env-driven config (voice, limits, graph, eval)
│       ├── controllers/      # authController, interviewController
│       ├── routes/           # authRoutes, interviewRoutes
│       ├── services/
│       │   ├── voiceProxy.js         # WS bridge to Deepgram, call-ending state machine
│       │   ├── functionHandlers.js   # record_assessment / submit_evaluation tools
│       │   ├── transcriptEvaluator.js# post-call fallback scoring
│       │   └── reportService.js
│       ├── langGraph/        # state.js, nodes.js, interviewGraph.js, orchestrator.js
│       ├── domain/interviewTypes.js  # per-type competencies/topics/phases
│       ├── prompts/interviewer.js    # prompt builder (resume/JD threading)
│       └── middleware/verifyToken.js
└── frontend/
    └── src/
        ├── pages/             # Login, Signup, Dashboard, InterviewRoom, Report
        ├── components/        # ProfileModal, VoiceOrb, Brand
        ├── audio/              # recorder.js, player.js (PCM), sfx.js (chimes)
        └── styles/
```

## Setup

### Prerequisites

- Node.js 18+
- Docker (for PostgreSQL)
- A [Deepgram](https://console.deepgram.com/) API key (required for the voice loop)
- A [Groq](https://console.groq.com/) API key (optional — enables live LangGraph scoring; heuristic fallback works without it)

### Installation

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Backend
cd backend
npm install
cp .env.example .env   # fill in DEEPGRAM_API_KEY, JWT_SECRET, GROQ_API_KEY
npm run db:migrate     # prisma db push
npm run dev            # http://localhost:3000

# 3. Frontend (separate shell)
cd frontend
npm install
npm run dev            # http://localhost:5173
```

This is two independent npm projects (no root package.json / workspaces) — `backend/` and `frontend/` are installed and run separately.

A seeded test user is available: `cand@test.com` / `secret1`.

## Environment Variables

Set in `backend/.env` (see `backend/.env.example`):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DEEPGRAM_API_KEY` | ✅ | — | Voice Agent WS (STT+LLM+TTS) |
| `JWT_SECRET` | ✅ | — | Signs the auth cookie |
| `DATABASE_URL` | ✅ | `postgres://interviewlab:interviewlab@localhost:5433/interviewlab` | Prisma connection |
| `GROQ_API_KEY` | optional | — | Enables live LangGraph node LLM calls (else heuristic fallback) |
| `EVAL_MODEL` | optional | `openai/gpt-oss-120b` | Model for post-call fallback evaluation & graph nodes |
| `PORT` | optional | `3000` (`4000` in code default) | Backend port |
| `CLIENT_ORIGIN` | optional | `http://localhost:5173` | CORS origin |
| `GRAPH_DRIVEN` | optional | `true` | Toggle LangGraph director vs. legacy autonomous prompt |
| `SOFT_WRAP_MS` / `POST_NUDGE_MS` / `MAX_DURATION_MS` | optional | 7min / 60s / 11min | Call-ending schedule (soft nudge → escalation → hard cap) |
| `JD_MAX_CHARS` / `RESUME_MAX_CHARS` | optional | 2000 / 3500 | Prompt-context clipping |

## Commands

| Command | Where | Purpose |
|---|---|---|
| `docker compose up -d` | root | Start PostgreSQL |
| `npm run dev` | `backend/` | Start API + WS proxy with nodemon |
| `npm start` | `backend/` | Start API + WS proxy (no reload) |
| `npm run db:migrate` | `backend/` | `prisma db push` — sync schema to DB |
| `npm run db:dev` | `backend/` | `prisma migrate dev` — create a migration |
| `npm run db:deploy` | `backend/` | `prisma migrate deploy` — apply migrations (prod) |
| `npm run db:generate` | `backend/` | Regenerate Prisma client |
| `npm run dev` | `frontend/` | Start Vite dev server |
| `npm run build` | `frontend/` | Production build |
| `npm run preview` | `frontend/` | Preview production build |

## API Overview

**Auth** (`/api/auth`)
| Method | Path | Notes |
|---|---|---|
| POST | `/signup` | Create account (email, password, name, jobRole, experienceLevel) |
| POST | `/login` | Sets JWT cookie |
| POST | `/logout` | Clears cookie |
| GET | `/me` | Current user (auth required) |
| PATCH | `/profile` | Partial update — resume text, skills, years of experience |

**Interviews** (`/api/interviews`, all auth-required)
| Method | Path | Notes |
|---|---|---|
| POST | `/` | Create interview (type, optional jdText) |
| GET | `/` | List current user's interviews |
| GET | `/:id` | Fetch report / current state |
| PATCH | `/:id` | Set/update JD text (owner + `in_progress` only) |
| POST | `/:id/finish` | Finalize + generate fallback feedback if needed |

**Voice** (WebSocket)
| Path | Notes |
|---|---|
| `WS /api/interviews/:id/voice` | Cookie-authenticated, ownership-checked bridge to the Deepgram Voice Agent. Client streams PCM in, receives PCM + control events out. |

**Misc**
| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Liveness check |

## Key Decisions & Trade-offs

| Decision | Trade-off accepted |
|---|---|
| **Deepgram Voice Agent (single WS)** over separate STT/LLM/TTS calls | Less control over each stage individually, but native barge-in and far lower round-trip latency than chaining three services yourself. |
| **Deepgram-managed LLM** (`think.provider=anthropic`, no bring-your-own key) | Can't swap models freely inside the voice loop or self-host the interviewer's reasoning, but avoids running a second inference hop in the hot path and keeps only one secret (`DEEPGRAM_API_KEY`) for the voice loop. |
| **Raw `ws` instead of the Deepgram SDK socket** | More boilerplate (manual message framing), but the SDK v5 client JSON-parses binary audio frames and corrupts them — raw `ws` avoids that bug entirely. |
| **LangGraph director alongside the voice prompt** (added post-MVP) | More moving parts (a second LLM hop on Groq, state checkpointing) than trusting the Deepgram-managed model to run the whole interview autonomously, but gives deterministic, inspectable control over difficulty/topic routing and a human-in-the-loop intervene endpoint. Heuristic fallback keeps it running with zero extra keys. |
| **Only Behavioral fully implemented** | Narrower scope than "4 interview types," but lets one type (prompts, competencies, phase report) be built and verified properly rather than four shallow ones. |
| **Client-gated mic (button-triggered barge-in) instead of free talk-over** | Slightly less "natural" than always-on VAD barge-in, but avoids accidental interruptions from background noise triggering Deepgram's native barge-in. |
| **Two separate npm projects, no monorepo tooling** | No shared dependency hoisting/workspace scripts, but avoids workspace tooling overhead for a two-package take-home. |
| **Graceful hard cap (soft nudge → escalation → forced close) instead of an instant cutoff** | More implementation complexity (multi-stage state machine, retry logic) than `maxDurationSeconds`-style blunt cutoff, but the interview always ends on a spoken goodbye instead of mid-sentence. |

## Cost Analysis

Rough marginal cost per ~10-minute behavioral interview (list prices, check current provider pricing before relying on this for budgeting):

| Component | Basis | Approx. cost / interview |
|---|---|---|
| Deepgram Voice Agent (STT + TTS + Deepgram-managed think passthrough) | ~10 min audio in + out, Nova-3 + Aura-2 | ~$0.10–$0.20 |
| Anthropic think model (Deepgram-managed, per-turn) | ~15–20 short turns, small context each | included in Deepgram voice-agent billing (no separate Anthropic key/bill) |
| Groq LangGraph nodes (evaluate/route/generate, `gpt-oss-120b`) | ~8–9 question cycles × small prompt/completion | ~$0.01–$0.03 (Groq's `gpt-oss-120b` pricing is inference-optimized/low-cost) |
| Post-call fallback evaluation (Groq) | 1 call, larger context (full transcript) | ~$0.01 |
| PostgreSQL / hosting | self-hosted Docker container | negligible (infra cost only) |
| **Total per interview** | | **≈ $0.12–$0.25** |

Biggest lever on cost is Deepgram voice-minutes (dominates the total) — the graceful-ending logic that avoids letting calls run past ~11 minutes is a direct cost control, not just a UX one. Groq's LangGraph layer is comparatively negligible since it operates on short per-turn text, not audio.
