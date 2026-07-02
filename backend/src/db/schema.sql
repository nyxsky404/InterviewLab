-- Idempotent schema for the mock-interview platform.

CREATE TABLE IF NOT EXISTS users (
  id               SERIAL PRIMARY KEY,
  email            TEXT UNIQUE NOT NULL,
  password_hash    TEXT NOT NULL,
  name             TEXT NOT NULL,
  job_role         TEXT NOT NULL,
  experience_level TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interviews (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                 TEXT NOT NULL DEFAULT 'behavioral',
  status               TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | completed
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at             TIMESTAMPTZ,
  deepgram_request_id  TEXT
);

CREATE INDEX IF NOT EXISTS idx_interviews_user ON interviews(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS turns (
  id            SERIAL PRIMARY KEY,
  interview_id  INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  role          TEXT NOT NULL,  -- 'user' | 'assistant'
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_turns_interview ON turns(interview_id, seq);

-- Per-answer rubric judgments the LLM logs live via the record_assessment tool.
CREATE TABLE IF NOT EXISTS assessments (
  id            SERIAL PRIMARY KEY,
  interview_id  INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  competency    TEXT NOT NULL,
  topic         TEXT,   -- which story beat this answer explored (drives timeline + STAR)
  score         INTEGER NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessments_interview ON assessments(interview_id);

-- Backfill for databases created before topic tagging existed.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS topic TEXT;

-- Final structured feedback (one row per interview).
CREATE TABLE IF NOT EXISTS feedback (
  interview_id   INTEGER PRIMARY KEY REFERENCES interviews(id) ON DELETE CASCADE,
  overall_score  INTEGER,
  summary        TEXT,
  verdict        TEXT,
  top_priorities JSONB NOT NULL DEFAULT '[]'::jsonb,
  per_competency JSONB NOT NULL DEFAULT '[]'::jsonb,
  strengths      JSONB NOT NULL DEFAULT '[]'::jsonb,
  growth_areas   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill columns for databases created before the verdict / priorities fields.
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS verdict TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS top_priorities JSONB NOT NULL DEFAULT '[]'::jsonb;
-- STAR ratings + interview timeline, written by the post-call evaluator.
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS star JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS timeline JSONB NOT NULL DEFAULT '[]'::jsonb;
