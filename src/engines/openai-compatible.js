import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchWithRetry } from './http.js';

/**
 * Motor comun para OpenAI y Groq: Groq expone deliberadamente la misma API de
 * audio que OpenAI, asi que un solo cliente sirve para ambos y solo cambian la
 * URL base y la clave.
 *
 * El formato de respuesta depende del modelo:
 *  - whisper-*            -> `verbose_json`, con segmentos y marcas de tiempo
 *  - gpt-4o-*-transcribe  -> solo `json`, texto plano sin segmentos
 *  - *-diarize            -> `diarized_json`, con segmentos e identidad de hablante
 * Elegir mal el formato devuelve un 400, de ahi que se decida a partir de las
 * capacidades declaradas en el catalogo y no por el nombre del modelo.
 */
function responseFormatFor(entry) {
  if (entry.diarization) return 'diarized_json';
  if (entry.timestamps) return 'verbose_json';
  return 'json';
}

function parseSegments(payload) {
  const raw = payload.segments ?? payload.chunks ?? [];
  return raw
    .map((s) => ({
      start: Number(s.start ?? s.start_time ?? 0),
      end: Number(s.end ?? s.end_time ?? 0),
      text: String(s.text ?? '').trim(),
      speaker: s.speaker ?? s.speaker_label ?? null,
    }))
    .filter((s) => s.text);
}

export function createOpenAiCompatibleEngine({ baseUrl, providerName }) {
  return async function transcribeChunk({ filePath, entry, language, hint, signal, onRetry }) {
    const buffer = await fs.readFile(filePath);
    const form = new FormData();

    form.append('file', new Blob([buffer], { type: 'audio/ogg' }), path.basename(filePath));
    form.append('model', entry.model);
    form.append('response_format', responseFormatFor(entry));
    if (language) form.append('language', language);
    // El `prompt` de la API de audio es una pista de vocabulario (nombres
    // propios, siglas), no una instruccion. La version anterior aceptaba este
    // valor pero nunca lo enviaba.
    if (hint) form.append('prompt', hint.slice(0, 800));

    const response = await fetchWithRetry(
      `${baseUrl}/audio/transcriptions`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env[entry.envKey]}` },
        body: form,
      },
      { provider: providerName, signal, onRetry },
    );

    const payload = await response.json();
    return {
      text: String(payload.text ?? '').trim(),
      segments: parseSegments(payload),
      language: payload.language ?? language ?? null,
    };
  };
}

/** Chat de texto compatible con OpenAI, para la fase de plantillas. */
export function createOpenAiCompatibleChat({ baseUrl, providerName }) {
  return async function* streamChat({ entry, system, user, signal }) {
    const response = await fetchWithRetry(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env[entry.envKey]}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: entry.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          stream: true,
        }),
      },
      { provider: providerName, signal },
    );

    // Los eventos SSE pueden partirse entre paquetes TCP, asi que se acumula
    // en un buffer y solo se procesan las lineas completas.
    let buffer = '';
    for await (const bytes of response.body) {
      buffer += new TextDecoder().decode(bytes, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Fragmento incompleto: se ignora, llegara entero en el siguiente.
        }
      }
    }
  };
}
