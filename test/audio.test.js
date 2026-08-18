import test from 'node:test';
import assert from 'node:assert/strict';
import { planCuts } from '../src/audio/split.js';
import { mergeResults, formatWithTimestamps } from '../src/audio/merge.js';
import { mapWithConcurrency } from '../src/engines/http.js';

// --- Planificacion de cortes ----------------------------------------------

test('un audio corto no se trocea', () => {
  const cuts = planCuts(300, [], 600);
  assert.equal(cuts.length, 1);
  assert.deepEqual(cuts[0], { start: 0, end: 300 });
});

test('los cortes caen en los silencios cuando los hay cerca', () => {
  const silences = [
    { start: 588, end: 592, middle: 590 },
    { start: 1205, end: 1211, middle: 1208 },
  ];
  const cuts = planCuts(1800, silences, 600);

  assert.equal(cuts[0].end, 590, 'el primer corte usa el silencio, no los 600 s exactos');
  assert.equal(cuts[1].end, 1208, 'el segundo tambien');
  assert.equal(cuts.at(-1).end, 1800, 'el ultimo trozo llega al final del audio');
});

test('sin silencios cerca, corta en el punto ideal', () => {
  // Un silencio a 100 s esta fuera de la ventana de tolerancia (600 +/- 210).
  const cuts = planCuts(1800, [{ start: 99, end: 101, middle: 100 }], 600);
  assert.equal(cuts[0].end, 600);
});

test('los trozos cubren el audio entero, sin huecos ni solapes', () => {
  const silences = Array.from({ length: 40 }, (_, i) => ({
    start: i * 95,
    end: i * 95 + 2,
    middle: i * 95 + 1,
  }));
  const cuts = planCuts(3600, silences, 600);

  assert.equal(cuts[0].start, 0);
  assert.equal(cuts.at(-1).end, 3600);
  for (let i = 1; i < cuts.length; i += 1) {
    assert.equal(cuts[i].start, cuts[i - 1].end, `el trozo ${i} empieza donde acaba el anterior`);
  }
  const total = cuts.reduce((sum, c) => sum + (c.end - c.start), 0);
  assert.equal(Math.round(total), 3600, 'la suma de duraciones equivale al original');
});

test('ningun trozo supera el limite de tamano del proveedor', () => {
  const cuts = planCuts(7200, [], 600);
  for (const cut of cuts) {
    // 600 s * 1.25 de tolerancia = 750 s. A 16 kbps son ~1,5 MB, muy por
    // debajo del limite de 24 MB: el troceado nunca es el cuello de botella.
    assert.ok(cut.end - cut.start <= 600 * 1.3, 'ningun trozo se desborda');
  }
});

// --- Fusion ---------------------------------------------------------------

test('la fusion desplaza las marcas de tiempo por el offset del trozo', () => {
  const merged = mergeResults([
    {
      index: 1,
      offsetSeconds: 600,
      text: 'segunda parte',
      segments: [{ start: 10, end: 15, text: 'segunda parte' }],
    },
    {
      index: 0,
      offsetSeconds: 0,
      text: 'primera parte',
      segments: [{ start: 5, end: 8, text: 'primera parte' }],
    },
  ]);

  assert.equal(merged.segments[0].start, 5, 'el primer trozo conserva su tiempo');
  assert.equal(merged.segments[1].start, 610, 'el segundo se desplaza 600 s');
  assert.match(merged.text, /^primera parte/, 'el texto respeta el orden de los trozos');
});

test('la fusion ordena los trozos aunque lleguen desordenados', () => {
  const merged = mergeResults([
    { index: 2, offsetSeconds: 1200, text: 'c', segments: [] },
    { index: 0, offsetSeconds: 0, text: 'a', segments: [] },
    { index: 1, offsetSeconds: 600, text: 'b', segments: [] },
  ]);
  assert.equal(merged.text, 'a\n\nb\n\nc');
});

