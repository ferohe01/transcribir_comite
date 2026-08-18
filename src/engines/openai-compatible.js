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
  return async function transcribeChunk({ filePath, entry, language, hint, signal, onRetry, maxWaitMs }) {
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
      { provider: providerName, signal, onRetry, maxTotalWaitMs: maxWaitMs },
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
          // Las plantillas piden texto fiel a la transcripcion (la de
          // evaluacion exige los comentarios literales), asi que se baja la
          // temperatura igual que en Gemini y que en la version anterior.
          // Los modelos que solo admiten su valor por defecto se quedan sin
          // el parametro: mandarselo es un 400, no una respuesta mas creativa.
          ...(entry.fixedTemperature ? {} : { temperature: 0.1 }),
          // Una plantilla sobre una transcripcion de una hora produce miles de
          // tokens: sin margen explicito el modelo se corta a media respuesta.
          ...(entry.maxOutputTokens ? { max_completion_tokens: entry.maxOutputTokens } : {}),
          stream: true,
        }),
      },
      { provider: providerName, signal },
    );

    // Los eventos SSE pueden partirse entre paquetes TCP, asi que se acumula
    // en un buffer y solo se procesan las lineas completas.
    let buffer = '';
    let emitted = 0;
    let finishReason = null;

    for await (const bytes of response.body) {
      buffer += new TextDecoder().decode(bytes, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const choice = JSON.parse(data).choices?.[0];
          finishReason = choice?.finish_reason ?? finishReason;
          const delta = choice?.delta?.content;
          if (delta) {
            emitted += delta.length;
            yield delta;
          }
        } catch {
          // Fragmento incompleto: se ignora, llegara entero en el siguiente.
        }
      }
    }

    // Una respuesta vacia con HTTP 200 es un fallo real: normalmente el
    // modelo agoto su limite de salida razonando y no llego a escribir nada.
    // Sin esto la pantalla mostraba un resultado en blanco junto al aviso de
    // "Plantilla aplicada".
    if (emitted === 0) {
      throw new Error(
        finishReason === 'length'
          ? `${providerName}: el modelo agoto su limite de salida antes de escribir la respuesta. ` +
            'Prueba con otro modelo o con una transcripcion mas corta.'
          : `${providerName}: el modelo no devolvio texto.`,
      );
    }
  };
}
