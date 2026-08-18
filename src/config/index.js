import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Todas las rutas se resuelven contra ROOT, nunca contra el CWD: el proceso
// debe comportarse igual lo lance quien lo lance (bug de la version anterior).
export const config = {
  port: int(process.env.PORT, 3001),
  isProduction: process.env.NODE_ENV === 'production',
  sessionSecret: process.env.SESSION_SECRET || '',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',

  signup: {
    // El registro desde la pantalla de acceso solo se abre si hay codigo de
    // invitacion. Cada transcripcion gasta creditos de API, asi que sin
    // puerta cualquiera que diera con el dominio podria crearse una cuenta y
    // consumirlos. Vacio = solo altas por terminal (npm run create-user).
    code: (process.env.SIGNUP_CODE ?? '').trim(),
  },

  paths: {
    root: ROOT,
    public: path.join(ROOT, 'src', 'public'),
    data: path.join(ROOT, 'data'),
    uploads: path.join(ROOT, 'data', 'uploads'),
    work: path.join(ROOT, 'data', 'work'),
    db: path.join(ROOT, 'data', 'transcript.db'),
  },

  audio: {
    chunkTargetSeconds: int(process.env.CHUNK_TARGET_SECONDS, 600),
    transcribeConcurrency: int(process.env.TRANSCRIBE_CONCURRENCY, 4),
    maxUploadBytes: int(process.env.MAX_UPLOAD_MB, 500) * 1024 * 1024,
    // Opus mono a 16 kHz: todos los motores ASR remuestrean a esto de todos
    // modos, asi que comprimir aqui no cuesta precision y divide el tamano
    // del archivo entre ~8.
    sampleRate: 16000,
    bitrate: '16k',
  },

  worker: {
    concurrency: int(process.env.WORKER_CONCURRENCY, 2),
  },
};

export function ensureDirs() {
  for (const dir of [config.paths.data, config.paths.uploads, config.paths.work]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Errores de configuracion que impiden arrancar. */
export function validateConfig() {
  const problems = [];
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    problems.push(
      'SESSION_SECRET falta o es demasiado corto (min. 32 caracteres). Genera uno con: openssl rand -hex 32',
    );
  }
  const hasKey = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'].some((k) =>
    process.env[k]?.trim(),
  );
  if (!hasKey) {
    problems.push('No hay ninguna clave de proveedor configurada (GROQ_API_KEY, OPENAI_API_KEY o GEMINI_API_KEY).');
  }
  // Un codigo corto no protege de nada: se adivina a fuerza de intentos y deja
  // el registro abierto de hecho. Mejor no arrancar que dar esa falsa sensacion.
  if (config.signup.code && config.signup.code.length < 8) {
    problems.push('SIGNUP_CODE es demasiado corto (min. 8 caracteres). Dejalo vacio para cerrar el registro.');
  }
  return problems;
}
