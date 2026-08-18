import { config } from '../config/index.js';

/**
 * Cola de trabajos con dos modos:
 *
 *  - **Redis (BullMQ)**, cuando REDIS_URL esta definida: es lo que corre en el
 *    VPS. El worker es un proceso aparte, asi que una transcripcion pesada no
 *    bloquea al servidor web, y los trabajos sobreviven a un reinicio.
 *  - **En proceso**, cuando no lo esta: para desarrollo local sin levantar
 *    Redis. Misma interfaz, cero infraestructura.
 *
 * El progreso NO viaja por la cola: el worker lo escribe en SQLite y el
 * endpoint SSE lo lee de ahi. Asi funciona igual en ambos modos y no hace
 * falta un canal de pub/sub entre procesos.
 */

const QUEUE_NAME = 'transcriptions';
export const usesRedis = Boolean(config.redisUrl && process.env.REDIS_URL);

let queue;
let inProcess;

async function getBullQueue() {
  if (!queue) {
    const { Queue } = await import('bullmq');
    queue = new Queue(QUEUE_NAME, {
      connection: { url: config.redisUrl },
      defaultJobOptions: {
        attempts: 1, // los reintentos de red ya se manejan dentro del pipeline
        removeOnComplete: { age: 24 * 3600, count: 500 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }
  return queue;
}

/** Cola minima en memoria con limite de concurrencia. */
function getInProcessQueue() {
  if (inProcess) return inProcess;

  const pending = [];
  let active = 0;
  let processor = null;

  const pump = () => {
    while (processor && active < config.worker.concurrency && pending.length > 0) {
      const task = pending.shift();
      active += 1;
      Promise.resolve(processor(task))
        .catch((error) => console.error('[cola] trabajo fallido:', error.message))
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  inProcess = {
    add(payload) {
      pending.push(payload);
      pump();
      return Promise.resolve();
    },
    setProcessor(fn) {
      processor = fn;
      pump();
    },
    stats() {
      return { pending: pending.length, active };
    },
  };
  return inProcess;
}

export async function enqueue(payload) {
  if (usesRedis) {
    const q = await getBullQueue();
    await q.add('transcribe', payload, { jobId: payload.jobId });
  } else {
    getInProcessQueue().add(payload);
  }
}

/**
 * Arranca el consumidor. En modo Redis devuelve el Worker de BullMQ para
 * poder cerrarlo con orden; en modo en proceso registra el procesador.
 */
export async function startWorker(processor) {
  if (usesRedis) {
    const { Worker } = await import('bullmq');
    const worker = new Worker(QUEUE_NAME, async (job) => processor(job.data), {
      connection: { url: config.redisUrl },
      concurrency: config.worker.concurrency,
    });
    worker.on('failed', (job, err) => {
      console.error(`[cola] trabajo ${job?.id} fallido:`, err.message);
    });
    return worker;
  }

  getInProcessQueue().setProcessor(processor);
  return null;
}

export async function queueHealth() {
  if (!usesRedis) {
    return { mode: 'en-proceso', ok: true, ...getInProcessQueue().stats() };
  }
  try {
    const q = await getBullQueue();
    const counts = await q.getJobCounts('waiting', 'active', 'failed');
    return { mode: 'redis', ok: true, ...counts };
  } catch (error) {
    return { mode: 'redis', ok: false, error: error.message };
  }
}
