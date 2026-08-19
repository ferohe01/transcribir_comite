import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// La configuracion se lee al importar, asi que el entorno de pruebas se monta
// antes de cargar ningun modulo de la aplicacion.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-test-'));
process.env.SESSION_SECRET = 'x'.repeat(64);
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'clave-falsa-de-prueba';
// Se asignan en vacio en lugar de borrarlas: dotenv no pisa una variable ya
// definida, pero si rellenaria una borrada con el valor del .env real. Las
// pruebas no deben depender de como este configurada la maquina.
process.env.OPENAI_API_KEY = '';
process.env.GROQ_API_KEY = '';
process.env.REDIS_URL = '';
// Con codigo de invitacion el registro esta abierto; sin el, cerrado. Las
// pruebas cubren los dos casos, y el segundo vaciando config.signup.code.
process.env.SIGNUP_CODE = 'codigo-de-invitacion-de-prueba';

const { config } = await import('../src/config/index.js');
config.paths.data = sandbox;
config.paths.db = path.join(sandbox, 'test.db');
config.paths.uploads = path.join(sandbox, 'uploads');
config.paths.work = path.join(sandbox, 'work');
fs.mkdirSync(config.paths.uploads, { recursive: true });

const { createApp } = await import('../src/app.js');
const { users, jobs, getDb, closeDb } = await import('../src/db/index.js');
const { hashPassword } = await import('../src/auth/password.js');

let server;
let base;
let agent;   // sesion compartida, para no chocar con el limitador de intentos

before(async () => {
  getDb();
  users.create({
    email: 'prueba@ejemplo.com',
    passwordHash: await hashPassword('contrasena-de-prueba'),
  });

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  // Una unica sesion para todas las pruebas: el limitador permite 10 intentos
  // por IP cada 15 minutos, y abrir sesion en cada prueba lo agotaria.
  agent = client();
  await agent('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'prueba@ejemplo.com', password: 'contrasena-de-prueba' }),
  });
});

after(() => {
  server?.close();
  // En Windows los ficheros SQLite quedan bloqueados mientras alguna conexion
  // siga abierta. Se cierra la principal; el almacen de sesiones lo gestiona
  // connect-sqlite3 por dentro y puede tardar en soltarlo, asi que un fallo
  // al borrar el directorio temporal no debe tumbar la suite.
  closeDb();
  try {
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  } catch {
    // El sistema operativo se encarga de limpiar su directorio temporal.
  }
});

/** Cliente que conserva la cookie de sesion entre peticiones. */
function client() {
  let cookie = '';
  return async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        // Solo para cuerpos de texto: con FormData es fetch quien debe fijar
        // el Content-Type, porque incluye el separador multipart.
        ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...options.headers,
      },
      redirect: 'manual',
    });
    const setCookie = response.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    return response;
  };
}

// --- Salud ----------------------------------------------------------------

test('/api/health responde sin sesion y detalla cada dependencia', async () => {
  const response = await fetch(`${base}/api/health`);
  const body = await response.json();

  assert.ok('ffmpeg' in body && 'database' in body && 'queue' in body);
  assert.equal(body.database.ok, true);
  assert.deepEqual(body.providers, { groq: false, openai: false, gemini: true });
});

// --- Control de acceso ----------------------------------------------------

test('las rutas de API exigen sesion', async () => {
  for (const route of ['/api/jobs', '/api/models', '/api/templates', '/api/transcripts/1']) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 401, `${route} deberia responder 401`);
  }
});

test('no se puede entrar con la contrasena incorrecta', async () => {
  const request = client();
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'prueba@ejemplo.com', password: 'equivocada' }),
  });
  assert.equal(response.status, 401);
});

test('un correo inexistente no se distingue de una contrasena mala', async () => {
  const request = client();
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'nadie@ejemplo.com', password: 'lo-que-sea-largo' }),
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /incorrectos/);
});

test('el ciclo completo de sesion funciona', async () => {
  const request = client();

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'prueba@ejemplo.com', password: 'contrasena-de-prueba' }),
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.email, 'prueba@ejemplo.com');

  const me = await request('/api/auth/me');
  assert.equal(me.status, 200);

  await request('/api/auth/logout', { method: 'POST' });

  const after = await request('/api/auth/me');
  assert.equal(after.status, 401, 'tras salir, la sesion ya no vale');
});

// --- Registro -------------------------------------------------------------

