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

  // Cuanto esperar a que un proveedor saturado se recupere antes de pasar al
  // de respaldo. Con alternativa disponible no compensa esperar: medido sobre
  // la grabacion de una hora, aguantar el `Retry-After` de Groq costaba 278 s,
  // frente a los ~40 s de cambiar de motor. Sin alternativa si merece la pena
  // esperar, porque lo unico que hay al otro lado es perder el trabajo.
  const maxWaitMs = fallbackId ? 15_000 : 150_000;
  report('transcribing', 0, `0 / ${chunks.length} fragmentos`);

  const results = await mapWithConcurrency(
    chunks,
    Math.min(config.audio.transcribeConcurrency, chunks.length),
    async (chunk) => {
      let result;
      let usado = entry;
      try {
        result = await engine.transcribeChunk({
          filePath: chunk.path,
          entry,
          language,
          hint,
          signal,
          maxWaitMs,
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
        // Hay dos fallos que no son culpa del audio ni del pipeline, y que
        // otro proveedor resuelve sin mas:
        //
        //  - el filtro de contenido de Gemini, que rechaza grabaciones de
        //    reunion perfectamente normales;
        //  - haber agotado la cuota del proveedor, que en los planes
        //    gratuitos llega enseguida (Groq permite 7.200 s de audio por
        //    hora).
        //
        // En ambos casos, tirar a la basura una transcripcion de una hora
        // teniendo otro motor configurado y libre no tiene sentido.
        const motivo = error.code ?? (error.rateLimited ? 'RATE_LIMITED' : null);
        const recuperable = motivo === 'BLOCKED' || motivo === 'EMPTY_RESPONSE' || motivo === 'RATE_LIMITED';
        if (!recuperable || !fallbackId) throw error;

        const fallbackEntry = getAsrModel(fallbackId);
        result = await getEngine(fallbackEntry.engine).transcribeChunk({
          filePath: chunk.path,
          entry: fallbackEntry,
          language,
          hint,
          signal,
        });
        usado = fallbackEntry;
        fellBack.push({ index: chunk.index, reason: motivo, usedModel: fallbackId });
      }

      done += 1;
      report('transcribing', done / chunks.length, `${done} / ${chunks.length} fragmentos`);
      return {
        ...result,
        index: chunk.index,
        offsetSeconds: chunk.offsetSeconds,
        durationSeconds: chunk.durationSeconds,
        costPerMinute: usado.costPerMinute ?? null,
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
    // Se suma fragmento a fragmento con la tarifa del modelo que lo atendio:
    // si alguno se fue al de respaldo, su precio es otro.
    costEstimate: results.reduce(
      (total, r) => total + ((r.durationSeconds ?? 0) / 60) * (r.costPerMinute ?? 0),
      0,
    ),
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
