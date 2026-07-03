# InterviewLab

Voice-first AI mock interviews. Talk naturally, get real-time follow-up questions, and finish with a detailed report that shows exactly how to improve.

<img width="1501" height="854" alt="Screenshot 2026-07-03 at 6 27 02 PM" src="https://github.com/user-attachments/assets/c70117a6-f900-49c0-a74d-4fd295d34730" />

## Main Features

- **Real-time voice interviews** — Fully spoken, back-and-forth conversation with an AI interviewer across 4 formats (Behavioral, Technical, System Design, HR), each with its own persona and rubric.
- **Adaptive questioning** — A decision engine reads every answer and adjusts live: weak answer → follow-up probe, strong answer → harder question, then wraps up once the rubric is covered.
- **Resume + JD personalization** — Add your resume and paste the target job description; the interviewer asks about your real projects for that specific role, and the report includes a resume-vs-interview gap analysis.
- **Deep scored feedback report** — Overall score /100, hiring-manager verdict, top-3 fixes, per-competency 1–5 breakdown with evidence, and a question-by-question review with a concrete "try this instead."
- **Natural conversation UX** — Tap-to-interrupt barge-in, an animated voice orb that reacts to speech, and objective delivery metrics (talk ratio, filler-word rate, avg words per answer).

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 (Vite), React Router |
| Backend | Node.js, Express, WebSocket |
| Database | PostgreSQL 16 (Docker), Prisma 6 ORM |
| Voice engine | Deepgram Voice Agent API: STT (Nova-3) + LLM + TTS (Aura-2) |
| Interview brain | LangGraph + Groq (`gpt-oss-120b`) for live scoring/routing, with heuristic fallback |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` |

## User Flow

End-to-end journey a candidate takes through the app.

```mermaid
flowchart TD
    Start([Land on app]) --> HasAcct{Has account?}
    HasAcct -- No --> Signup[Sign up: name, email,<br/>job role, experience]
    HasAcct -- Yes --> Login[Log in]
    Signup --> Dash
    Login --> Dash

    Dash[Dashboard: past interviews<br/>+ interview types]
    Dash --> AddResume{Resume on<br/>profile?}
    AddResume -- No, optional --> Profile[Add résumé + skills<br/>via Profile modal]
    Profile --> Dash
    AddResume -- Yes --> PickType

    Dash --> PickType[Pick interview type:<br/>Behavioral · Technical ·<br/>System Design · HR]
    PickType --> Lobby[Lobby: review résumé status,<br/>optionally paste Job Description]

    Lobby --> Begin[Begin → create/patch interview,<br/>grant mic]
    Begin --> Live[Live voice interview<br/>speak with AI interviewer]

    Live --> Talk{Candidate turn}
    Talk -- Answer --> Live
    Talk -- Tap to interrupt --> Live
    Talk -- End button --> Finish

    Live --> AutoEnd[Agent wraps up /<br/>soft nudge / hard cap]
    AutoEnd --> Finish[Finalize: drain audio,<br/>POST /finish]

    Finish --> Report[Feedback report:<br/>score ring, per-competency,<br/>STAR, strengths, growth, timeline]
    Report --> Dash
    Report --> Retry[Start another interview] --> PickType
