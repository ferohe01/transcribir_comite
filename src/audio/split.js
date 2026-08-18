import { ffmpeg } from './ffmpeg.js';
import { config } from '../config/index.js';

/**
 * Localiza los silencios con el filtro `silencedetect` de ffmpeg.
 *
 * Se ejecuta con `-f null -`: solo decodifica, no codifica nada. Sobre una
 * grabacion de una hora son 2,4 s, frente a los 22 s que costaba hacerlo de
 * paso mientras se comprimia. Esa diferencia es la que permite comprimir
 * despues en paralelo.
 *
 * Devuelve el punto medio de cada silencio, que es donde conviene cortar.
 */
export async function detectSilences(filePath, { noiseDb = -32, minDuration = 0.4, signal } = {}) {
  const { stderr } = await ffmpeg(
    ['-i', filePath, '-af', `silencedetect=noise=${noiseDb}dB:d=${minDuration}`, '-f', 'null', '-'],
    { signal },
  );

  const silences = [];
  let start = null;
  for (const line of stderr.split('\n')) {
    const startMatch = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (startMatch) {
      start = Number.parseFloat(startMatch[1]);
      continue;
    }
    const endMatch = /silence_end:\s*([\d.]+)/.exec(line);
    if (endMatch && start !== null) {
      const end = Number.parseFloat(endMatch[1]);
      silences.push({ start, end, middle: (start + end) / 2 });
      start = null;
    }
  }
  return silences;
}

/**
 * Decide los puntos de corte.
 *
 * Recorre el audio buscando, cada `targetSeconds`, el silencio mas cercano al
 * punto ideal dentro de una ventana de tolerancia. Cortar en un silencio y no
 * a ciegas evita partir una palabra por la mitad, que es la causa tipica de
 * texto corrupto en la union entre trozos. Si en toda la ventana no hay
 * ningun silencio (musica de fondo continua, por ejemplo) se corta en seco en
 * el punto ideal: mejor una costura imperfecta que un trozo gigante.
 */
export function planCuts(durationSeconds, silences, targetSeconds = config.audio.chunkTargetSeconds) {
  if (durationSeconds <= targetSeconds * 1.25) {
    return [{ start: 0, end: durationSeconds }];
  }

  const tolerance = targetSeconds * 0.35;
  const minChunk = targetSeconds * 0.25;
  const cuts = [];
  let position = 0;

  while (durationSeconds - position > targetSeconds * 1.25) {
    const ideal = position + targetSeconds;
    const candidates = silences.filter(
      (s) => s.middle > position + minChunk && Math.abs(s.middle - ideal) <= tolerance,
    );

    let cut = ideal;
    if (candidates.length > 0) {
      cut = candidates.reduce((best, s) =>
        Math.abs(s.middle - ideal) < Math.abs(best.middle - ideal) ? s : best,
      ).middle;
    }

    cuts.push({ start: position, end: cut });
    position = cut;
  }

  cuts.push({ start: position, end: durationSeconds });
  return cuts;
}
