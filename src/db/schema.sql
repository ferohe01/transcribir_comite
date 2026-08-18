PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id             TEXT PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename       TEXT NOT NULL,
  size_bytes     INTEGER,
  duration_s     REAL,
  asr_model      TEXT NOT NULL,
  language       TEXT,
  hint           TEXT,
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','done','error','cancelled')),
  stage          TEXT,
  progress       INTEGER NOT NULL DEFAULT 0,
  detail         TEXT,
  error          TEXT,
  cost_estimate  REAL,
  elapsed_ms     INTEGER,
  chunk_count    INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transcripts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  formatted     TEXT,
  segments_json TEXT,
  language      TEXT,
  audio_sha256  TEXT,
  asr_model     TEXT NOT NULL,
  -- Huella de todo lo que influye en el resultado: audio, modelo, idioma y
  -- vocabulario. Si cualquiera cambia, hay que transcribir de nuevo.
  cache_key     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transcripts_cache ON transcripts(cache_key);

-- Tabla aparte para poder tener varios post-procesos sobre una misma
-- transcripcion (acta, resumen, evaluacion...) sin retranscribir.
CREATE TABLE IF NOT EXISTS outputs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  transcript_id INTEGER NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  template_id   TEXT NOT NULL,
  custom_prompt TEXT,
  llm_model     TEXT,
  text          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_outputs_transcript ON outputs(transcript_id, created_at DESC);

CREATE TABLE IF NOT EXISTS templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  prompt     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);
