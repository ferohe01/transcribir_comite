/**
 * Catalogo declarativo de motores y modelos.
 *
 * Sustituye al `switch (llm)` hardcodeado de la version anterior: anadir un
 * modelo es anadir una entrada aqui. Este mismo catalogo alimenta el
 * desplegable del frontend (via GET /api/models) y el router del backend.
 *
 * Los IDs de Gemini estan verificados contra el listado real de la API
 * (agosto 2026). Los de OpenAI y Groq provienen de la documentacion de cada
 * proveedor; `npm run check-models` los valida contra las APIs en vivo y
 * avisa de cualquiera que ya no exista.
 */

/** Motores de transcripcion (audio -> texto). */
export const ASR_MODELS = {
  'groq-whisper-turbo': {
    label: 'Groq · Whisper Large v3 Turbo',
    hint: 'El mas rapido y el mas barato. Recomendado.',
    engine: 'groq',
    model: 'whisper-large-v3-turbo',
    envKey: 'GROQ_API_KEY',
    costPerMinute: 0.00067,
    maxChunkBytes: 24 * 1024 * 1024,
    timestamps: true,
    diarization: false,
    recommended: true,
  },
  'groq-whisper-v3': {
    label: 'Groq · Whisper Large v3',
    hint: 'Algo mas lento que Turbo, mejor con audio dificil.',
    engine: 'groq',
    model: 'whisper-large-v3',
    envKey: 'GROQ_API_KEY',
    costPerMinute: 0.00185,
    maxChunkBytes: 24 * 1024 * 1024,
    timestamps: true,
    diarization: false,
  },
  'openai-transcribe-v2': {
    label: 'OpenAI · GPT Transcribe',
    hint: 'El que OpenAI recomienda para transcribir archivos.',
    engine: 'openai',
    model: 'gpt-transcribe',
    envKey: 'OPENAI_API_KEY',
    costPerMinute: 0.0045,
    maxChunkBytes: 24 * 1024 * 1024,
    timestamps: false,
    diarization: false,
  },
  'openai-mini-transcribe': {
    label: 'OpenAI · GPT-4o mini Transcribe',
    hint: 'Buena relacion calidad/precio.',
    engine: 'openai',
    model: 'gpt-4o-mini-transcribe',
    envKey: 'OPENAI_API_KEY',
    costPerMinute: 0.003,
    maxChunkBytes: 24 * 1024 * 1024,
    timestamps: false, // este modelo solo devuelve json/texto, sin segmentos
    diarization: false,
  },
  'openai-transcribe': {
    label: 'OpenAI · GPT-4o Transcribe',
    hint: 'Maxima precision de OpenAI.',
    engine: 'openai',
    model: 'gpt-4o-transcribe',
    envKey: 'OPENAI_API_KEY',
    costPerMinute: 0.006,
    maxChunkBytes: 24 * 1024 * 1024,
    timestamps: false,
    diarization: false,
  },
  'openai-transcribe-diarize': {
    label: 'OpenAI · GPT-4o Transcribe (con hablantes)',
    hint: 'Identifica quien habla en cada momento.',
    engine: 'openai',
    model: 'gpt-4o-transcribe-diarize',
    envKey: 'OPENAI_API_KEY',
    costPerMinute: 0.006,
    maxChunkBytes: 24 * 1024 * 1024,
    timestamps: true,
    diarization: true,
  },
  'openai-whisper-1': {
    label: 'OpenAI · Whisper-1 (legacy)',
    hint: 'El modelo que usaba la version anterior. Solo para comparar.',
    engine: 'openai',
    model: 'whisper-1',
    envKey: 'OPENAI_API_KEY',
    costPerMinute: 0.006,
    maxChunkBytes: 24 * 1024 * 1024,
    timestamps: true,
    diarization: false,
    deprecated: true,
  },
  'gemini-flash': {
    label: 'Google · Gemini 3.7 Flash',
    hint: 'Entiende el contexto del audio, no solo las palabras.',
    engine: 'gemini',
    model: 'gemini-3.7-flash',
    envKey: 'GEMINI_API_KEY',
    costPerMinute: 0.001,
    maxChunkBytes: 18 * 1024 * 1024,
    timestamps: true,
    diarization: true,
  },
  'gemini-pro': {
    label: 'Google · Gemini 3.1 Pro',
    hint: 'La mayor precision en audio complejo o con jerga tecnica.',
    engine: 'gemini',
    model: 'gemini-3.1-pro-preview',
    envKey: 'GEMINI_API_KEY',
    costPerMinute: 0.005,
    maxChunkBytes: 18 * 1024 * 1024,
    timestamps: true,
    diarization: true,
  },
};