test('la pantalla de acceso sabe si el registro esta abierto, sin ver el codigo', async () => {
  const response = await fetch(`${base}/api/auth/config`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.signupEnabled, true);
  assert.equal(JSON.stringify(body).includes('codigo-de-invitacion'), false);
});

test('sin el codigo de invitacion no se puede crear cuenta', async () => {
  const request = client();
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: 'intruso@ejemplo.com',
      password: 'una-contrasena-larga',
      code: 'me-lo-invento',
    }),
  });

  assert.equal(response.status, 403);
  assert.equal(users.byEmail('intruso@ejemplo.com'), undefined);
});

test('quien tiene el codigo crea su cuenta y entra directamente', async () => {
  const request = client();
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: 'Nueva@Ejemplo.com',
      password: 'otra-contrasena-larga',
      code: 'codigo-de-invitacion-de-prueba',
    }),
  });

  assert.equal(response.status, 201);
  const { user } = await response.json();
  // El correo se normaliza a minusculas para que no haya dos cuentas que solo
  // se distingan por como se escribio.
  assert.equal(user.email, 'nueva@ejemplo.com');
  assert.equal(user.role, 'user', 'un alta nunca crea administradores');

  // El alta deja la sesion iniciada: no hace falta volver a escribir la clave.
  const me = await request('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, 'nueva@ejemplo.com');
});

test('un correo ya dado de alta no se puede registrar otra vez', async () => {
  const request = client();
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: 'NUEVA@ejemplo.com',
      password: 'y-otra-contrasena-mas',
      code: 'codigo-de-invitacion-de-prueba',
    }),
  });

  assert.equal(response.status, 409);
});

test('una contrasena corta se rechaza al registrarse', async () => {
  const request = client();
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: 'corta@ejemplo.com',
      password: 'corta',
      code: 'codigo-de-invitacion-de-prueba',
    }),
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /10 caracteres/);
});

test('sin SIGNUP_CODE el registro queda cerrado', async () => {
  const original = config.signup.code;
  config.signup.code = '';
  try {
    const response = await fetch(`${base}/api/auth/config`);
    assert.equal((await response.json()).signupEnabled, false);

    const request = client();
    const alta = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'cerrado@ejemplo.com',
        password: 'una-contrasena-larga',
        code: '',
      }),
    });
    assert.equal(alta.status, 403);
    assert.equal(users.byEmail('cerrado@ejemplo.com'), undefined);
  } finally {
    config.signup.code = original;
  }
});

// --- Catalogo y plantillas ------------------------------------------------

test('solo se ofrecen los modelos cuya clave esta configurada', async () => {
  const request = agent;
  const models = await (await request('/api/models')).json();

  assert.ok(models.asr.length > 0, 'hay modelos de Gemini disponibles');
  assert.ok(models.asr.every((m) => m.engine === 'gemini'), 'no se cuelan los de proveedores sin clave');
  assert.ok(models.llm.every((m) => m.engine === 'gemini'));
  assert.equal(models.defaultAsr, models.asr[0].id, 'hay un modelo por defecto valido');
});

test('el catalogo nunca expone las claves de API', async () => {
  const request = agent;
  const raw = await (await request('/api/models')).text();
  assert.ok(!raw.includes('clave-falsa-de-prueba'));
  assert.ok(!raw.includes('API_KEY'));
});

test('las plantillas integradas incluyen la de evaluacion de proyectos', async () => {
  const request = agent;
  const { builtin, custom, default: preselected } = await (await request('/api/templates')).json();

  // El desplegable del cliente arranca en esta plantilla: es el caso de uso
  // que la version anterior aplicaba de forma automatica.
  assert.equal(preselected, 'evaluacion-proyectos');
  assert.ok(builtin.some((t) => t.id === preselected), 'la preseleccionada debe existir');

  const ids = builtin.map((t) => t.id);
  assert.ok(ids.includes('evaluacion-proyectos'), 'se conserva el caso de uso original');
  assert.ok(ids.includes('literal'));
  assert.equal(builtin.find((t) => t.id === 'literal').requiresLlm, false);
  assert.deepEqual(custom, []);
});

