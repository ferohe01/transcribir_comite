import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from '../config/index.js';
import { jobs, transcripts } from '../db/index.js';
import { runPipeline, cleanupWorkDir } from '../pipeline.js';

/**
 * Procesa un trabajo de transcripcion.
 *
 * Toda la logica de audio vive en el pipeline; aqui solo se traduce su
 * progreso a la base de datos y se guarda el resultado. La consulta de cache
 * se pasa como enganche (`onCacheCheck`) en lugar de hacerse antes de llamar
 * al pipeline: el hash que identifica el audio solo existe una vez
 * comprimido, y comprimirlo aparte significaria hacerlo dos veces (25 s
 * tirados en una grabacion de una hora).
 *
 * La limpieza de temporales vive en el `finally`. La version anterior borraba
 * el archivo subido a media funcion, de modo que cualquier error dejaba
 * basura en disco: al revisar el proyecto habia un huerfano de 21 MB de
 * septiembre de 2025.
 */
export async function processJob({ jobId, inputPath, asrModelId, language, hint }) {
  const workDir = path.join(config.paths.work, jobId);

  try {
    jobs.updateProgress(jobId, { status: 'running', stage: 'probing', progress: 0, detail: '' });

    const result = await runPipeline({
      inputPath,
      workDir,
      asrModelId,
      language,
      hint,
      onProgress: ({ stage, percent, detail }) => {
        jobs.updateProgress(jobId, { stage, progress: percent, detail });
      },
      onCacheCheck: (sha) => {
        const hit = transcripts.findCached(sha, asrModelId);
        if (!hit) return null;
        return {
          text: hit.text,
          formatted: hit.formatted,
          segments: JSON.parse(hit.segments_json ?? '[]'),
          language: hit.language,
        };
      },
    });

    transcripts.create({
      jobId,
      text: result.text,
      formatted: result.formatted,
      segmentsJson: JSON.stringify(result.segments),
      language: result.language,
      audioSha256: result.audioSha256,
      asrModel: asrModelId,
    });

    jobs.finish(jobId, {
      durationSeconds: result.durationSeconds,
      costEstimate: result.costEstimate,
      elapsedMs: result.elapsedMs,
      chunkCount: result.chunkCount,
    });

    const seconds = result.elapsedMs / 1000;
    console.log(
      `[trabajo ${jobId}] ${Math.round(result.durationSeconds / 60)} min de audio en ` +
        `${seconds.toFixed(1)} s (${(result.durationSeconds / seconds).toFixed(0)}x tiempo real` +
        (result.fromCache
          ? ', reutilizada de la cache'
          : `, ${result.chunkCount} fragmentos`) +
        (result.fellBack.length > 0 ? `, ${result.fellBack.length} con modelo de respaldo` : '') +
        ')',
    );

    return result;
  } catch (error) {
    jobs.fail(jobId, error.message);
    throw error;
  } finally {
    await cleanupWorkDir(workDir);
    await fs.rm(inputPath, { force: true }).catch(() => {});
  }
}
