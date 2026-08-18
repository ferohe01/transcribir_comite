import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config, ensureDirs, ROOT } from '../config/index.js';

let db;

/**
 * Conexion unica a SQLite. El esquema es idempotente (`CREATE TABLE IF NOT
 * EXISTS`), asi que se aplica en cada arranque y el despliegue no necesita un
 * paso de migracion aparte.
 */
export function getDb() {
  if (db) return db;

  ensureDirs();
  db = new Database(config.paths.db);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // El worker y el servidor son procesos distintos escribiendo en el mismo
  // fichero; sin esto un bloqueo momentaneo aborta la escritura.
  db.pragma('busy_timeout = 5000');

  const schema = fs.readFileSync(path.join(ROOT, 'src', 'db', 'schema.sql'), 'utf8');
  db.exec(schema);

  return db;
}

/** Cierra la conexion. Necesario en las pruebas: en Windows el fichero queda
 *  bloqueado mientras siga abierto y no se puede borrar. */
export function closeDb() {
  db?.close();
  db = undefined;
}

// --- Usuarios --------------------------------------------------------------

export const users = {
  create({ email, passwordHash, role = 'user' }) {
    return getDb()
      .prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
      .run(email, passwordHash, role).lastInsertRowid;
  },
  byEmail(email) {
    return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
  },
  byId(id) {
    return getDb().prepare('SELECT id, email, role, created_at FROM users WHERE id = ?').get(id);
  },
  count() {
    return getDb().prepare('SELECT COUNT(*) AS n FROM users').get().n;
  },
  list() {
    return getDb().prepare('SELECT id, email, role, created_at FROM users ORDER BY id').all();
  },
};

// --- Trabajos --------------------------------------------------------------

export const jobs = {
  create(job) {
    getDb()
      .prepare(
        `INSERT INTO jobs (id, user_id, filename, size_bytes, asr_model, language, hint)
         VALUES (@id, @userId, @filename, @sizeBytes, @asrModel, @language, @hint)`,
      )
      .run(job);
    return this.byId(job.id);
  },

  updateProgress(id, { status, stage, progress, detail }) {
    getDb()
      .prepare(
        `UPDATE jobs
            SET status   = COALESCE(?, status),
                stage    = COALESCE(?, stage),
                progress = COALESCE(?, progress),
                detail   = COALESCE(?, detail)
          WHERE id = ?`,
      )
      .run(status ?? null, stage ?? null, progress ?? null, detail ?? null, id);
  },

  finish(id, { durationSeconds, costEstimate, elapsedMs, chunkCount }) {
    getDb()
      .prepare(
        `UPDATE jobs
            SET status = 'done', progress = 100, stage = 'done', error = NULL,
                duration_s = ?, cost_estimate = ?, elapsed_ms = ?, chunk_count = ?,
                finished_at = datetime('now')
          WHERE id = ?`,
      )
      .run(durationSeconds, costEstimate, elapsedMs, chunkCount, id);
  },

  fail(id, message) {
    getDb()
      .prepare(
        `UPDATE jobs SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?`,
      )
      .run(String(message).slice(0, 2000), id);
  },

  byId(id) {
    return getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  },

  /** Un trabajo solo es visible para quien lo creo. */
  byIdForUser(id, userId) {
    return getDb().prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get(id, userId);
  },

  listForUser(userId, limit = 50) {
    return getDb()
      .prepare(
        `SELECT j.*, t.id AS transcript_id
           FROM jobs j
           LEFT JOIN transcripts t ON t.job_id = j.id
          WHERE j.user_id = ?
          ORDER BY j.created_at DESC
          LIMIT ?`,
      )
      .all(userId, limit);
  },

  delete(id, userId) {
    return getDb().prepare('DELETE FROM jobs WHERE id = ? AND user_id = ?').run(id, userId).changes;
  },

  /**
   * Trabajos que quedaron en 'running' de un arranque anterior. Si el proceso
   * murio a mitad, sin esto se quedarian colgados para siempre en la interfaz.
   */
  markStaleAsError() {
    return getDb()
      .prepare(
        `UPDATE jobs
            SET status = 'error',
                error = 'El servidor se reinicio mientras se procesaba este trabajo.'
          WHERE status IN ('running', 'queued')`,
      )
      .run().changes;
  },
};

// --- Transcripciones y salidas --------------------------------------------

export const transcripts = {
  create(row) {
    const id = getDb()
      .prepare(
        `INSERT INTO transcripts (job_id, text, formatted, segments_json, language, audio_sha256, asr_model)
         VALUES (@jobId, @text, @formatted, @segmentsJson, @language, @audioSha256, @asrModel)`,
      )
      .run(row).lastInsertRowid;
    return id;
  },

  byJobId(jobId) {
    return getDb().prepare('SELECT * FROM transcripts WHERE job_id = ?').get(jobId);
  },

  byId(id) {
    return getDb().prepare('SELECT * FROM transcripts WHERE id = ?').get(id);
  },

  /** Busca una transcripcion previa del mismo audio con el mismo modelo. */
  findCached(audioSha256, asrModel) {
    return getDb()
      .prepare(
        `SELECT * FROM transcripts
          WHERE audio_sha256 = ? AND asr_model = ?
          ORDER BY created_at DESC LIMIT 1`,
      )
      .get(audioSha256, asrModel);
  },
};

export const outputs = {
  create(row) {
    return getDb()
      .prepare(
        `INSERT INTO outputs (transcript_id, template_id, custom_prompt, llm_model, text)
         VALUES (@transcriptId, @templateId, @customPrompt, @llmModel, @text)`,
      )
      .run(row).lastInsertRowid;
  },
  listForTranscript(transcriptId) {
    return getDb()
      .prepare('SELECT * FROM outputs WHERE transcript_id = ? ORDER BY created_at DESC')
      .all(transcriptId);
  },
};

export const userTemplates = {
  listForUser(userId) {
    return getDb()
      .prepare('SELECT * FROM templates WHERE user_id = ? ORDER BY name')
      .all(userId);
  },
  upsert({ userId, name, prompt }) {
    return getDb()
      .prepare(
        `INSERT INTO templates (user_id, name, prompt) VALUES (?, ?, ?)
         ON CONFLICT (user_id, name) DO UPDATE SET prompt = excluded.prompt`,
      )
      .run(userId, name, prompt).lastInsertRowid;
  },
  delete(id, userId) {
    return getDb().prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(id, userId).changes;
  },
};
