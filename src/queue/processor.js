import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { jobs, transcripts } from '../db/index.js';
import { runPipeline, cleanupWorkDir } from '../pipeline.js';

/**
 * Huella de todo lo que determina el resultado de una transcripcion.
 *
 * Incluye idioma y vocabulario, no solo el audio y el modelo: son parametros
 * que cambian el texto que devuelve el proveedor. Cuando la clave solo miraba
 * audio y modelo, subir el mismo archivo despues de elegir el idioma devolvia
 * la transcripcion anterior y el cambio no tenia ningun efecto visible.
 *
 * El separador `|` no puede aparecer dentro de un hash ni de un identificador
 * de modelo, asi que dos combinaciones distintas no pueden producir la misma
 * cadena.
 */
function cacheKeyFor({ audioSha256, asrModelId, language, hint }) {
  const partes = [audioSha256, asrModelId, language ?? '', hint ?? ''];
  return crypto.createHash('sha256').update(partes.join('|')).digest('hex');
}

/**
 * Procesa un trabajo de transcripcion.
 *
 * Toda la logica de audio vive en el pipeline; aqui solo se traduce su
 * progreso a la base de datos y se guarda el resultado. La consulta de cache
 * se pasa como enganche (`onCacheCheck`) en lugar de hacerse antes de llamar
 * al pipeline, porque el hash del audio se calcula dentro.
 *
 * La limpieza de temporales vive en el `finally`. La version anterior borraba
 * el archivo subido a media funcion, de modo que cualquier error dejaba
 * basura en disco: al revisar el proyecto habia un huerfano de 21 MB de
 * septiembre de 2025.
 */
export async function processJob({ jobId, inputPath, asrModelId, language, hint }) {
  const workDir = path.join(config.paths.work, jobId);
  let cacheKey = null;

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
        cacheKey = cacheKeyFor({ audioSha256: sha, asrModelId, language, hint });
        const hit = transcripts.findCached(cacheKey);
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
      cacheKey:
        cacheKey ?? cacheKeyFor({ audioSha256: result.audioSha256, asrModelId, language, hint }),
    });

    jobs.finish(jobId, {
      durationSeconds: result.durationSeconds,
      costEstimate: result.costEstimate,
      elapsedMs: result.elapsedMs,
      chunkCount: result.chunkCount,
      fellBack: result.fellBack,
    });

    const seconds = result.elapsedMs / 1000;
    console.log(
      `[trabajo ${jobId}] ${Math.round(result.durationSeconds / 60)} min de audio en ` +
        `${seconds.toFixed(1)} s (${(result.durationSeconds / seconds).toFixed(0)}x tiempo real` +
        (result.fromCache ? ', reutilizada de la cache' : `, ${result.chunkCount} fragmentos`) +
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

export { cacheKeyFor };
