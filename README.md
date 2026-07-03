# 🎙️ Voice Mock Interview Platform

A full-stack platform where candidates have a **real, dynamic voice conversation** with an AI
interviewer. It listens to what you actually say, follows up on vague answers, pushes back on weak
ones, acknowledges strong ones, and decides what to ask next from the **full conversation context** —
there is no question bank and no text chat.

One interview type is built end-to-end and properly: **Behavioral**.

---

## Setup (5 commands)

**Prerequisites:** Node ≥ 20, Docker, and a [Deepgram API key](https://console.deepgram.com/) (free credit on signup).

```bash
cp .env.example .env          # 1. then paste your DEEPGRAM_API_KEY and set JWT_SECRET
docker compose up -d          # 2. start PostgreSQL
npm install                   # 3. install client + server (npm workspaces)
npm run db:migrate            # 4. create/update the Prisma schema
npm run dev                   # 5. run Express (:4000) + Vite (:5173)
```

Open **http://localhost:5173**, sign up, and start a behavioral interview. Use headphones to avoid
echo. That's the whole thing.

> The **only** external AI credential is `DEEPGRAM_API_KEY`. There is no OpenAI/Anthropic key —
> the interviewer LLM is **Deepgram-managed** (see below).

---

## The core loop (what makes it feel real)

```
 Browser (mic)  ──PCM16 16kHz──►  Express proxy  ──►  Deepgram Voice Agent
                                       │                 ├─ STT (Nova-3)
 Browser (audio) ◄──PCM16 24kHz──  Express proxy  ◄──    ├─ LLM  (managed Claude Sonnet 4)  ← the "brain"
                                       │                 └─ TTS (Aura-2)
                              persists turns + assessments
```

The entire STT → LLM → TTS turn-taking (and **barge-in**) is orchestrated by **Deepgram's Voice Agent
API** over a single WebSocket. The interviewer's intelligence lives in a **system prompt** given to the
managed LLM (`server/src/prompts/interviewer.js`), which receives the running conversation on every
turn and is instructed to:

- open with the role and what the interview covers, then ask **one question at a time**;
- **actually respond to the specific answer** — reference a detail the candidate mentioned;
- **follow up** when an answer is vague/incomplete/interesting; **push back** on unsupported claims;
- know when to **dig deeper vs. move on**, and **close naturally** when coverage is sufficient.

**Processing each answer before deciding what's next** is made explicit with two LLM tools:

- `record_assessment(competency, score, note)` — the model logs a rubric judgment after each answer;
- `submit_evaluation(...)` — called once at the close to produce the final structured feedback.

Both are executed **server-side** by the Express proxy (`server/src/deepgram/functionHandlers.js`) so
speech is never interrupted, and they directly feed the report. If a session ends abruptly, a
**fallback** aggregates the per-answer assessments (including strengths/growth pulled from the live
notes) so the report is never empty.

### How an interview ends

Three ways, so it always terminates cleanly (and never runs away on time or cost):

1. **The candidate ends it** — the *End interview* button, available any time.
2. **The interviewer wraps up on its own** — the prompt targets ~8–10 minutes / 3–4 areas and closes
   naturally. When it calls `submit_evaluation`, the proxy waits for its closing line to finish, then
   pushes `{type:"complete"}` so the browser auto-navigates to the report.
3. **Server-side guardrails** — at a soft limit (~9 min) the proxy sends a Deepgram `UpdatePrompt`
   nudging the agent to close; models reliably speak a goodbye but often *skip* the final
   `submit_evaluation`, so a short post-nudge deadline (and a hard ~12 min cap) force a graceful end
   regardless. The report then uses the assessment-based fallback. Limits are configurable via
   `SOFT_WRAP_MS` / `HARD_CAP_MS`.

### Why an Express proxy instead of connecting the browser straight to Deepgram

- The Deepgram key stays **server-side**.
- Every `ConversationText` turn is **persisted** to Postgres as it happens.
- The interviewer prompt and tools are **controlled** centrally.

---

## Key decisions & trade-offs

| Decision | Why |
|---|---|
| **Deepgram Voice Agent** for the whole voice layer | One WebSocket handles STT + LLM + TTS with native barge-in and turn-taking — far less glue and latency than wiring three services together. Managed service, no self-hosted models. |
| **Deepgram-managed LLM** (`think.provider = anthropic / claude-sonnet-4-6`), **no BYO key** | Deepgram hosts the model, so there's a single credential and no separate LLM billing integration. Claude Sonnet 4.6 gives the strongest adaptive-interviewing reasoning on their managed catalog. Swappable via `LLM_PROVIDER`/`LLM_MODEL` (e.g. `open_ai`/`gpt-4o`, `google`/`gemini-2.5-flash`). The current supported list is live at `GET https://agent.deepgram.com/v1/agent/settings/think/models`. |
| **linear16 PCM** both directions | Trivial browser capture (AudioWorklet) and gapless playback (AudioContext) with no codec handling. Costs a little bandwidth — negligible locally. |
| **Raw `ws`** to Deepgram inside the proxy (not the SDK's socket wrapper) | The v5 SDK's agent socket JSON-parses every frame, which breaks on binary TTS audio in Node. Raw `ws` gives clean control over binary vs. text frames for the relay. The SDK's type definitions were used as the source of truth for the Settings schema. |
| **LangGraph bonus intentionally skipped** | In-loop graph branching would require a **custom/BYO `think` endpoint**, which conflicts with the "Deepgram-managed LLM, no BYO" choice. The spirit — specialized responsibilities — is kept via modular server services (prompt builder, assessment handler, evaluation service). Nailing the core voice loop was the priority. |

---

## Cost analysis (third-party AI service)

Deepgram Voice Agent is usage-based. Base Voice Agent (STT + TTS + orchestration) is **~$4.50/hr ≈
$0.075/min**; the **managed LLM tokens are billed separately** at pass-through rates.

**Estimate for one ~10-minute behavioral interview:**

| Component | Assumption | Cost |
|---|---|---|
| Voice Agent base (STT + TTS + orchestration) | 10 min @ ~$0.075–0.15/min | ~$0.75 – $1.50 |
| Managed LLM (Claude Sonnet 4) | ~15 turns, growing context ≈ 50–80K input + ~4K output tokens | ~$0.20 – $0.35 |
| **Total per interview** | | **≈ $1 – $2** |

**Levers to reduce cost:** switch the managed model to a cheaper tier (`gemini-2.5-flash` or a Haiku/
mini model), cap interview length in the prompt, and trim `record_assessment` frequency. At ~$1–2 per
completed interview, unit economics are viable for a freemium practice product. Figures are estimates —
confirm against the [Deepgram pricing page](https://deepgram.com/pricing) for your tier.

---

## Tech stack

- **Frontend:** React (Vite), React Router, Web Audio API (AudioWorklet capture + streaming playback).
- **Backend:** Node.js + Express, `ws` for the voice WebSocket proxy.
- **Database:** PostgreSQL through Prisma 6, schema in `backend/prisma/schema.prisma`.
- **Auth:** email + password, bcrypt hashing, JWT (no OAuth). Candidates self-sign-up.
- **Voice/AI:** Deepgram Voice Agent API (Nova-3 STT · managed Claude Sonnet 4 · Aura-2 TTS).

## Project structure

```
backend/
  prisma/                   Prisma 6 schema and migrations
  src/config/               env + model config
  src/data/                 Prisma client + persistence functions
  src/server.js             Express app + WS upgrade auth
  routes/                   auth.js, interviews.js
  middleware/auth.js        JWT guard
  prompts/interviewer.js    the interviewer "brain" (prompt + tool schemas)
  deepgram/voiceProxy.js    browser ↔ Deepgram relay + turn persistence
  deepgram/functionHandlers.js   record_assessment / submit_evaluation
  services/evaluation.js    scoring aggregation + fallback feedback
client/src
  pages/                    Signup, Login, Dashboard, InterviewRoom, Report
  audio/                    recorder.js (mic→PCM16), player.js (streaming playback)
  public/pcm-recorder-worklet.js   resample + PCM16 encode in an AudioWorklet
```

## Demo script (for the walkthrough / Loom)

1. **Sign up** with a name, target role, and experience level → land on the dashboard.
2. **Start a Behavioral interview**; the interviewer greets you and asks the first question.
3. Give a **deliberately vague** answer → notice it **follows up / probes** instead of moving on.
4. Give a **strong, specific** answer with a real result → notice it **acknowledges and advances**.
5. **Interrupt** it mid-sentence → it yields (barge-in).
6. Click **End interview** → the **report** shows an overall score, per-competency bars,
   strengths/growth areas, and the full transcript. It also appears under **Past sessions**.

## Notes & limitations

- Requires a browser with microphone access; use headphones to avoid echo bleed.
- The Deepgram-managed model string must be one Deepgram hosts (see `config.js`).
- Only the **Behavioral** type is enabled; the picker shows the other three as "coming soon", and the
  prompt is type-parameterized so adding one is prompt-only.