test('se pueden guardar y borrar plantillas propias', async () => {
  const request = agent;

  const created = await request('/api/templates', {
    method: 'POST',
    body: JSON.stringify({ name: 'Mi plantilla', prompt: 'Haz un listado de acuerdos.' }),
  });
  assert.equal(created.status, 201);
  const { id } = await created.json();

  const { custom } = await (await request('/api/templates')).json();
  assert.equal(custom.length, 1);
  assert.equal(custom[0].name, 'Mi plantilla');

  assert.equal((await request(`/api/templates/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await (await request('/api/templates')).json()).custom.length, 0);
});

test('una plantilla sin nombre o sin prompt se rechaza', async () => {
  const request = agent;
  const response = await request('/api/templates', {
    method: 'POST',
    body: JSON.stringify({ name: 'Sin prompt', prompt: '   ' }),
  });
  assert.equal(response.status, 400);
});

// --- Aislamiento entre usuarios -------------------------------------------

test('un usuario no ve los trabajos de otro', async () => {
  users.create({
    email: 'otra@ejemplo.com',
    passwordHash: await hashPassword('otra-contrasena-larga'),
  });

  const jobId = 'trabajo-de-prueba-1';
  getDb()
    .prepare(
      `INSERT INTO jobs (id, user_id, filename, asr_model, status)
       VALUES (?, (SELECT id FROM users WHERE email = 'prueba@ejemplo.com'), 'privado.mp3', 'gemini-flash', 'done')`,
    )
    .run(jobId);

  const otro = client();
  await otro('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'otra@ejemplo.com', password: 'otra-contrasena-larga' }),
  });

  assert.equal((await otro(`/api/jobs/${jobId}`)).status, 404, 'no puede leerlo');
  assert.equal((await otro(`/api/jobs/${jobId}/events`)).status, 404, 'ni seguir su progreso');
  assert.equal((await otro(`/api/jobs/${jobId}`, { method: 'DELETE' })).status, 404, 'ni borrarlo');
  assert.deepEqual((await (await otro('/api/jobs')).json()).jobs, [], 'ni verlo en su historial');

  const dueno = agent;
  assert.equal((await dueno(`/api/jobs/${jobId}`)).status, 200, 'su dueno si');
});

// --- Borrado del historial ------------------------------------------------

test('borrar un trabajo se lleva su transcripcion y sus resultados', async () => {
  const db = getDb();
  const userId = db.prepare("SELECT id FROM users WHERE email = 'prueba@ejemplo.com'").get().id;

  db.prepare(
    `INSERT INTO jobs (id, user_id, filename, asr_model, status)
     VALUES ('trabajo-borrable', ?, 'borrable.mp3', 'gemini-flash', 'done')`,
  ).run(userId);
  const transcriptId = db
    .prepare(
      `INSERT INTO transcripts (job_id, text, asr_model) VALUES ('trabajo-borrable', 'texto', 'gemini-flash')`,
    )
    .run().lastInsertRowid;
  db.prepare(
    `INSERT INTO outputs (transcript_id, template_id, text) VALUES (?, 'acta-reunion', 'un acta')`,
  ).run(transcriptId);

  // El historial avisa de cuantos documentos generados se perderian.
  const listado = (await (await agent('/api/jobs')).json()).jobs;
  assert.equal(listado.find((j) => j.id === 'trabajo-borrable').output_count, 1);

  assert.equal((await agent('/api/jobs/trabajo-borrable', { method: 'DELETE' })).status, 200);

  const queda = (tabla, columna, valor) =>
    db.prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${columna} = ?`).get(valor).n;
  assert.equal(queda('jobs', 'id', 'trabajo-borrable'), 0);
  assert.equal(queda('transcripts', 'job_id', 'trabajo-borrable'), 0, 'la transcripcion cae por cascada');
  assert.equal(queda('outputs', 'transcript_id', transcriptId), 0, 'y los resultados con ella');
});

test('vaciar el historial no toca el de otro usuario', async () => {
  const db = getDb();
  const mio = db.prepare("SELECT id FROM users WHERE email = 'prueba@ejemplo.com'").get().id;
  const ajeno = db.prepare("SELECT id FROM users WHERE email = 'otra@ejemplo.com'").get().id;

  db.prepare(
    `INSERT INTO jobs (id, user_id, filename, asr_model, status)
     VALUES ('mio-1', ?, 'mio.mp3', 'gemini-flash', 'done'), ('ajeno-1', ?, 'ajeno.mp3', 'gemini-flash', 'done')`,
  ).run(mio, ajeno);

  const response = await agent('/api/jobs', { method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).deleted >= 1);

  const cuenta = (userId) =>
    db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE user_id = ?').get(userId).n;
  assert.equal(cuenta(mio), 0, 'el historial propio queda vacio');
  assert.equal(cuenta(ajeno), 1, 'el del otro usuario, intacto');
});

// --- Ficheros servidos ----------------------------------------------------

test('no se sirve el codigo fuente del servidor', async () => {
  for (const route of ['/server.js', '/package.json', '/.env', '/src/server.js']) {
    const response = await fetch(`${base}${route}`);
    const body = await response.text();
    assert.ok(
      !body.includes('API_KEY') && !body.includes('createApp'),
      `${route} no debe devolver codigo del servidor`,
    );
  }
});

test('la interfaz se sirve en la raiz', async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Transcripcion de audio/);
});