```

## ER Diagram

Relational model as defined in `backend/prisma/schema.prisma`.

```mermaid
erDiagram
    USER ||--o{ INTERVIEW : "has many"
    INTERVIEW ||--o{ TRANSCRIPTION : "has many"
    INTERVIEW ||--o{ ASSESSMENT : "has many"
    INTERVIEW ||--o| FEEDBACK : "has one"

    USER {
        int id PK
        string email UK
        string password_hash
        string name
        string job_role
        string experience_level
        string resume_text "nullable"
        string skills "nullable"
        int years_experience "nullable"
        timestamptz created_at
    }

    INTERVIEW {
        int id PK
        int user_id FK
        string type "default behavioral"
        string status "in_progress|completed|abandoned"
        timestamptz started_at
        timestamptz ended_at "nullable"
        string deepgram_request_id "nullable"
        string jd_text "nullable"
    }

    TRANSCRIPTION {
        int id PK
        int interview_id FK
        int seq
        string role "user|assistant"
        string content
        timestamptz created_at
    }

    ASSESSMENT {
        int id PK
        int interview_id FK
        string competency
        string topic "nullable"
        int score
        string note "nullable"
        timestamptz created_at
    }

    FEEDBACK {
        int interview_id PK "FK, one-to-one"
        int overall_score "nullable"
        string summary "nullable"
        string verdict "nullable"
        json top_priorities
        json per_competency
        json strengths
        json growth_areas
        json star
        json timeline
        json exchanges
        timestamptz created_at
    }
```

**Cascade:** deleting a `User` cascades to their `Interview`s; deleting an `Interview` cascades to its `Transcription`s, `Assessment`s and `Feedback`.

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
│       │   ├── voiceProxy.js          # WS bridge to Deepgram, call-ending state machine
│       │   ├── functionHandlers.js    # record_assessment / submit_evaluation tools
│       │   ├── transcriptEvaluator.js # post-call fallback scoring
│       │   └── reportService.js
│       ├── langGraph/        # state.js, nodes.js, interviewGraph.js, orchestrator.js
│       ├── domain/interviewTypes.js   # per-type competencies/topics/phases
│       ├── prompts/interviewer.js     # prompt builder (resume/JD threading)
│       └── middleware/verifyToken.js
└── frontend/
    └── src/
        ├── pages/          # Login, Signup, Dashboard, InterviewRoom, Report
        ├── components/     # ProfileModal, VoiceOrb, Brand
        ├── audio/          # recorder.js, player.js (PCM), sfx.js (chimes)
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
| **Deepgram Voice Agent API (single WS)** over building my own STT→LLM→TTS pipeline or using LiveKit | Less control over each stage, but native barge-in, one round trip instead of three, and one secret. Rolling my own means owning VAD/endpointing/buffering; LiveKit is just transport — I'd still orchestrate the three model calls myself. |
| **Prisma ORM** instead of raw SQL | Extra dependency + migration step, but type-safe queries and versioned migrations — safer as the schema kept evolving. |
| **Client-gated mic** (auto-mutes while the agent speaks; tap to interrupt) instead of always-on talk-over | Less "natural" — you tap to interrupt — but background noise can't accidentally cut off the interviewer. Calmer, more predictable. |
| **Raw `ws`** instead of the Deepgram SDK socket | More boilerplate, but the SDK v5 client corrupts binary audio frames — raw `ws` avoids the bug. |
| **LangGraph director** with a heuristic fallback | An extra LLM hop (Groq) vs. letting the model run autonomously, but gives deterministic difficulty/topic routing. Falls back to rule-based logic if the key's missing — keeps running with zero extra keys. |

## Cost Analysis

| Service | Role in app | Config |
|---|---|---|
| **Deepgram Voice Agent API** | The whole voice loop over one WebSocket: Nova-3 STT + Deepgram-managed LLM + Aura-2 TTS | **Standard** tier |
| **Groq `gpt-oss-120b`** | LangGraph "director" brain: scores answers, adjusts difficulty, picks next question | Optional (heuristic fallback if no key) |

> Deepgram bills on **WebSocket connection time**, not just speech — idle/listening time counts.

### Unit pricing

**Deepgram — Voice Agent API, Standard tier (per minute)**

| Plan | Price |
|---|---|
| Pay As You Go | **$0.075/min** |
| Growth | **$0.068/min** |

**Groq — `gpt-oss-120b` (per 1M tokens)**

| Input | Output |
|---|---|
| **$0.15** | **$0.60** |

### Cost per interview

**Assumptions:** ~10 min average call (soft-wrap 7 min, hard cap 11 min); ~8 answer exchanges; Groq called ~2–3× per exchange + final feedback ≈ **45K input / 4K output tokens** per interview.

| Component | Per interview | Share |
|---|---|---|
| Deepgram Voice Agent (Standard, PAYG) — 10 min × $0.075 | **$0.750** | ~99% |
| Groq gpt-oss-120b — 45K × $0.15/M + 4K × $0.60/M | **$0.009** | ~1% |
| **Total (PAYG)** | **≈ $0.76** | |
| Total on Growth plan (10 min × $0.068 + Groq) | ≈ $0.69 | |

**Deepgram is ~99% of cost; Groq is a rounding error (< 2¢).** Every optimization dollar is in Deepgram minutes.

### At scale (PAYG, Standard)

| Volume | Deepgram | Groq | **Total** |
|---|---|---|---|
| 100 interviews | $75 | $0.90 | **~$76** |
| 1,000 interviews | $750 | $9 | **~$759** |
| 10,000 interviews | $7,500 | $90 | **~$7,590** |

**Biggest lever:** average call length. Trimming the hard cap 11→8 min, or landing most calls near the 7-min soft nudge, cuts Deepgram spend ~20–30% linearly.

### Rate limits

**Deepgram — per project (429 on exceed)**

| API | Pay As You Go | Growth |
|---|---|---|
| **Voice Agent (WSS)** ← *ours* | **45 concurrent connections** | 60 (NA) / 45 (EU/AU) |
| Streaming STT (WSS) | 150 | 225 (NA) |
| TTS streaming | 45 | 60 (NA) |

**Groq — free tier (current constraint on `gpt-oss-120b`)**

| Limit | Free tier |
|---|---|
| Requests / min | 30 RPM |
| Requests / day | 1,000 RPD |
| Tokens / min | **8,000 TPM** ⚠️ |
| Tokens / day | **200,000 TPD** ⚠️ |