/** Modelos de lenguaje para la fase de post-proceso con plantillas. */
export const LLM_MODELS = {
  'gemini-flash': {
    label: 'Google · Gemini 3.7 Flash',
    engine: 'gemini',
    model: 'gemini-3.7-flash',
    envKey: 'GEMINI_API_KEY',
    recommended: true,
  },
  'gemini-pro': {
    label: 'Google · Gemini 3.1 Pro',
    engine: 'gemini',
    model: 'gemini-3.1-pro-preview',
    envKey: 'GEMINI_API_KEY',
  },
  // La familia GPT-5 solo acepta la temperatura por defecto: enviarle un 0.1
  // no baja la creatividad, devuelve un 400 y tumba la peticion entera.
  'openai-gpt5': {
    label: 'OpenAI · GPT-5.5',
    engine: 'openai',
    model: 'gpt-5.5',
    envKey: 'OPENAI_API_KEY',
    fixedTemperature: true,
  },
  'openai-gpt5-mini': {
    label: 'OpenAI · GPT-5 mini',
    engine: 'openai',
    model: 'gpt-5-mini',
    envKey: 'OPENAI_API_KEY',
    fixedTemperature: true,
  },
  // Comprobado contra la API el 2026-08-19: rechaza `temperature` igual que el
  // resto de la familia GPT-5, de ahi fixedTemperature.
  'openai-luna': {
    label: 'OpenAI · GPT-5.6 Luna',
    engine: 'openai',
    model: 'gpt-5.6-luna',
    envKey: 'OPENAI_API_KEY',
    fixedTemperature: true,
  },
  // Los GPT-OSS razonan antes de responder y ese razonamiento gasta el mismo
  // presupuesto de salida. Con el limite por defecto (3072 tokens) se lo
  // gastaban entero pensando y devolvian texto vacio con finish_reason
  // 'length' sobre una transcripcion de una hora, asi que se les da margen.
  'groq-gpt-oss-120b': {
    label: 'Groq · GPT-OSS 120B',
    engine: 'groq',
    model: 'openai/gpt-oss-120b',
    envKey: 'GROQ_API_KEY',
    maxOutputTokens: 32768,
  },
  'groq-gpt-oss-20b': {
    label: 'Groq · GPT-OSS 20B',
    engine: 'groq',
    model: 'openai/gpt-oss-20b',
    envKey: 'GROQ_API_KEY',
    maxOutputTokens: 32768,
  },
};

export const DEFAULT_ASR = 'groq-whisper-turbo';
export const DEFAULT_LLM = 'gemini-flash';

/** Un modelo esta disponible si su clave de API esta configurada. */
export function isAvailable(entry) {
  return Boolean(process.env[entry.envKey]?.trim());
}

/**
 * Catalogo filtrado por las claves realmente configuradas, listo para el
 * frontend. Nunca expone las claves, solo si estan presentes.
 */
export function availableModels() {
  const pick = (catalog) =>
    Object.entries(catalog)
      .filter(([, e]) => isAvailable(e))
      .map(([id, e]) => ({
        id,
        label: e.label,
        hint: e.hint ?? null,
        engine: e.engine,
        costPerMinute: e.costPerMinute ?? null,
        diarization: e.diarization ?? false,
        timestamps: e.timestamps ?? false,
        recommended: e.recommended ?? false,
        deprecated: e.deprecated ?? false,
      }));

  const asr = pick(ASR_MODELS);
  const llm = pick(LLM_MODELS);
  return {
    asr,
    llm,
    defaultAsr: asr.find((m) => m.id === DEFAULT_ASR)?.id ?? asr[0]?.id ?? null,
    defaultLlm: llm.find((m) => m.id === DEFAULT_LLM)?.id ?? llm[0]?.id ?? null,
  };
}

export function getAsrModel(id) {
  const entry = ASR_MODELS[id];
  if (!entry) throw new Error(`Modelo de transcripcion desconocido: ${id}`);
  if (!isAvailable(entry)) {
    throw new Error(`Falta la clave ${entry.envKey} para usar ${entry.label}`);
  }
  return entry;
}

/**
 * Elige un modelo de respaldo para un fragmento que fallo.
 *
 * Existe por un problema real y medido: el filtro de contenido de Gemini
 * rechaza fragmentos de audio perfectamente normales (2 de 6 en una grabacion
 * de comite tecnico) y no hay ajuste que lo evite del todo. Se prefiere un
 * motor distinto -- Groq y OpenAI no filtran las transcripciones por
 * contenido -- y, si no hay otro proveedor configurado, otro modelo del mismo.
 */
export function pickFallback(currentId) {
  const current = ASR_MODELS[currentId];
  if (!current) return null;

  const candidates = Object.entries(ASR_MODELS).filter(
    ([id, entry]) => id !== currentId && !entry.deprecated && isAvailable(entry),
  );

  const otherEngine = candidates.find(([, entry]) => entry.engine !== current.engine);
  if (otherEngine) return otherEngine[0];

  const sameEngine = candidates.find(([, entry]) => entry.model !== current.model);
  return sameEngine ? sameEngine[0] : null;
}

export function getLlmModel(id) {
  const entry = LLM_MODELS[id];
  if (!entry) throw new Error(`Modelo de lenguaje desconocido: ${id}`);
  if (!isAvailable(entry)) {
    throw new Error(`Falta la clave ${entry.envKey} para usar ${entry.label}`);
  }
  return entry;
}