// --- Validacion de la subida ----------------------------------------------

test('subir sin archivo se rechaza', async () => {
  const request = agent;
  const form = new FormData();
  form.append('asrModel', 'gemini-flash');

  const response = await request('/api/jobs', { method: 'POST', body: form });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /archivo/i);
});

test('un modelo sin clave configurada se rechaza con un mensaje claro', async () => {
  const request = agent;
  const form = new FormData();
  form.append('audio', new Blob([Buffer.from('no soy audio')]), 'falso.mp3');
  form.append('asrModel', 'openai-transcribe');

  const response = await request('/api/jobs', { method: 'POST', body: form });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /OPENAI_API_KEY/);
});

// --- Cache de transcripciones ---------------------------------------------

test('la clave de cache distingue idioma, vocabulario y modelo', async () => {
  const { cacheKeyFor } = await import('../src/queue/processor.js');
  const base = { audioSha256: 'abc', asrModelId: 'groq-whisper-turbo', language: null, hint: null };

  const sinIdioma = cacheKeyFor(base);

  assert.equal(cacheKeyFor(base), sinIdioma, 'la misma entrada da siempre la misma clave');
  assert.notEqual(cacheKeyFor({ ...base, language: 'es' }), sinIdioma, 'el idioma cuenta');
  assert.notEqual(cacheKeyFor({ ...base, hint: 'PIEC' }), sinIdioma, 'el vocabulario cuenta');
  assert.notEqual(cacheKeyFor({ ...base, asrModelId: 'gemini-flash' }), sinIdioma, 'el modelo cuenta');
  assert.notEqual(cacheKeyFor({ ...base, audioSha256: 'xyz' }), sinIdioma, 'el audio cuenta');
});

test('la cache solo reutiliza una transcripcion con la misma clave', async () => {
  const { transcripts, getDb } = await import('../src/db/index.js');

  getDb()
    .prepare(
      `INSERT INTO jobs (id, user_id, filename, asr_model, status)
       VALUES ('trabajo-cache', (SELECT id FROM users WHERE email = 'prueba@ejemplo.com'),
               'a.mp3', 'groq-whisper-turbo', 'done')`,
    )
    .run();

  transcripts.create({
    jobId: 'trabajo-cache',
    text: 'hola',
    formatted: 'hola',
    segmentsJson: '[]',
    language: 'es',
    audioSha256: 'sha-de-prueba',
    asrModel: 'groq-whisper-turbo',
    cacheKey: 'clave-a',
  });

  assert.equal(transcripts.findCached('clave-a')?.text, 'hola');
  assert.equal(transcripts.findCached('clave-b'), undefined, 'otra clave no reutiliza nada');
  assert.equal(transcripts.findCached(null), undefined, 'sin clave no reutiliza nada');
});

test('un trabajo servido desde la cache queda marcado como tal', async () => {
  // La interfaz necesita distinguirlo: un acierto de cache no tiene
  // fragmentos ni velocidad, y presentarlo como una transcripcion de 0,5 s
  // con cero fragmentos parecia un fallo del pipeline.
  jobs.create({
    id: 'trabajo-de-cache',
    userId: 1,
    filename: 'reunion.mp3',
    sizeBytes: 1024,
    asrModel: 'groq-whisper-turbo',
    language: 'es',
    hint: null,
  });

  jobs.finish('trabajo-de-cache', {
    durationSeconds: 4417,
    costEstimate: 0,
    elapsedMs: 455,
    chunkCount: 0,
    fellBack: [],
    fromCache: true,
  });

  const { job } = await (await agent('/api/jobs/trabajo-de-cache')).json();
  assert.equal(job.from_cache, 1);
  assert.equal(job.chunk_count, 0);
});
