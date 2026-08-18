/**
 * Punto de entrada del worker independiente (servicio `worker` de Docker).
 *
 * Vive en su propio proceso para que una transcripcion pesada no compita por
 * el bucle de eventos con el servidor web: la interfaz sigue respondiendo al
 * instante aunque haya seis fragmentos de audio en vuelo.
 */
import { config, ensureDirs } from '../config/index.js';
import { getDb, jobs } from '../db/index.js';
import { startWorker, usesRedis } from './index.js';
import { processJob } from './processor.js';
import { checkFfmpeg } from '../audio/ffmpeg.js';

const ffmpegStatus = await checkFfmpeg();
if (!ffmpegStatus.ok) {
  console.error('[worker] ffmpeg no esta disponible:', ffmpegStatus.error);
  process.exit(1);
}

ensureDirs();
getDb();

// Trabajos que quedaron a medias en un reinicio anterior.
const stale = jobs.markStaleAsError();
if (stale > 0) console.log(`[worker] ${stale} trabajo(s) interrumpido(s) marcado(s) como fallidos`);

const worker = await startWorker(processJob);

console.log(`[worker] escuchando (${usesRedis ? 'redis' : 'en proceso'}), concurrencia ${config.worker.concurrency}`);
console.log(`[worker] ${ffmpegStatus.version}`);

const shutdown = async (signal) => {
  console.log(`[worker] ${signal} recibido, cerrando...`);
  await worker?.close();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
