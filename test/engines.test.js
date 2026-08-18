import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetchWithRetry, ApiError } from '../src/engines/http.js';
import { createOpenAiCompatibleEngine, createOpenAiCompatibleChat } from '../src/engines/openai-compatible.js';

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

test('el motor respeta el presupuesto de espera que le pasan', async () => {
  process.env.TEST_KEY = 'k';
  const engine = createOpenAiCompatibleEngine({ baseUrl: 'https://api.test/v1', providerName: 'Test' });
  const file = await tmpAudio();

  // Un 429 con Retry-After de 140 s, como el de Groq al agotar su cuota.
  const saturado = () => jsonResponse(
    { error: { message: 'Rate limit reached on seconds of audio per hour' } },
    429,
    { 'retry-after': '140' },
  );

  // Con un presupuesto corto se rinde de inmediato, para que el pipeline pueda
  // pasar al motor de respaldo en lugar de esperar mas de dos minutos.
  await withFakeFetch(saturado, async (calls) => {
    const started = Date.now();
    await assert.rejects(
      () => engine({
        filePath: file,
        entry: { model: 'm', envKey: 'TEST_KEY' },
        maxWaitMs: 15_000,
      }),
      (error) => {
        assert.equal(error.rateLimited, true, 'el motivo llega marcado como limite de uso');
        return true;
      },
    );
    assert.equal(calls.length, 1, 'no espera los 140 s que pide el proveedor');
    assert.ok(Date.now() - started < 1000);
  });

  await fs.rm(file, { force: true });
});

// --- Chat de plantillas ---------------------------------------------------

/** Respuesta SSE de chat como la que devuelven OpenAI y Groq. */
const sseResponse = (chunks) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

const collect = async (stream) => {
  let out = '';
  for await (const delta of stream) out += delta;
  return out;
};

const deltaChunk = (text, finish = null) => ({
  choices: [{ delta: text === null ? {} : { content: text }, finish_reason: finish }],
});

test('los modelos con temperatura fija no la reciben', async () => {
  process.env.TEST_KEY = 'k';
  const chat = createOpenAiCompatibleChat({ baseUrl: 'https://api.test/v1', providerName: 'Test' });

  await withFakeFetch(
    () => sseResponse([deltaChunk('hola'), deltaChunk(null, 'stop')]),
    async (calls) => {
      const flexible = { model: 'm', envKey: 'TEST_KEY' };
      assert.equal(await collect(chat({ entry: flexible, system: 's', user: 'u' })), 'hola');
      assert.equal(JSON.parse(calls[0].options.body).temperature, 0.1);
    },
  );

  await withFakeFetch(
    () => sseResponse([deltaChunk('hola'), deltaChunk(null, 'stop')]),
    async (calls) => {
      // La familia GPT-5 responde 400 si se le manda cualquier temperatura.
      const fixed = { model: 'gpt-5.5', envKey: 'TEST_KEY', fixedTemperature: true };
      await collect(chat({ entry: fixed, system: 's', user: 'u' }));
      assert.ok(!('temperature' in JSON.parse(calls[0].options.body)));
    },
  );
});

test('el presupuesto de salida viaja en la peticion', async () => {
  process.env.TEST_KEY = 'k';
  const chat = createOpenAiCompatibleChat({ baseUrl: 'https://api.test/v1', providerName: 'Test' });

  await withFakeFetch(
    () => sseResponse([deltaChunk('texto'), deltaChunk(null, 'stop')]),
    async (calls) => {
      const entry = { model: 'm', envKey: 'TEST_KEY', maxOutputTokens: 32768 };
      await collect(chat({ entry, system: 's', user: 'u' }));
      assert.equal(JSON.parse(calls[0].options.body).max_completion_tokens, 32768);
    },
  );
});

test('una respuesta sin texto es un error, no un resultado vacio', async () => {
  process.env.TEST_KEY = 'k';
  const chat = createOpenAiCompatibleChat({ baseUrl: 'https://api.test/v1', providerName: 'Test' });

  // Caso real: el modelo gasta todo su presupuesto razonando y termina con
  // finish_reason 'length' sin haber escrito ni un caracter.
  await withFakeFetch(
    () => sseResponse([deltaChunk(null, 'length')]),
    async () => {
      await assert.rejects(
        collect(chat({ entry: { model: 'm', envKey: 'TEST_KEY' }, system: 's', user: 'u' })),
        /limite de salida/,
      );
    },
  );

  await withFakeFetch(
    () => sseResponse([deltaChunk(null, 'stop')]),
    async () => {
      await assert.rejects(
        collect(chat({ entry: { model: 'm', envKey: 'TEST_KEY' }, system: 's', user: 'u' })),
        /no devolvio texto/,
      );
    },
  );
});
