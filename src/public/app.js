/*
 * Cliente de la aplicacion.
 *
 * Dos diferencias de fondo con la version anterior:
 *
 *  1. Todas las rutas son relativas. Antes estaban escritas como
 *     `http://localhost:3001`, lo que hacia imposible servir la app desde un
 *     dominio.
 *  2. El progreso es real: llega por Server-Sent Events desde el servidor. La
 *     version anterior animaba una barra con `setTimeout` y ademas esperaba
 *     3,5 segundos ANTES de llamar a la API, solo para que la animacion
 *     cuadrase.
 */

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  file: null,
  models: { asr: [], llm: [] },
  templates: { builtin: [], custom: [] },
  jobs: [],
  currentJobId: null,
  transcript: null,   // { id, text, formatted }
  displayed: '',      // texto que se ve en pantalla ahora mismo
  eventSource: null,
};

// --- Utilidades ------------------------------------------------------------

async function api(path, options = {}) {
  // `expectAuthError` lo usa el formulario de acceso: ahi un 401 significa
  // "credenciales incorrectas", no "tu sesion ha caducado", y el mensaje del
  // servidor es mas util que el generico.
  const { expectAuthError = false, ...fetchOptions } = options;

  const response = await fetch(path, {
    credentials: 'same-origin',
    ...fetchOptions,
    headers: fetchOptions.body instanceof FormData
      ? fetchOptions.headers
      : { 'Content-Type': 'application/json', ...fetchOptions.headers },
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && !expectAuthError) {
    showLogin();
    throw new Error(data.error || 'Tu sesion ha caducado. Vuelve a entrar.');
  }
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}

function toast(message, type = 'success') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${type} show`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 4000);
}

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatDuration = (seconds) => {
  if (!seconds) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min ${s % 60} s`;
};

