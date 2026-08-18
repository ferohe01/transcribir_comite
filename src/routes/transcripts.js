import express from 'express';
import { jobs, transcripts, outputs } from '../db/index.js';
import { applyTemplate } from '../llm/apply.js';
import { getLlmModel } from '../config/models.js';

const router = express.Router();

/** Comprueba que la transcripcion pertenece al usuario que la pide. */
function ownedTranscript(transcriptId, userId) {
  const transcript = transcripts.byId(transcriptId);
  if (!transcript) return null;
  const job = jobs.byIdForUser(transcript.job_id, userId);
  return job ? transcript : null;
}

router.get('/:id', (req, res) => {
  const transcript = ownedTranscript(Number(req.params.id), req.user.id);
  if (!transcript) return res.status(404).json({ error: 'Transcripcion no encontrada.' });

  res.json({
    transcript: {
      id: transcript.id,
      jobId: transcript.job_id,
      text: transcript.text,
      formatted: transcript.formatted,
      segments: JSON.parse(transcript.segments_json ?? '[]'),
      language: transcript.language,
      asrModel: transcript.asr_model,
    },
    outputs: outputs.listForTranscript(transcript.id),
  });
});

/**
 * Aplica una plantilla sobre una transcripcion ya guardada y devuelve el
 * resultado en streaming.
 *
 * Esta es la fase 2 del flujo: no toca el audio. Reprocesar la misma
 * transcripcion con otra plantilla cuesta segundos en lugar de minutos, y no
 * se vuelve a pagar la transcripcion.
 */
router.post('/:id/apply', async (req, res) => {
  const transcript = ownedTranscript(Number(req.params.id), req.user.id);
  if (!transcript) return res.status(404).json({ error: 'Transcripcion no encontrada.' });

  const templateId = String(req.body?.templateId ?? 'literal');
  const customPrompt = req.body?.customPrompt?.trim() || null;
  const llmModelId = String(req.body?.llmModel ?? '');

  // La plantilla literal no necesita modelo: se devuelve el texto y ya.
  const needsLlm = templateId !== 'literal' || customPrompt;
  if (needsLlm) {
    try {
      getLlmModel(llmModelId);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const controller = new AbortController();
  // Si el usuario cierra la pestana se aborta la llamada al modelo en vez de
  // seguir generando (y pagando) texto que nadie va a leer.
  req.on('close', () => controller.abort());

  let full = '';
  try {
    for await (const delta of applyTemplate({
      transcription: transcript.formatted || transcript.text,
      templateId,
      customPrompt,
      llmModelId,
      signal: controller.signal,
    })) {
      full += delta;
      res.write(`event: delta\ndata: ${JSON.stringify({ text: delta })}\n\n`);
    }

    if (full.trim() && needsLlm) {
      outputs.create({
        transcriptId: transcript.id,
        templateId,
        customPrompt,
        llmModel: llmModelId,
        text: full,
      });
    }

    res.write(`event: done\ndata: ${JSON.stringify({ length: full.length })}\n\n`);
  } catch (error) {
    if (!controller.signal.aborted) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
    }
  } finally {
    res.end();
  }
});

export default router;
