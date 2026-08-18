import express from 'express';
import { availableModels } from '../config/models.js';
import { listTemplates, DEFAULT_TEMPLATE } from '../llm/templates.js';
import { userTemplates } from '../db/index.js';
import { checkFfmpeg } from '../audio/ffmpeg.js';
import { queueHealth } from '../queue/index.js';
import { getDb } from '../db/index.js';

const router = express.Router();

/** Modelos realmente utilizables: solo los que tienen su clave configurada. */
router.get('/models', (req, res) => {
  res.json(availableModels());
});

router.get('/templates', (req, res) => {
  res.json({
    default: DEFAULT_TEMPLATE,
    builtin: listTemplates(),
    custom: userTemplates.listForUser(req.user.id).map((t) => ({
      id: `user:${t.id}`,
      dbId: t.id,
      name: t.name,
      prompt: t.prompt,
      isBuiltin: false,
      requiresLlm: true,
    })),
  });
});

router.post('/templates', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const prompt = String(req.body?.prompt ?? '').trim();
  if (!name || !prompt) {
    return res.status(400).json({ error: 'La plantilla necesita un nombre y un prompt.' });
  }
  const id = userTemplates.upsert({ userId: req.user.id, name, prompt });
  res.status(201).json({ id });
});

router.delete('/templates/:id', (req, res) => {
  const deleted = userTemplates.delete(Number(req.params.id), req.user.id);
  if (!deleted) return res.status(404).json({ error: 'Plantilla no encontrada.' });
  res.json({ ok: true });
});

export default router;

/**
 * Estado del servicio. Es la ruta que mira el healthcheck de Docker, asi que
 * comprueba de verdad las dependencias (ffmpeg, base de datos, cola) en lugar
 * de responder 200 sin mas.
 */
export const healthRouter = express.Router();

healthRouter.get('/health', async (req, res) => {
  const [ffmpeg, queue] = await Promise.all([checkFfmpeg(), queueHealth()]);

  let database = { ok: true };
  try {
    getDb().prepare('SELECT 1').get();
  } catch (error) {
    database = { ok: false, error: error.message };
  }

  const providers = {
    groq: Boolean(process.env.GROQ_API_KEY?.trim()),
    openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
    gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
  };

  const ok = ffmpeg.ok && database.ok && queue.ok && Object.values(providers).some(Boolean);
  res.status(ok ? 200 : 503).json({
    ok,
    ffmpeg,
    database,
    queue,
    providers,
    timestamp: new Date().toISOString(),
  });
});