function relativeTime(iso) {
  // SQLite guarda `datetime('now')` en UTC sin sufijo de zona; sin la Z el
  // navegador lo interpretaria como hora local y mostraria desfases.
  const then = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  const minutes = Math.round((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} min`;
  if (minutes < 1440) return `hace ${Math.round(minutes / 60)} h`;
  return then.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

// --- Acceso ----------------------------------------------------------------

function showLogin() {
  state.user = null;
  $('loginView').hidden = false;
  $('appView').hidden = true;
}

async function showApp(user) {
  state.user = user;
  $('who').textContent = user.email;
  $('loginView').hidden = true;
  $('appView').hidden = false;
  await Promise.all([loadModels(), loadTemplates(), loadHistory()]);
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('loginError').hidden = true;
  $('loginBtn').disabled = true;
  try {
    const { user } = await api('/api/auth/login', {
      method: 'POST',
      expectAuthError: true,
      body: JSON.stringify({ email: $('email').value, password: $('password').value }),
    });
    $('password').value = '';
    await showApp(user);
  } catch (error) {
    $('loginError').textContent = error.message;
    $('loginError').hidden = false;
  } finally {
    $('loginBtn').disabled = false;
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

// --- Catalogos -------------------------------------------------------------

async function loadModels() {
  state.models = await api('/api/models');

  const asr = $('asrModel');
  asr.innerHTML = '';
  for (const model of state.models.asr) {
    if (model.deprecated) continue;
    const option = new Option(model.label, model.id);
    asr.add(option);
  }
  asr.value = state.models.defaultAsr ?? '';
  updateAsrHint();

  const llm = $('llmModel');
  llm.innerHTML = '';
  for (const model of state.models.llm) llm.add(new Option(model.label, model.id));
  llm.value = state.models.defaultLlm ?? '';

  if (state.models.asr.length === 0) {
    toast('No hay ningun motor configurado. Revisa las claves de API en .env', 'error');
  }
}

function updateAsrHint() {
  const model = state.models.asr.find((m) => m.id === $('asrModel').value);
  if (!model) return ($('asrHint').textContent = '');
  const cost = model.costPerMinute
    ? ` · aprox. $${(model.costPerMinute * 60).toFixed(2)} por hora de audio`
    : '';
  $('asrHint').textContent = `${model.hint ?? ''}${cost}`;
}

$('asrModel').addEventListener('change', updateAsrHint);

async function loadTemplates() {
  state.templates = await api('/api/templates');

  const select = $('templateSelect');
  select.innerHTML = '';
  for (const template of state.templates.builtin) select.add(new Option(template.name, template.id));
  for (const template of state.templates.custom) select.add(new Option(`${template.name} (propia)`, template.id));
  select.add(new Option('Instrucciones personalizadas…', '__custom__'));

  // El desplegable arranca en la plantilla que indica el servidor, no en la
  // primera de la lista: dejarlo en "Transcripcion literal" hacia que el
  // prompt habitual no se ejecutase nunca salvo que se buscara a mano.
  select.value = state.templates.default ?? select.value;
  onTemplateChange();
}

function onTemplateChange() {
  const value = $('templateSelect').value;
  const isCustom = value === '__custom__';
  $('customPromptField').hidden = !isCustom;
  $('saveTemplateBtn').hidden = !isCustom;

  const template =
    state.templates.builtin.find((t) => t.id === value) ??
    state.templates.custom.find((t) => t.id === value);
  $('templateDesc').textContent = template?.description ?? (isCustom ? '' : '');

  // Al elegir una plantilla propia se precarga su prompt para poder ajustarlo.
  const custom = state.templates.custom.find((t) => t.id === value);
  if (custom) $('customPrompt').value = custom.prompt;
}

$('templateSelect').addEventListener('change', onTemplateChange);

// --- Seleccion de archivo --------------------------------------------------

function pickFile(file) {
  state.file = file;
  $('fileName').textContent = file.name;
  $('fileSize').textContent = formatBytes(file.size);
  $('preview').src = URL.createObjectURL(file);
  $('dropzone').hidden = true;
  $('filePicked').hidden = false;
  $('startBtn').disabled = false;
}

$('dropzone').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (event) => {
  if (event.target.files[0]) pickFile(event.target.files[0]);
});

for (const type of ['dragover', 'dragenter']) {
  $('dropzone').addEventListener(type, (event) => {
    event.preventDefault();
    $('dropzone').classList.add('dragover');
  });
}
for (const type of ['dragleave', 'drop']) {
  $('dropzone').addEventListener(type, () => $('dropzone').classList.remove('dragover'));
}
$('dropzone').addEventListener('drop', (event) => {
  event.preventDefault();
  if (event.dataTransfer.files[0]) pickFile(event.dataTransfer.files[0]);
});

$('removeFile').addEventListener('click', () => {
  if ($('preview').src) URL.revokeObjectURL($('preview').src);
  state.file = null;
  $('fileInput').value = '';
  $('preview').removeAttribute('src');
  $('dropzone').hidden = false;
  $('filePicked').hidden = true;
  $('startBtn').disabled = true;
});

// --- Lanzar una transcripcion ---------------------------------------------

$('startBtn').addEventListener('click', async () => {
  if (!state.file) return;

  const form = new FormData();
  form.append('audio', state.file);
  form.append('asrModel', $('asrModel').value);
  form.append('language', $('language').value);
  form.append('hint', $('hint').value);

  $('startBtn').disabled = true;
  $('startBtn').innerHTML = '<span class="spinner"></span> Subiendo…';
  $('resultError').hidden = true;

  try {
    const { job } = await api('/api/jobs', { method: 'POST', body: form });
    toast('Trabajo en cola. Puedes cerrar la pestana: seguira procesandose.');
    await loadHistory();
    selectJob(job.id);
    follow(job.id);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    $('startBtn').disabled = false;
    $('startBtn').innerHTML = '<svg class="icon"><use href="#i-mic"/></svg> Transcribir';
  }
});

/**
 * Sigue el progreso real de un trabajo por SSE hasta que termina o falla.
 */
function follow(jobId) {
  state.eventSource?.close();
  $('progressCard').hidden = false;
  setProgress(0, 'En cola', 'Esperando a un hueco libre');

  const source = new EventSource(`/api/jobs/${jobId}/events`);
  state.eventSource = source;

  source.addEventListener('progress', (event) => {
    const data = JSON.parse(event.data);
    setProgress(data.progress, stageLabel(data.stage, data.status), data.detail ?? '');
  });

  source.addEventListener('done', async () => {
    source.close();
    setProgress(100, 'Completado', '');
    setTimeout(() => { $('progressCard').hidden = true; }, 1500);
    await loadHistory();
    await openJob(jobId);
    toast('Transcripcion completada.');
  });

  source.addEventListener('error', (event) => {
    source.close();
    $('progressCard').hidden = true;
    // Un `error` sin datos es una caida de la conexion, no un fallo del
    // trabajo: el trabajo sigue vivo en el servidor.
    let message = 'Se perdio la conexion con el servidor. El trabajo sigue en curso.';
    try {
      if (event.data) message = JSON.parse(event.data).error;
    } catch { /* mensaje por defecto */ }
    $('resultError').textContent = message;
    $('resultError').hidden = false;
    loadHistory();
  });
}

// Deben coincidir con las etapas que emite src/pipeline.js.
const STAGE_LABELS = {
  probing: 'Analizando el audio',
  preparing: 'Preparando el audio',
  transcribing: 'Transcribiendo',
  merging: 'Uniendo resultados',
  done: 'Completado',
};

const stageLabel = (stage, status) =>
  status === 'queued' ? 'En cola' : (STAGE_LABELS[stage] ?? 'Procesando');

function setProgress(percent, label, detail) {
  $('progressFill').style.width = `${percent}%`;
  $('progressPct').textContent = `${percent}%`;
  $('progressLabel').textContent = label;
  $('progressDetail').textContent = detail;
}

// --- Historial -------------------------------------------------------------

async function loadHistory() {
  const { jobs } = await api('/api/jobs');
  state.jobs = jobs;

  const container = $('history');
  if (jobs.length === 0) {
    container.innerHTML = '<p class="empty">Aun no hay transcripciones.</p>';
    return;
  }

  container.innerHTML = '';
  for (const job of jobs) {
    const button = document.createElement('button');
    button.className = `job${job.id === state.currentJobId ? ' active' : ''}`;
    button.innerHTML = `
      <span class="dot ${job.status}"></span>
      <span class="meta">
        <span class="name"></span>
        <span class="when"></span>
      </span>`;
    button.querySelector('.name').textContent = job.filename;
    button.querySelector('.when').textContent =
      `${relativeTime(job.created_at)}${job.duration_s ? ` · ${formatDuration(job.duration_s)}` : ''}`;
    button.addEventListener('click', () => openJob(job.id));
    container.appendChild(button);
  }
}

function selectJob(jobId) {
  state.currentJobId = jobId;
  for (const [index, node] of [...$('history').children].entries()) {
    node.classList?.toggle('active', state.jobs[index]?.id === jobId);
  }
}

async function openJob(jobId) {
  selectJob(jobId);
  $('resultError').hidden = true;
  $('resultNote').hidden = true;

  const { job, transcript } = await api(`/api/jobs/${jobId}`);
  $('resultTitle').textContent = job.filename;

  if (job.status === 'error') {
    $('resultError').textContent = job.error;
    $('resultError').hidden = false;
    setOutput('');
    $('templateBar').hidden = true;
    $('stats').hidden = true;
    return;
  }

  if (job.status !== 'done') {
    setOutput('Procesando…');
    $('templateBar').hidden = true;
    follow(jobId);
    return;
  }

  state.transcript = transcript;
  setOutput(transcript?.formatted || transcript?.text || '');
  $('templateBar').hidden = false;
  renderStats(job, transcript);
}

const MOTIVO_RESPALDO = {
  RATE_LIMITED: 'el motor principal agoto su cuota',
  BLOCKED: 'el motor principal rechazo el audio por su filtro de contenido',
  EMPTY_RESPONSE: 'el motor principal no devolvio texto',
};

function renderStats(job, transcript) {
  const speed = job.elapsed_ms > 0 ? job.duration_s / (job.elapsed_ms / 1000) : null;
  const words = (transcript?.text ?? '').split(/\s+/).filter(Boolean).length;

  // Si algun fragmento lo atendio otro modelo, hay que decirlo: cambia el
  // precio y puede cambiar la calidad.
  const fellBack = job.fell_back ? JSON.parse(job.fell_back) : [];
  if (fellBack.length > 0) {
    const motivo = MOTIVO_RESPALDO[fellBack[0].reason] ?? 'el motor principal fallo';
    $('resultNote').textContent =
      `${fellBack.length} de ${job.chunk_count} fragmentos se transcribieron con ` +
      `${fellBack[0].usedModel} porque ${motivo}.`;
    $('resultNote').hidden = false;
  } else {
    $('resultNote').hidden = true;
  }

  const cells = [
    ['Duracion', formatDuration(job.duration_s)],
    ['Proceso', job.elapsed_ms ? `${(job.elapsed_ms / 1000).toFixed(1)} s` : 'cache'],
    ['Velocidad', speed ? `${speed.toFixed(0)}x tiempo real` : '—'],
    ['Fragmentos', job.chunk_count ?? '—'],
    ['Palabras', words.toLocaleString('es')],
    ['Coste', job.cost_estimate != null ? `$${job.cost_estimate.toFixed(4)}` : '—'],
  ];

  $('stats').innerHTML = '';
  for (const [key, value] of cells) {
    const div = document.createElement('div');
    div.innerHTML = '<span class="k"></span><span class="v"></span>';
    div.querySelector('.k').textContent = key;
    div.querySelector('.v').textContent = value;
    $('stats').appendChild(div);
  }
  $('stats').hidden = false;
}

// --- Fase 2: aplicar plantilla --------------------------------------------

$('applyBtn').addEventListener('click', async () => {
  if (!state.transcript) return toast('Primero abre una transcripcion.', 'error');

  const templateId = $('templateSelect').value;
  const isCustom = templateId === '__custom__';
  const customPrompt = isCustom ? $('customPrompt').value.trim() : null;

  if (isCustom && !customPrompt) return toast('Escribe las instrucciones.', 'error');

  // La plantilla literal no llama a ningun modelo: es el texto tal cual.
  if (templateId === 'literal') {
    setOutput(state.transcript.formatted || state.transcript.text);
    return;
  }

  const button = $('applyBtn');
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span> Procesando…';
  setOutput('');

  try {
    const response = await fetch(`/api/transcripts/${state.transcript.id}/apply`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: isCustom ? 'personalizada' : templateId,
        customPrompt: customPrompt ?? templatePromptFor(templateId),
        llmModel: $('llmModel').value,
      }),
    });

    if (!response.ok) throw new Error((await response.json()).error ?? 'Error al aplicar la plantilla');

    // El texto se pinta segun llega, en lugar de esperar a tenerlo entero.
    let buffer = '';
    let accumulated = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const raw of events) {
        const type = /^event: (.+)$/m.exec(raw)?.[1];
        const payload = /^data: (.+)$/m.exec(raw)?.[1];
        if (!payload) continue;
        const data = JSON.parse(payload);

        if (type === 'delta') {
          accumulated += data.text;
          setOutput(accumulated);
          $('output').scrollTop = $('output').scrollHeight;
        } else if (type === 'error') {
          throw new Error(data.error);
        }
      }
    }
    toast('Plantilla aplicada.');
  } catch (error) {
    toast(error.message, 'error');
    $('resultError').textContent = error.message;
    $('resultError').hidden = false;
  } finally {
    button.disabled = false;
    button.innerHTML = '<svg class="icon"><use href="#i-wand"/></svg> Aplicar plantilla';
  }
});

// Para las plantillas propias el prompt lo tiene el cliente; para las
// integradas lo resuelve el servidor a partir del identificador.
const templatePromptFor = (id) => state.templates.custom.find((t) => t.id === id)?.prompt ?? null;

$('saveTemplateBtn').addEventListener('click', async () => {
  const prompt = $('customPrompt').value.trim();
  if (!prompt) return toast('Escribe primero las instrucciones.', 'error');

  const name = window.prompt('Nombre para la plantilla:');
  if (!name?.trim()) return;

  try {
    await api('/api/templates', { method: 'POST', body: JSON.stringify({ name: name.trim(), prompt }) });
    await loadTemplates();
    toast('Plantilla guardada.');
  } catch (error) {
    toast(error.message, 'error');
  }
});

// --- Salida ----------------------------------------------------------------

function setOutput(text) {
  state.displayed = text;
  $('output').textContent = text || 'El resultado aparecera aqui.';
  const has = Boolean(text);
  $('copyBtn').disabled = !has;
  $('downloadBtn').disabled = !has;
}

$('copyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.displayed);
    toast('Copiado al portapapeles.');
  } catch {
    toast('El navegador bloqueo el portapapeles.', 'error');
  }
});

$('downloadBtn').addEventListener('click', () => {
  const blob = new Blob([state.displayed], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const base = ($('resultTitle').textContent || 'transcripcion').replace(/\.[^.]+$/, '');
  link.download = `${base}-${new Date().toISOString().slice(0, 10)}.txt`;
  link.click();
  URL.revokeObjectURL(url);
});

// --- Arranque --------------------------------------------------------------

(async () => {
  try {
    const { user } = await api('/api/auth/me');
    await showApp(user);
    // Si al abrir la app hay un trabajo en curso, se retoma su seguimiento.
    const running = state.jobs.find((j) => j.status === 'running' || j.status === 'queued');
    if (running) {
      selectJob(running.id);
      follow(running.id);
    }
  } catch {
    showLogin();
  }
})();