test('los segmentos sin texto se descartan', () => {
  const merged = mergeResults([
    { index: 0, offsetSeconds: 0, text: '', segments: [{ start: 0, end: 1, text: '   ' }] },
  ]);
  assert.equal(merged.text, '');
});

// --- Formato --------------------------------------------------------------

test('el formato agrupa turnos seguidos del mismo hablante', () => {
  const formatted = formatWithTimestamps({
    text: '',
    segments: [
      { start: 0, end: 2, text: 'Hola', speaker: 'Hablante 1' },
      { start: 2.5, end: 4, text: 'que tal', speaker: 'Hablante 1' },
      { start: 5, end: 7, text: 'Bien', speaker: 'Hablante 2' },
    ],
  });

  const lines = formatted.split('\n');
  assert.equal(lines.length, 2, 'los dos primeros segmentos se agrupan en una linea');
  assert.equal(lines[0], '[00:00:00] Hablante 1: Hola que tal');
  assert.equal(lines[1], '[00:00:05] Hablante 2: Bien');
});

test('una pausa larga rompe el bloque aunque sea el mismo hablante', () => {
  const formatted = formatWithTimestamps({
    text: '',
    segments: [
      { start: 0, end: 2, text: 'Primero', speaker: 'A' },
      { start: 30, end: 32, text: 'Segundo', speaker: 'A' },
    ],
  });
  assert.equal(formatted.split('\n').length, 2);
});

test('sin segmentos devuelve el texto plano', () => {
  assert.equal(formatWithTimestamps({ text: 'solo texto', segments: [] }), 'solo texto');
});

test('las horas se formatean bien pasada la primera hora', () => {
  const formatted = formatWithTimestamps({
    text: '',
    segments: [{ start: 3661, end: 3665, text: 'tarde', speaker: null }],
  });
  assert.match(formatted, /^\[01:01:01\] tarde$/);
});

// --- Concurrencia ---------------------------------------------------------

test('la ejecucion en paralelo conserva el orden de los resultados', async () => {
  const delays = [40, 5, 25, 10, 30];
  const results = await mapWithConcurrency(delays, 2, async (ms, i) => {
    await new Promise((r) => setTimeout(r, ms));
    return i;
  });
  assert.deepEqual(results, [0, 1, 2, 3, 4]);
});

test('nunca hay mas tareas activas que el limite', async () => {
  let active = 0;
  let peak = 0;

  await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
  });

  assert.equal(peak, 3, `el pico fue ${peak}, deberia ser 3`);
});

test('el paralelismo es real, no secuencial', async () => {
  const started = Date.now();
  await mapWithConcurrency([30, 30, 30, 30], 4, (ms) => new Promise((r) => setTimeout(r, ms)));
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 90, `4 tareas de 30 ms con concurrencia 4 tardaron ${elapsed} ms`);
});

test('las marcas de tiempo se acotan al tramo real del fragmento', () => {
  // Los modelos multimodales estiman las marcas y se pasan del final del
  // fragmento; sin acotar, el error se acumula trozo a trozo.
  const merged = mergeResults([
    {
      index: 0,
      offsetSeconds: 0,
      durationSeconds: 600,
      text: 'a',
      segments: [{ start: 595, end: 660, text: 'se pasa del final' }],
    },
    {
      index: 1,
      offsetSeconds: 600,
      durationSeconds: 600,
      text: 'b',
      segments: [{ start: -5, end: 700, text: 'tambien se pasa' }],
    },
  ]);

  assert.equal(merged.segments[0].end, 600, 'no supera el final de su fragmento');
  assert.equal(merged.segments[1].start, 600, 'no empieza antes de su offset');
  assert.equal(merged.segments[1].end, 1200, 'ni sobrepasa el final del audio');
});

test('sin duracion conocida las marcas no se tocan', () => {
  const merged = mergeResults([
    { index: 0, offsetSeconds: 0, text: 'a', segments: [{ start: 5, end: 9999, text: 'x' }] },
  ]);
  assert.equal(merged.segments[0].end, 9999);
});
