import fs from 'node:fs/promises';
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold, ThinkingLevel } from '@google/genai';

/**
 * Motor Gemini sobre el SDK unificado `@google/genai`.
 *
 * Tres diferencias frente a la version anterior, que usaba el SDK
 * `@google/generative-ai` (fin de soporte el 30-nov-2025):
 *
 *  1. El audio va en linea (base64) en lugar de subirse con la File API. La
 *     version anterior hacia subir -> generar -> borrar, tres viajes de red
 *     por transcripcion. Como los trozos ya vienen comprimidos a poco mas de
 *     1 MB caben de sobra en el limite de peticion, asi que basta un viaje.
 *  2. Se pide una respuesta con esquema JSON, de modo que los segmentos y los
 *     hablantes llegan estructurados y no hay que adivinarlos parseando texto.
 *  3. Se desactivan los filtros de seguridad configurables y se detecta el
 *     bloqueo del que no lo es. Medido sobre una grabacion real de comite
 *     tecnico, Gemini 3.7 Flash rechazo 2 de 6 fragmentos con
 *     `PROHIBITED_CONTENT`. Poner los umbrales en OFF recupera uno; el otro lo
 *     bloquea el filtro no configurable, y para ese caso el pipeline reintenta
 *     con el modelo de respaldo (ver `pickFallback` en config/models.js).
 */

let client;
function getClient() {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

// Transcribir no es generar: el modelo solo reproduce lo que ya esta en el
// audio. Filtrarlo por contenido solo produce huecos en el acta de una
// reunion perfectamente normal.
const SAFETY_OFF = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.OFF }));

const SEGMENT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          start: { type: Type.NUMBER, description: 'Segundos desde el inicio del audio' },
          end: { type: Type.NUMBER, description: 'Segundos desde el inicio del audio' },
          speaker: { type: Type.STRING, description: 'Etiqueta del hablante, ej. "Hablante 1"' },
          text: { type: Type.STRING },
        },
        required: ['start', 'end', 'text'],
      },
    },
  },
  required: ['segments'],
};

function buildInstruction(language, hint) {
  const lines = [
    'Transcribe este audio de forma literal y completa.',
    'No resumas, no corrijas ni parafrasees: reproduce exactamente lo que se dice.',
    'Divide la transcripcion en segmentos por turno de habla o por pausa natural.',
    'Indica el inicio y el fin de cada segmento en segundos desde el comienzo del audio.',
    'Cuando distingas voces diferentes, etiquetalas de forma consistente como "Hablante 1", "Hablante 2", etc.',
    'No incluyas ningun comentario propio ni texto fuera de la transcripcion.',
  ];
  if (language) lines.push(`El audio esta en ${language}; transcribe en ese idioma.`);
  if (hint) lines.push(`Vocabulario y nombres propios que aparecen en el audio: ${hint.slice(0, 800)}`);
  return lines.join('\n');
}

export async function transcribeChunk({ filePath, entry, language, hint, signal }) {
  const buffer = await fs.readFile(filePath);

  const response = await getClient().models.generateContent({
    model: entry.model,
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildInstruction(language, hint) },
          { inlineData: { mimeType: 'audio/ogg', data: buffer.toString('base64') } },
        ],
      },
    ],
    config: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: SEGMENT_SCHEMA,
      safetySettings: SAFETY_OFF,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      // Presupuesto amplio: Gemini 3.x razona antes de responder y gasta unos
      // 30.000 tokens de pensamiento por fragmento de diez minutos, ademas de
      // la transcripcion. Con el limite por defecto la respuesta se cortaba.
      maxOutputTokens: 65536,
      abortSignal: signal,
    },
  });

  // Una respuesta sin texto casi nunca es un fallo de red: es el filtro de
  // contenido. Se marca con un codigo para que el pipeline pueda reintentar
  // con otro modelo en vez de dar el trabajo por perdido.
  if (!response.text) {
    const blockReason = response.promptFeedback?.blockReason;
    const finishReason = response.candidates?.[0]?.finishReason;
    const error = new Error(
      blockReason
        ? `Gemini bloqueo este fragmento por su filtro de contenido (${blockReason}).`
        : `Gemini no devolvio texto para este fragmento (motivo: ${finishReason ?? 'desconocido'}).`,
    );
    error.code = blockReason ? 'BLOCKED' : 'EMPTY_RESPONSE';
    throw error;
  }

  const parsed = JSON.parse(response.text);
  const segments = (parsed.segments ?? [])
    .map((s) => ({
      start: Number(s.start ?? 0),
      end: Number(s.end ?? 0),
      text: String(s.text ?? '').trim(),
      speaker: s.speaker?.trim() || null,
    }))
    .filter((s) => s.text);

  return {
    text: segments.map((s) => s.text).join(' '),
    segments,
    language: language ?? null,
  };
}

export async function* streamChat({ entry, system, user, signal }) {
  const stream = await getClient().models.generateContentStream({
    model: entry.model,
    contents: [{ role: 'user', parts: [{ text: user }] }],
    config: {
      systemInstruction: system,
      temperature: 0.1,
      safetySettings: SAFETY_OFF,
      abortSignal: signal,
    },
  });

  for await (const chunk of stream) {
    if (chunk.text) yield chunk.text;
  }
}
