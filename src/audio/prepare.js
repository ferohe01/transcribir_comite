import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import { createReadStream } from 'node:fs';
import { ffmpeg } from './ffmpeg.js';
import { config } from '../config/index.js';
import { detectSilences, planCuts } from './split.js';
import { mapWithConcurrency } from '../engines/http.js';

/**
 * Deja el audio listo para transcribir: fragmentos comprimidos, cortados en
 * silencios y numerados con su desplazamiento dentro del original.
 *
 * El orden de los pasos importa mucho, y esta medido sobre una grabacion real
 * de 1 h 00 min (20,6 MB) en una maquina de 12 nucleos:
 *
 *  1. **Detectar los silencios sin codificar** (`-f null -`): 2,4 s. Hacerlo
 *     durante la codificacion parecia gratis, pero obligaba a que esa
 *     codificacion fuese un unico proceso secuencial de 22 s.
 *  2. **Planificar los cortes** a partir de esos silencios.
 *  3. **Codificar cada fragmento en paralelo**, cada uno con su propio ffmpeg
 *     leyendo solo su tramo: 3,6 s en lugar de 22.
 *
 * En total la preparacion baja de 24,7 s a unos 6 s. Con Groq, que transcribe
 * la hora de audio en menos de 4 s, era el 77 % del tiempo de todo el proceso.
 *
 * Cada fragmento sale en Opus mono a 16 kHz: los motores ASR remuestrean a eso
 * de todos modos, asi que no se pierde precision y se sube un tercio de los
 * bytes.
 */

/** Codifica un tramo del original a un fragmento independiente. */
async function encodeRange(inputPath, cut, index, outDir, signal) {
  const chunkPath = path.join(outDir, `chunk-${String(index).padStart(3, '0')}.ogg`);

  await ffmpeg(
    [
      // La busqueda va antes de -i para que ffmpeg salte directamente al tramo
      // en lugar de decodificar todo lo anterior y descartarlo.
      '-ss', cut.start.toFixed(3),
      '-t', (cut.end - cut.start).toFixed(3),
      '-i', inputPath,
      '-vn',
      '-map', '0:a:0',
      // Corrige marcas de tiempo irregulares (habitual en grabaciones de
      // Teams o Zoom), que si no desalinean los fragmentos.
      '-af', 'aresample=async=1',
      '-ac', '1',
      '-ar', String(config.audio.sampleRate),
      '-c:a', 'libopus',
      '-b:a', config.audio.bitrate,
      '-application', 'voip',
      // El valor por defecto de libopus es 10 y tardaba cuatro veces mas para
      // producir un archivo del mismo tamano (6,59 MB frente a 6,58 MB). A
      // 16 kbps de voz el esfuerzo extra del codificador no compra nada.
      '-compression_level', '0',
      '-y', chunkPath,
    ],
    { signal },
  );

  const stat = await fs.stat(chunkPath);
  return {
    index,
    path: chunkPath,
    offsetSeconds: cut.start,
    durationSeconds: cut.end - cut.start,
    sizeBytes: stat.size,
  };
}

export async function prepareChunks(
  inputPath,
  outDir,
  { durationSeconds, targetSeconds, onProgress, signal } = {},
) {
  const target = targetSeconds ?? config.audio.chunkTargetSeconds;
  await fs.mkdir(outDir, { recursive: true });

  // Un audio corto no se trocea: no hay nada que planificar ni que paralelizar.
  let cuts;
  let silences = [];
  if (durationSeconds <= target * 1.25) {
    cuts = [{ start: 0, end: durationSeconds }];
  } else {
    onProgress?.({ fraction: 0, detail: 'Analizando pausas' });
    silences = await detectSilences(inputPath, { signal });
    cuts = planCuts(durationSeconds, silences, target);
  }

  // Un proceso de ffmpeg por fragmento, hasta el numero de nucleos. libopus
  // codifica en un solo hilo, asi que el paralelismo tiene que venir de
  // ejecutar varios procesos, no de pedirle hilos a uno.
  const concurrency = Math.min(cuts.length, Math.max(2, os.cpus().length - 1));
  let encoded = 0;

  onProgress?.({
    fraction: 0.15,
    detail: `Comprimiendo ${cuts.length} ${cuts.length === 1 ? 'fragmento' : 'fragmentos'}`,
  });

  const chunks = await mapWithConcurrency(cuts, concurrency, async (cut, index) => {
    const chunk = await encodeRange(inputPath, cut, index, outDir, signal);
    encoded += 1;
    onProgress?.({
      fraction: 0.15 + 0.85 * (encoded / cuts.length),
      detail: `${encoded} / ${cuts.length} fragmentos comprimidos`,
    });
    return chunk;
  });

  return {
    chunks,
    silences,
    totalBytes: chunks.reduce((sum, c) => sum + c.sizeBytes, 0),
  };
}

/**
 * SHA-256 del archivo tal y como llego, base de la cache de transcripciones.
 *
 * Se hashea el original y no el audio comprimido por dos razones: el
 * contenedor Ogg lleva un numero de serie aleatorio, asi que comprimir lo
 * mismo dos veces da bytes distintos y el hash nunca coincidiria; y hacerlo
 * sobre el original permite reconocer un archivo repetido sin llegar siquiera
 * a comprimirlo.
 */
export function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}
