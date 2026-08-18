import { getLlmModel } from '../config/models.js';
import { getEngine } from '../engines/index.js';
import { BUILTIN_TEMPLATES, SYSTEM_PROMPT } from './templates.js';

/**
 * Aplica una plantilla (o un prompt libre) sobre una transcripcion ya
 * guardada, devolviendo el texto en streaming.
 *
 * Este paso es independiente de la transcripcion: cambiar de plantilla no
 * vuelve a tocar el audio ni a pagar por transcribirlo, solo reprocesa texto.
 */
export function resolvePrompt({ templateId, customPrompt }) {
  if (customPrompt?.trim()) {
    return { prompt: customPrompt.trim(), templateId: templateId ?? 'personalizada' };
  }
  const template = BUILTIN_TEMPLATES[templateId];
  if (!template) throw new Error(`Plantilla desconocida: ${templateId}`);
  return { prompt: template.prompt, templateId };
}

/**
 * Genera el texto procesado trozo a trozo.
 * Si la plantilla no lleva prompt (la literal), devuelve la transcripcion tal
 * cual sin llamar a ningun modelo.
 */
export async function* applyTemplate({
  transcription,
  templateId = 'literal',
  customPrompt = null,
  llmModelId,
  signal,
}) {
  const { prompt } = resolvePrompt({ templateId, customPrompt });

  if (!prompt) {
    yield transcription;
    return;
  }

  const entry = getLlmModel(llmModelId);
  const engine = getEngine(entry.engine);

  const user = `${prompt}\n\n--- TRANSCRIPCION DEL AUDIO ---\n${transcription}`;

  yield* engine.streamChat({ entry, system: SYSTEM_PROMPT, user, signal });
}

/** Version no incremental, para usos sin streaming. */
export async function applyTemplateSync(options) {
  let out = '';
  for await (const chunk of applyTemplate(options)) out += chunk;
  return out;
}
