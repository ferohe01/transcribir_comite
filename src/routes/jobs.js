import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { jobs, transcripts } from '../db/index.js';
import { getAsrModel } from '../config/models.js';
import { probe } from '../audio/probe.js';
import { enqueue, usesRedis } from '../queue/index.js';

const router = express.Router();

const storage = multer.diskStorage({
  // Ruta absoluta resuelta desde la raiz del proyecto, nunca desde el CWD.
  destination: (req, file, cb) => cb(null, config.paths.uploads),
  filename: (req, file, cb) => {
    // El nombre original solo se guarda en la base de datos; en disco se usa
    // un identificador aleatorio para que un nombre malicioso no pueda
    // escaparse del directorio de subidas.
    const ext = path.extname(file.originalname).slice(0, 10).replace(/[^\w.]/g, '');
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.audio.maxUploadBytes, files: 1 },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas subidas seguidas. Espera un momento.' },
});

/**
 * Crea un trabajo de transcripcion.
 *
 * Responde en cuanto el archivo esta en disco, sin esperar a la
 * transcripcion. Es lo que permite cerrar la pestana y volver luego, y lo que
 * evita que un audio de una hora choque contra el timeout del proxy inverso.
 */
router.post('/', uploadLimiter, upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibio ningun archivo de audio.' });
  }

  const cleanup = () => fs.rm(req.file.path, { force: true }).catch(() => {});

  try {
    const asrModelId = String(req.body.asrModel ?? '').trim();
    getAsrModel(asrModelId); // lanza si no existe o si falta su clave de API

    // Validacion real del contenido: ffprobe confirma que hay una pista de
    // audio decodificable. La version anterior se fiaba del mimetype que
    // enviaba el navegador y dejaba pasar cualquier video/mp4.
    //
    // El error de ffprobe se sustituye por uno legible: su salida incluye
    // rutas absolutas del servidor, que no deben llegar al navegador.
    let info;
    try {
      info = await probe(req.file.path);
    } catch (probeError) {
      console.error('[subida] archivo no reconocido:', probeError.message);
      throw new Error(
        'No se pudo leer el audio de este archivo. Comprueba que no este danado ' +
          'y que sea un formato reconocible (MP3, WAV, M4A, OGG, AAC, WMA, MP4...).',
      );
    }

    const jobId = crypto.randomUUID();
    jobs.create({
      id: jobId,
      userId: req.user.id,
      filename: req.file.originalname,
      sizeBytes: req.file.size,
      asrModel: asrModelId,
      language: req.body.language?.trim() || null,
      hint: req.body.hint?.trim()?.slice(0, 800) || null,
    });

    const payload = {
      jobId,
      inputPath: req.file.path,
      asrModelId,
      language: req.body.language?.trim() || null,
      hint: req.body.hint?.trim()?.slice(0, 800) || null,
    };

    if (usesRedis) {
      await enqueue(payload);
    } else {
      // Sin Redis el trabajo corre en este mismo proceso; se lanza sin await
      // para responder ya, y processJob se encarga de registrar los errores.
      enqueue(payload);
    }

    res.status(202).json({
      job: jobs.byId(jobId),
      durationSeconds: info.durationSeconds,
    });
  } catch (error) {
    await cleanup();
    res.status(400).json({ error: error.message });
  }
});

router.get('/', (req, res) => {
  res.json({ jobs: jobs.listForUser(req.user.id) });
});

router.get('/:id', (req, res) => {
  const job = jobs.byIdForUser(req.params.id, req.user.id);
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado.' });

  const transcript = transcripts.byJobId(job.id);
  res.json({
    job,
    transcript: transcript
      ? {
          id: transcript.id,
          text: transcript.text,
          formatted: transcript.formatted,
          segments: JSON.parse(transcript.segments_json ?? '[]'),
          language: transcript.language,
        }
      : null,
  });
});

/**
 * Progreso en vivo por Server-Sent Events.
 *
 * El estado se lee de SQLite, que es donde lo escribe el worker: asi funciona
 * igual tanto si el worker corre en este proceso como si es un contenedor
 * aparte, sin necesidad de un canal de mensajes entre ambos.
 */
router.get('/:id/events', (req, res) => {
  const job = jobs.byIdForUser(req.params.id, req.user.id);
  if (!job) return res.status(404).json({ error: 'Trabajo no encontrado.' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Indica a Nginx que no debe almacenar la respuesta en un buffer; sin
    // esto el progreso llegaria a saltos o no llegaria.
    'X-Accel-Buffering': 'no',
  });

  let lastSent = '';
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const tick = () => {
    const current = jobs.byIdForUser(req.params.id, req.user.id);
    if (!current) {
      send('error', { error: 'El trabajo ya no existe.' });
      return close();
    }

    const snapshot = JSON.stringify({
      status: current.status,
      stage: current.stage,
      progress: current.progress,
      detail: current.detail,
    });

    if (snapshot !== lastSent) {
      lastSent = snapshot;
      send('progress', JSON.parse(snapshot));
    }

    if (current.status === 'done') {
      send('done', { jobId: current.id });
      close();
    } else if (current.status === 'error') {
      send('error', { error: current.error });
      close();
    }
  };

  const interval = setInterval(tick, 500);
  // Comentario keep-alive cada 20 s: mantiene viva la conexion a traves de
  // proxies que cierran las conexiones ociosas.
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);

  function close() {
    clearInterval(interval);
    clearInterval(ping);
    res.end();
  }

  req.on('close', () => {
    clearInterval(interval);
    clearInterval(ping);
  });

  tick();
});

router.delete('/:id', (req, res) => {
  const deleted = jobs.delete(req.params.id, req.user.id);
  if (!deleted) return res.status(404).json({ error: 'Trabajo no encontrado.' });
  res.json({ ok: true });
});

export default router;
