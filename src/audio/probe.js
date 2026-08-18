import { ffprobe } from './ffmpeg.js';

/**
 * Inspecciona un archivo con ffprobe. Sustituye a la validacion por mimetype
 * de la version anterior, que dejaba pasar cualquier `video/mp4` porque
 * comparaba con `mimetype.includes('mp4')`. Aqui se comprueba que el archivo
 * contenga realmente una pista de audio decodificable.
 */
export async function probe(filePath) {
  const { stdout } = await ffprobe([
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);

  const info = JSON.parse(stdout);
  const audio = info.streams?.find((s) => s.codec_type === 'audio');
  if (!audio) {
    throw new Error('El archivo no contiene ninguna pista de audio reconocible.');
  }

  const duration = Number.parseFloat(info.format?.duration ?? audio.duration ?? '0');
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('No se pudo determinar la duracion del audio: puede estar corrupto.');
  }

  return {
    durationSeconds: duration,
    sizeBytes: Number.parseInt(info.format?.size ?? '0', 10),
    codec: audio.codec_name,
    channels: audio.channels,
    sampleRate: Number.parseInt(audio.sample_rate ?? '0', 10),
    formatName: info.format?.format_name ?? null,
  };
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
