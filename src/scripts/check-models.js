/**
 * Verifica el catalogo contra las APIs en vivo.
 *
 * Los proveedores retiran y renombran modelos con frecuencia. Este script
 * consulta el listado real de cada uno y avisa de las entradas del catalogo
 * que ya no existen, antes de que un usuario se lo encuentre como un error a
 * mitad de una transcripcion.
 *
 *   npm run check-models
 */
import '../config/index.js';
import { ASR_MODELS, LLM_MODELS, isAvailable } from '../config/models.js';

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

async function listOpenAiCompatible(baseUrl, apiKey) {
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
  return (await response.json()).data.map((m) => m.id);
}

async function listGemini(apiKey) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
  return (await response.json()).models.map((m) => m.name.replace('models/', ''));
}

const providers = {
  groq: {
    envKey: 'GROQ_API_KEY',
    list: (key) => listOpenAiCompatible('https://api.groq.com/openai/v1', key),
  },
  openai: {
    envKey: 'OPENAI_API_KEY',
    list: (key) => listOpenAiCompatible('https://api.openai.com/v1', key),
  },
  gemini: { envKey: 'GEMINI_API_KEY', list: listGemini },
};

const catalogue = [
  ...Object.entries(ASR_MODELS).map(([id, e]) => ({ id, entry: e, kind: 'ASR' })),
  ...Object.entries(LLM_MODELS).map(([id, e]) => ({ id, entry: e, kind: 'LLM' })),
];

let missing = 0;

for (const [name, provider] of Object.entries(providers)) {
  const key = process.env[provider.envKey]?.trim();
  const entries = catalogue.filter((c) => c.entry.engine === name);

  console.log(`\n${name.toUpperCase()}`);

  if (!key) {
    console.log(dim(`  sin ${provider.envKey}, se omite (${entries.length} modelo(s) en el catalogo)`));
    continue;
  }

  let available;
  try {
    available = await provider.list(key);
  } catch (error) {
    console.log(red(`  no se pudo consultar: ${error.message}`));
    continue;
  }

  for (const { id, entry, kind } of entries) {
    const exists = available.includes(entry.model);
    if (!exists) missing += 1;
    console.log(
      `  ${exists ? green('OK  ') : red('FALTA')} ${kind}  ${id.padEnd(28)} ${dim(entry.model)}`,
    );
  }

  const suggestions = available
    .filter((m) => /transcrib|whisper|speech/.test(m) && !entries.some((e) => e.entry.model === m))
    .slice(0, 8);
  if (suggestions.length > 0) {
    console.log(dim(`  otros modelos de audio disponibles: ${suggestions.join(', ')}`));
  }
}

console.log(
  missing === 0
    ? green('\nTodos los modelos configurados existen en sus proveedores.\n')
    : red(`\n${missing} modelo(s) del catalogo ya no existen. Actualiza src/config/models.js.\n`),
);

// Solo cuentan como fallo los modelos que tienen clave y no existen.
// Se usa exitCode y no process.exit() para que Node vacie la salida antes de
// terminar; en Windows, salir de golpe aborta con un fallo de libuv.
process.exitCode = missing > 0 ? 1 : 0;
