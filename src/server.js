import { config, ensureDirs, validateConfig } from './config/index.js';
import { getDb, jobs, users } from './db/index.js';
import { checkFfmpeg } from './audio/ffmpeg.js';
import { startWorker, usesRedis } from './queue/index.js';
import { processJob } from './queue/processor.js';
import { createApp } from './app.js';

const problems = validateConfig();
if (problems.length > 0) {
  console.error('No se puede arrancar:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  console.error('\nRevisa el archivo .env (parte de .env.example).');
  process.exit(1);
}

const ffmpegStatus = await checkFfmpeg();
if (!ffmpegStatus.ok) {
  console.error('ffmpeg no esta disponible:', ffmpegStatus.error);
  console.error('En Docker viene incluido. En local: https://ffmpeg.org/download.html');
  process.exit(1);
}

ensureDirs();
getDb();

// Trabajos que quedaron a medias en un reinicio anterior: sin esto se
// quedarian para siempre marcados como "en curso" en la interfaz.
const stale = jobs.markStaleAsError();
if (stale > 0) console.log(`${stale} trabajo(s) interrumpido(s) marcado(s) como fallidos`);

// Sin Redis el worker vive en este mismo proceso (modo desarrollo).
if (!usesRedis) {
  await startWorker(processJob);
}

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`\n  Servicio de transcripcion escuchando en http://localhost:${config.port}`);
  console.log(`  ${ffmpegStatus.version}`);
  console.log(`  Cola: ${usesRedis ? 'Redis (worker aparte)' : 'en proceso'}`);

  const providers = ['GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']
    .filter((key) => process.env[key]?.trim())
    .map((key) => key.replace('_API_KEY', '').toLowerCase());
  console.log(`  Proveedores: ${providers.join(', ') || 'ninguno'}`);

  if (users.count() === 0) {
    console.log('\n  No hay ningun usuario. Crea uno con:');
    console.log('    npm run create-user -- tu@correo.com\n');
  }
});

// Subir un audio de varios cientos de MB por una conexion lenta puede tardar
// mas que el timeout por defecto de Node (5 min).
server.requestTimeout = 60 * 60 * 1000;
server.headersTimeout = 65_000;

const shutdown = (signal) => {
  console.log(`\n${signal} recibido, cerrando...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
