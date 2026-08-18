import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetchWithRetry, ApiError } from '../src/engines/http.js';
import { createOpenAiCompatibleEngine } from '../src/engines/openai-compatible.js';

/** Sustituye globalThis.fetch por una funcion controlada y la restaura al salir. */
function withFakeFetch(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return handler(calls.length, { url: String(url), options });
  };
  return run(calls).finally(() => {
    globalThis.fetch = original;
  });
}

const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

// --- Reintentos -----------------------------------------------------------

test('un 429 se reintenta y acaba funcionando', async () => {
  await withFakeFetch(
    (n) => (n === 1
      ? jsonResponse({ error: 'rate limit' }, 429, { 'retry-after': '0' })
      : jsonResponse({ text: 'listo' })),
    async (calls) => {
      const response = await fetchWithRetry('https://ejemplo.test/x', {}, { provider: 'test' });
      assert.equal(response.status, 200);
      assert.equal(calls.length, 2, 'se reintento exactamente una vez');
    },
  );
});

test('respeta la cabecera Retry-After', async () => {
  await withFakeFetch(
    (n) => (n === 1
      ? jsonResponse({}, 429, { 'retry-after': '0.15' })
      : jsonResponse({ text: 'ok' })),
    async () => {
      const started = Date.now();
      await fetchWithRetry('https://ejemplo.test/x', {}, { provider: 'test' });
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 140, `espero ${elapsed} ms, deberian ser al menos 150`);
    },
  );
});

test('un 400 no se reintenta: el error es del cliente', async () => {
  await withFakeFetch(
    () => jsonResponse({ error: 'modelo invalido' }, 400),
    async (calls) => {
      await assert.rejects(
        () => fetchWithRetry('https://ejemplo.test/x', {}, { provider: 'test' }),
        (error) => {
          assert.ok(error instanceof ApiError);
          assert.equal(error.status, 400);
          assert.equal(error.retryable, false);
          return true;
        },
      );
      assert.equal(calls.length, 1, 'no hubo reintentos');
    },
  );
});

test('se rinde tras agotar los intentos y conserva el ultimo error', async () => {
  await withFakeFetch(
    () => jsonResponse({ error: { message: 'servicio saturado' } }, 503, { 'retry-after': '0' }),
    async (calls) => {
      await assert.rejects(
        () => fetchWithRetry('https://ejemplo.test/x', {}, { provider: 'test', attempts: 3 }),
        (error) => {
          assert.equal(error.status, 503);
          // El mensaje que ve el usuario es el del proveedor, no el JSON crudo.
          assert.match(error.message, /servicio saturado/);
          return true;
        },
      );
      assert.equal(calls.length, 3);
    },
  );
});

test('no se espera indefinidamente por un limite de uso', async () => {
  // Groq responde 429 con Retry-After: 100 cada vez que se supera su cuota de
  // audio por hora. Sin tope, el proceso se quedaba parado en silencio mas de
  // diez minutos.
  await withFakeFetch(
    () => jsonResponse(
      { error: { message: 'Rate limit reached: 7200 seconds of audio per hour' } },
      429,
      { 'retry-after': '100' },
    ),
    async (calls) => {
      const started = Date.now();
      await assert.rejects(
        () => fetchWithRetry('https://ejemplo.test/x', {}, {
          provider: 'test',
          attempts: 5,
          maxTotalWaitMs: 50,
        }),
        (error) => {
          assert.equal(error.rateLimited, true);
          assert.match(error.message, /7200 seconds of audio/, 'explica el limite real');
          return true;
        },
      );
      assert.equal(calls.length, 1, 'no reintenta si la espera excede el tope');
      assert.ok(Date.now() - started < 1000, 'falla rapido en lugar de esperar 100 s');
    },
  );
});

test('avisa de cada espera antes de reintentar', async () => {
  const avisos = [];
  await withFakeFetch(
    (n) => (n === 1
      ? jsonResponse({ error: { message: 'demasiadas peticiones' } }, 429, { 'retry-after': '0.05' })
      : jsonResponse({ text: 'ok' })),
    async () => {
      await fetchWithRetry('https://ejemplo.test/x', {}, {
        provider: 'test',
        onRetry: (info) => avisos.push(info),
      });
    },
  );

  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].rateLimited, true);
  assert.equal(avisos[0].delayMs, 50, 'informa de cuanto va a esperar');
});

