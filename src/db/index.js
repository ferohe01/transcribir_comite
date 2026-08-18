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

  // Las migraciones van ANTES del esquema: este crea indices sobre columnas
  // nuevas, y en una base de datos que ya existia esas columnas todavia no
  // estan. Al reves fallaba con "no such column".
  migrate(db);

  const schema = fs.readFileSync(path.join(ROOT, 'src', 'db', 'schema.sql'), 'utf8');
  db.exec(schema);

  return db;
}

/**
 * Cambios de esquema sobre bases de datos que ya existen. `CREATE TABLE IF NOT
 * EXISTS` no anade columnas nuevas a una tabla ya creada, asi que las
 * incorporaciones van aqui. Cada paso comprueba antes si hace falta, de modo
 * que ejecutarlo en cada arranque es inofensivo.
 */
function migrate(database) {
  const existeTabla = (tabla) =>
    Boolean(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(tabla),
    );
  const columnas = (tabla) =>
    database.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);

  // En una base de datos nueva no hay nada que migrar: el esquema, que se
  // aplica justo despues, ya la crea completa.
  if (existeTabla('jobs') && !columnas('jobs').includes('fell_back')) {
    database.exec('ALTER TABLE jobs ADD COLUMN fell_back TEXT');
  }

  if (existeTabla('transcripts') && !columnas('transcripts').includes('cache_key')) {
    // Las transcripciones anteriores se quedan sin clave y por tanto fuera de
    // la cache. Es lo correcto: se hicieron sin registrar con que idioma ni
    // con que vocabulario, asi que no se puede saber si servirian.
    database.exec('ALTER TABLE transcripts ADD COLUMN cache_key TEXT');
  }
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

  finish(id, { durationSeconds, costEstimate, elapsedMs, chunkCount, fellBack }) {
    getDb()
      .prepare(
        `UPDATE jobs
            SET status = 'done', progress = 100, stage = 'done', error = NULL,
                duration_s = ?, cost_estimate = ?, elapsed_ms = ?, chunk_count = ?,
                fell_back = ?, finished_at = datetime('now')
          WHERE id = ?`,
      )
      .run(
        durationSeconds,
        costEstimate,
        elapsedMs,
        chunkCount,
        fellBack?.length ? JSON.stringify(fellBack) : null,
        id,
      );
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
        `INSERT INTO transcripts
           (job_id, text, formatted, segments_json, language, audio_sha256, asr_model, cache_key)
         VALUES
           (@jobId, @text, @formatted, @segmentsJson, @language, @audioSha256, @asrModel, @cacheKey)`,
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

  /**
   * Busca una transcripcion previa equivalente.
   *
   * La clave cubre audio, modelo, idioma y vocabulario. Antes solo miraba
   * audio y modelo, con lo que cambiar el idioma y volver a subir el mismo
   * archivo devolvia el resultado viejo y el cambio no surtia efecto.
   */
  findCached(cacheKey) {
    if (!cacheKey) return undefined;
    return getDb()
      .prepare(
        'SELECT * FROM transcripts WHERE cache_key = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(cacheKey);
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
