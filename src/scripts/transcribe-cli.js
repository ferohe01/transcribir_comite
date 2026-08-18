/**
 * Transcribe un archivo desde la terminal, sin servidor ni base de datos.
 *
 * Sirve para medir el pipeline en aislamiento y para comparar motores sobre
 * el mismo audio (es lo que alimenta BENCHMARK.md).
 *
 *   npm run transcribe -- samples/reunion.mp3
 *   npm run transcribe -- samples/reunion.mp3 --model openai-mini-transcribe
 *   npm run transcribe -- samples/reunion.mp3 --language es --out salida.txt
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { config, ensureDirs } from '../config/index.js';
import { runPipeline, cleanupWorkDir } from '../pipeline.js';
import { availableModels, DEFAULT_ASR } from '../config/models.js';
import { formatDuration } from '../audio/probe.js';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const input = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));

if (!input) {
  const { asr } = availableModels();
  console.error('Uso: npm run transcribe -- <archivo> [--model <id>] [--language es] [--out archivo.txt]');
  console.error(`\nModelos disponibles: ${asr.map((m) => m.id).join(', ') || 'ninguno (falta configurar claves)'}`);
  process.exit(1);
}

ensureDirs();

const asrModelId = flag('model', DEFAULT_ASR);
const workDir = path.join(config.paths.work, `cli-${crypto.randomUUID()}`);

let lastLine = '';
const render = ({ percent, label, detail }) => {
  const line = `  ${String(percent).padStart(3)}%  ${label}${detail ? ` — ${detail}` : ''}`;
  if (line === lastLine) return;
  lastLine = line;
  process.stdout.write(`\r${' '.repeat(90)}\r${line}`);
};

console.log(`\nTranscribiendo ${path.basename(input)} con ${asrModelId}\n`);

try {
  const result = await runPipeline({
    inputPath: path.resolve(input),
    workDir,
    asrModelId,
    language: flag('language'),
    hint: flag('hint'),
    onProgress: render,
  });

  const seconds = result.elapsedMs / 1000;
  console.log('\n');
  console.log(`  Duracion del audio    ${formatDuration(result.durationSeconds)}`);
  console.log(`  Tiempo de proceso     ${seconds.toFixed(1)} s`);
  console.log(`  Velocidad             ${(result.durationSeconds / seconds).toFixed(0)}x tiempo real`);
  console.log(`  Fragmentos            ${result.chunkCount}`);
  console.log(
    `  Compresion            ${(result.compression.originalBytes / 1048576).toFixed(1)} MB -> ` +
      `${(result.compression.normalizedBytes / 1048576).toFixed(1)} MB ` +
      `(${result.compression.ratio.toFixed(1)}x)`,
  );
  if (result.fellBack.length > 0) {
    console.log(
      `  Respaldo               ${result.fellBack.length} fragmento(s) rechazado(s) por el ` +
        `modelo principal, transcritos con ${result.fellBack[0].usedModel}`,
    );
  }
  if (result.costEstimate !== null) {
    console.log(`  Coste estimado        $${result.costEstimate.toFixed(4)}`);
  }
  console.log(`  Palabras              ${result.text.split(/\s+/).filter(Boolean).length}`);

  const out = flag('out');
  if (out) {
    await fs.writeFile(out, result.formatted, 'utf8');
    console.log(`\n  Guardado en ${out}\n`);
  } else {
    console.log(`\n${'-'.repeat(70)}\n${result.formatted.slice(0, 2000)}`);
    if (result.formatted.length > 2000) console.log(`\n[...] (${result.formatted.length} caracteres en total)`);
    console.log();
  }
} catch (error) {
  console.error(`\n\nError: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await cleanupWorkDir(workDir);
}
