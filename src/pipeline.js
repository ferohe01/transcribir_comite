import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from './config/index.js';
import { getAsrModel, pickFallback } from './config/models.js';
import { probe } from './audio/probe.js';
import { prepareChunks, hashFile } from './audio/prepare.js';
import { mergeResults, formatWithTimestamps } from './audio/merge.js';
import { getEngine, mapWithConcurrency } from './engines/index.js';

/**
 * Pipeline completo: analizar -> preparar -> transcribir -> fusionar.
 *
 * El progreso que se reporta es real (fragmentos comprimidos, fragmentos
 * transcritos), no una animacion temporizada como en la version anterior.
 * Los porcentajes de cada etapa reflejan su peso medido: con Groq, preparar
 * el audio pesa mas que transcribirlo.
 */
const STAGES = {
  probing: { from: 0, to: 5, label: 'Analizando el audio' },
  preparing: { from: 5, to: 40, label: 'Preparando el audio' },
  transcribing: { from: 40, to: 95, label: 'Transcribiendo' },
  merging: { from: 95, to: 100, label: 'Uniendo resultados' },
};

export async function runPipeline({
  inputPath,
  workDir,
  asrModelId,
  language = null,
  hint = null,
  onProgress = () => {},
  // Se invoca con el SHA-256 del audio de entrada. Si devuelve algo, ese
  // resultado se da por bueno y no se transcribe nada.
  onCacheCheck = null,
  signal,
}) {
  const entry = getAsrModel(asrModelId);
  const engine = getEngine(entry.engine);
  const started = Date.now();

  const report = (stage, fraction = 0, detail = '') => {
    const { from, to, label } = STAGES[stage];
    onProgress({
      stage,
      label,
      detail,
      percent: Math.round(from + (to - from) * Math.min(1, Math.max(0, fraction))),
    });
  };

  await fs.mkdir(workDir, { recursive: true });

  // --- 1. Analizar y consultar la cache ----------------------------------
  report('probing', 0);
  const source = await probe(inputPath);
  const audioSha256 = await hashFile(inputPath);
  report('probing', 1, `${Math.round(source.durationSeconds / 60)} min de audio`);

  const cached = onCacheCheck ? await onCacheCheck(audioSha256) : null;
  if (cached) {
    report('merging', 1, 'Reutilizada de una transcripcion anterior');
    return {
      ...cached,
      audioSha256,
      durationSeconds: source.durationSeconds,
      chunkCount: 0,
      fellBack: [],
      fromCache: true,
      elapsedMs: Date.now() - started,
      costEstimate: 0,
      compression: { originalBytes: source.sizeBytes, normalizedBytes: 0, ratio: 1 },
    };
  }

  // --- 2. Preparar: detectar pausas, planificar cortes y comprimir -------
  report('preparing', 0);
  const prepared = await prepareChunks(inputPath, path.join(workDir, 'chunks'), {
    durationSeconds: source.durationSeconds,
    signal,
    onProgress: ({ fraction, detail }) => report('preparing', fraction, detail),
  });
  const { chunks } = prepared;
  report(
    'preparing',
    1,
    `${(source.sizeBytes / 1048576).toFixed(1)} MB -> ${(prepared.totalBytes / 1048576).toFixed(1)} MB ` +
      `en ${chunks.length} fragmento(s)`,
  );

  // --- 3. Transcribir en paralelo ---------------------------------------
  let done = 0;
  const fallbackId = pickFallback(asrModelId);
  const fellBack = [];
  report('transcribing', 0, `0 / ${chunks.length} fragmentos`);

  const results = await mapWithConcurrency(
    chunks,
    Math.min(config.audio.transcribeConcurrency, chunks.length),
    async (chunk) => {
      let result;
      try {
        result = await engine.transcribeChunk({
          filePath: chunk.path,
          entry,
          language,
          hint,
          signal,
          // Un limite de uso del proveedor no debe verse como una barra
          // congelada: se dice cuanto se espera y por que.
          onRetry: ({ delayMs, rateLimited }) => {
            report(
              'transcribing',
              done / chunks.length,
              rateLimited
                ? `Limite de uso del proveedor: reintentando en ${Math.round(delayMs / 1000)} s`
                : `Reintentando en ${Math.round(delayMs / 1000)} s`,
            );
          },
        });
      } catch (error) {
        // Un fragmento rechazado por el filtro de contenido no es un fallo del
        // pipeline: otro modelo suele aceptarlo. Perder una hora de trabajo
        // porque un minuto de audio le parecio sospechoso a un filtro no es
        // aceptable.
        const recoverable = error.code === 'BLOCKED' || error.code === 'EMPTY_RESPONSE';
        if (!recoverable || !fallbackId) throw error;

        const fallbackEntry = getAsrModel(fallbackId);
        result = await getEngine(fallbackEntry.engine).transcribeChunk({
          filePath: chunk.path,
          entry: fallbackEntry,
          language,
          hint,
          signal,
        });
        fellBack.push({ index: chunk.index, reason: error.code, usedModel: fallbackId });
      }

      done += 1;
      report('transcribing', done / chunks.length, `${done} / ${chunks.length} fragmentos`);
      return {
        ...result,
        index: chunk.index,
        offsetSeconds: chunk.offsetSeconds,
        durationSeconds: chunk.durationSeconds,
      };
    },
  );

  // --- 4. Fusionar -------------------------------------------------------
  report('merging', 0);
  const merged = mergeResults(results);
  report('merging', 1, 'Listo');

  return {
    text: merged.text,
    segments: merged.segments,
    formatted: formatWithTimestamps(merged),
    language: results.find((r) => r.language)?.language ?? language ?? null,
    audioSha256,
    durationSeconds: source.durationSeconds,
    chunkCount: chunks.length,
    fellBack,
    fromCache: false,
    elapsedMs: Date.now() - started,
    costEstimate: entry.costPerMinute ? (source.durationSeconds / 60) * entry.costPerMinute : null,
    compression: {
      originalBytes: source.sizeBytes,
      normalizedBytes: prepared.totalBytes,
      ratio: prepared.totalBytes > 0 ? source.sizeBytes / prepared.totalBytes : 1,
    },
  };
}

/** Borra el directorio de trabajo. Se llama siempre, haya fallado o no. */
export async function cleanupWorkDir(workDir) {
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
}