test('un error de red se reintenta', async () => {
  await withFakeFetch(
    (n) => {
      if (n === 1) throw new TypeError('fetch failed');
      return jsonResponse({ text: 'recuperado' });
    },
    async (calls) => {
      const response = await fetchWithRetry('https://ejemplo.test/x', {}, { provider: 'test' });
      assert.equal((await response.json()).text, 'recuperado');
      assert.equal(calls.length, 2);
    },
  );
});

// --- Motor compatible con OpenAI ------------------------------------------

const tmpAudio = async () => {
  const file = path.join(os.tmpdir(), `chunk-${Date.now()}.ogg`);
  await fs.writeFile(file, Buffer.from('audio simulado'));
  return file;
};

test('el motor envia modelo, idioma y pista de vocabulario', async () => {
  process.env.TEST_KEY = 'clave-de-prueba';
  const engine = createOpenAiCompatibleEngine({ baseUrl: 'https://api.test/v1', providerName: 'Test' });
  const file = await tmpAudio();

  await withFakeFetch(
    () => jsonResponse({ text: 'hola', segments: [{ start: 0, end: 1, text: 'hola' }] }),
    async (calls) => {
      const result = await engine({
        filePath: file,
        entry: { model: 'whisper-x', envKey: 'TEST_KEY', timestamps: true },
        language: 'es',
        hint: 'SIGLA, Nombre Propio',
      });

      const { url, options } = calls[0];
      assert.equal(url, 'https://api.test/v1/audio/transcriptions');
      assert.equal(options.headers.Authorization, 'Bearer clave-de-prueba');

      const form = options.body;
      assert.equal(form.get('model'), 'whisper-x');
      assert.equal(form.get('language'), 'es');
      assert.equal(form.get('prompt'), 'SIGLA, Nombre Propio');
      assert.equal(form.get('response_format'), 'verbose_json', 'pide segmentos');

      assert.equal(result.text, 'hola');
      assert.equal(result.segments.length, 1);
    },
  );

  await fs.rm(file, { force: true });
});

test('el formato de respuesta se adapta a las capacidades del modelo', async () => {
  process.env.TEST_KEY = 'k';
  const engine = createOpenAiCompatibleEngine({ baseUrl: 'https://api.test/v1', providerName: 'Test' });
  const file = await tmpAudio();

  const formatFor = async (entry) => {
    let captured;
    await withFakeFetch(
      () => jsonResponse({ text: '' }),
      async (calls) => {
        await engine({ filePath: file, entry: { model: 'm', envKey: 'TEST_KEY', ...entry } });
        captured = calls[0].options.body.get('response_format');
      },
    );
    return captured;
  };

  // gpt-4o-*-transcribe solo admite `json`; pedirle verbose_json es un 400.
  assert.equal(await formatFor({ timestamps: false, diarization: false }), 'json');
  assert.equal(await formatFor({ timestamps: true, diarization: false }), 'verbose_json');
  assert.equal(await formatFor({ timestamps: true, diarization: true }), 'diarized_json');

  await fs.rm(file, { force: true });
});

test('los nombres de hablante llegan aunque el proveedor use otra clave', async () => {
  process.env.TEST_KEY = 'k';
  const engine = createOpenAiCompatibleEngine({ baseUrl: 'https://api.test/v1', providerName: 'Test' });
  const file = await tmpAudio();

  await withFakeFetch(
    () => jsonResponse({
      text: 'hola',
      segments: [{ start_time: 1, end_time: 2, text: 'hola', speaker_label: 'A' }],
    }),
    async () => {
      const result = await engine({
        filePath: file,
        entry: { model: 'm', envKey: 'TEST_KEY', timestamps: true, diarization: true },
      });
      assert.deepEqual(result.segments[0], { start: 1, end: 2, text: 'hola', speaker: 'A' });
    },
  );

  await fs.rm(file, { force: true });
});
