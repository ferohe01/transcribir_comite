/**
 * Fusiona los resultados de los trozos en una unica transcripcion.
 *
 * Cada trozo se transcribe con su reloj empezando en cero, asi que hay que
 * desplazar sus marcas de tiempo por el offset del trozo dentro del audio
 * original. Sin esto, todos los trozos dirian "minuto 0".
 *
 * Las marcas se acotan ademas al tramo real de cada trozo. Hace falta porque
 * los modelos multimodales las estiman en lugar de medirlas: en una prueba
 * sobre una grabacion de 1 h 00 min, Gemini devolvio marcas que llegaban hasta
 * 1 h 06 min. Acotarlas mantiene la transcripcion dentro de la duracion real
 * del audio y evita que el error se acumule de un trozo al siguiente. Los
 * motores tipo Whisper (Groq, OpenAI) devuelven marcas exactas del
 * decodificador y no se ven afectados.
 */
export function mergeResults(results) {
  const ordered = [...results].sort((a, b) => a.index - b.index);

  const segments = [];
  const parts = [];

  for (const result of ordered) {
    const offset = result.offsetSeconds ?? 0;
    const limit = result.durationSeconds ?? Infinity;
    const text = (result.text ?? '').trim();
    if (text) parts.push(text);

    const clamp = (value) => offset + Math.min(Math.max(value ?? 0, 0), limit);

    for (const segment of result.segments ?? []) {
      const start = clamp(segment.start);
      segments.push({
        start,
        end: Math.max(start, clamp(segment.end)),
        text: (segment.text ?? '').trim(),
        speaker: segment.speaker ?? null,
      });
    }
  }

  return {
    text: parts.join('\n\n'),
    segments: segments.sort((a, b) => a.start - b.start),
  };
}

const stamp = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

/**
 * Version legible con marcas de tiempo y hablantes. Los segmentos
 * consecutivos del mismo hablante se agrupan para que el texto no quede
 * troceado en lineas de dos palabras.
 */
export function formatWithTimestamps({ text, segments }) {
  if (!segments?.length) return text;

  const blocks = [];
  let current = null;

  for (const segment of segments) {
    const sameSpeaker = current && current.speaker === segment.speaker;
    const closeEnough = current && segment.start - current.end < 2;

    if (sameSpeaker && closeEnough && current.text.length < 400) {
      current.text += ` ${segment.text}`;
      current.end = segment.end;
    } else {
      if (current) blocks.push(current);
      current = { ...segment };
    }
  }
  if (current) blocks.push(current);

  return blocks
    .map((b) => `[${stamp(b.start)}]${b.speaker ? ` ${b.speaker}:` : ''} ${b.text}`)
    .join('\n');
}
