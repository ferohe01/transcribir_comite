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
  signupEnabled: null,   // null = aun no se ha preguntado al servidor
  historyFilter: '',     // filtro local del historial, sin ir al servidor
  transcript: null,   // { id, text, formatted }
  outputs: [],        // resultados de plantilla ya guardados para esa transcripcion
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
    throw new Error(data.error || 'Tu sesión ha caducado. Vuelve a entrar.');
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
  setAuthMode('login');
  offerSignupIfOpen();
}

/**
 * Pregunta una sola vez si el servidor admite altas. Se consulta aqui y no al
 * arrancar porque showLogin() tambien se llama cuando caduca una sesion, y no
 * tiene sentido repetir la peticion en cada caducidad.
 */
async function offerSignupIfOpen() {
  if (state.signupEnabled === null) {
    state.signupEnabled = await api('/api/auth/config')
      .then((data) => Boolean(data.signupEnabled))
      .catch(() => false);
  }
  $('authSwitch').hidden = !state.signupEnabled;
}

/** Alterna entre el formulario de acceso y el de alta dentro de la misma tarjeta. */
function setAuthMode(mode) {
  const registering = mode === 'register';
  $('loginForm').hidden = registering;
  $('registerForm').hidden = !registering;
  $('loginError').hidden = true;
  $('authSub').textContent = registering
    ? 'Crea tu cuenta para empezar.'
    : 'Inicia sesión para continuar.';
  $('authSwitchText').textContent = registering ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?';
  $('authSwitchBtn').textContent = registering ? 'Iniciar sesión' : 'Crear una';
  $(registering ? 'regEmail' : 'email').focus();
}

function showAuthError(message) {
  $('loginError').textContent = message;
  $('loginError').hidden = false;
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
    showAuthError(error.message);
  } finally {
    $('loginBtn').disabled = false;
  }
});

$('authSwitchBtn').addEventListener('click', () => {
  setAuthMode($('registerForm').hidden ? 'register' : 'login');
});

$('registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('loginError').hidden = true;

  const password = $('regPassword').value;
  // Se comprueba aqui y no en el servidor: el servidor no puede saber si dos
  // contrasenas distintas son una errata o dos intentos legitimos.
  if (password !== $('regPassword2').value) {
    return showAuthError('Las dos contraseñas no coinciden.');
  }

  $('registerBtn').disabled = true;
  try {
    const { user } = await api('/api/auth/register', {
      method: 'POST',
      expectAuthError: true,
      body: JSON.stringify({
        email: $('regEmail').value,
        password,
        code: $('regCode').value.trim(),
      }),
    });
    $('regPassword').value = '';
    $('regPassword2').value = '';
    $('regCode').value = '';
    await showApp(user);
    toast('Cuenta creada. Ya puedes transcribir.');
  } catch (error) {
    showAuthError(error.message);
  } finally {
    $('registerBtn').disabled = false;
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
  const box = $('asrHint');
  box.textContent = '';
  const model = state.models.asr.find((m) => m.id === $('asrModel').value);
  if (!model) return;

  box.append(document.createTextNode(model.hint ?? ''));
  if (model.costPerMinute) {
    const coste = document.createElement('span');
    coste.className = 'cost';
    coste.textContent = `≈ US$${(model.costPerMinute * 60).toFixed(2)} por hora de audio`;
    box.append(coste);
  }
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
  // El nombre se corta con puntos suspensivos; el completo vive en el tooltip.
  $('fileName').title = file.name;
  $('fileSize').textContent = formatBytes(file.size);
  $('fileDuration').textContent = '';

  const preview = $('preview');
  // La duracion la da el propio navegador al leer la cabecera del archivo: no
  // cuesta nada y evita esperar a que el servidor analice el audio.
  preview.onloadedmetadata = () => {
    if (Number.isFinite(preview.duration)) {
      $('fileDuration').textContent = ` · ${formatDuration(preview.duration)}`;
    }
  };
  preview.src = URL.createObjectURL(file);
  $('dropzone').hidden = true;
  $('filePicked').hidden = false;
  $('uploadSettings').hidden = false;
  $('startBtn').disabled = false;
}

// La zona de subida es una <label> con el input dentro, asi que el clic y la
// tecla Enter los gestiona el navegador. Reenviarlo a mano desde aqui abriria
// el dialogo dos veces.
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
  $('uploadSettings').hidden = true;
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
    toast('Trabajo en cola. Puedes cerrar la pestaña: seguirá procesándose.');
    await loadHistory();
    selectJob(job.id);
    follow(job.id);
  } catch (error) {
    showResultError('No se pudo iniciar la transcripción.', error.message, () => $('startBtn').click());
  } finally {
    $('startBtn').disabled = false;
    $('startBtn').innerHTML = '<svg class="icon"><use href="#i-mic"/></svg> Transcribir audio';
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
    setProgress(100, 'Transcripción completada', '');
    // El visto viene del juego de iconos, no de un glifo suelto.
    $('progressLabel').insertAdjacentHTML(
      'afterbegin',
      '<svg class="icon ok"><use href="#i-check"/></svg> ',
    );
    setTimeout(() => { $('progressCard').hidden = true; }, 1500);
    await loadHistory();
    await openJob(jobId);
    toast('Transcripción completada.');
  });

  source.addEventListener('error', (event) => {
    source.close();
    $('progressCard').hidden = true;
    // Un `error` sin datos es una caida de la conexion, no un fallo del
    // trabajo: el trabajo sigue vivo en el servidor.
    let detalle = 'El trabajo sigue procesándose en el servidor.';
    let titular = 'Se perdió la conexión con el servidor.';
    try {
      if (event.data) {
        detalle = JSON.parse(event.data).error;
        titular = 'No se pudo completar la transcripción.';
      }
    } catch { /* se queda el mensaje de conexion perdida */ }

    // Reintentar aqui es volver a engancharse al trabajo, que sigue vivo.
    showResultError(titular, detalle, () => follow(jobId));
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
  // scaleX y no width: animar el ancho recalcula la maquetacion en cada tick.
  const acotado = Math.max(0, Math.min(100, percent));
  $('progressFill').style.transform = `scaleX(${acotado / 100})`;
  // Sin esto la barra es muda para un lector de pantalla: toda la espera
  // transcurre sin que anuncie nada.
  $('progressBar').setAttribute('aria-valuenow', String(Math.round(acotado)));
  $('progressPct').textContent = `${percent}%`;
  $('progressLabel').textContent = label;
  $('progressDetail').textContent = detail;
}

/**
 * Muestra un fallo en el panel de resultado.
 *
 * El titular esta en lenguaje llano. El mensaje del servidor se conserva
 * debajo en lugar de ocultarse, porque los de este servicio son buenos y
 * accionables ("Comprueba que el archivo no este danado y sea un formato
 * reconocible"); esconderlo dejaria al usuario sin saber que arreglar. El
 * detalle tecnico completo va ademas a la consola.
 */
function showResultError(titular, detalle, reintentar = null) {
  console.error(titular, detalle);

  const caja = $('resultError');
  caja.textContent = titular;

  // Ultima defensa: si el detalle sigue pareciendo un volcado, se queda en la
  // consola. El servidor ya deberia haberlo traducido, pero un JSON en crudo
  // en pantalla no ayuda a nadie y da mala impresion del producto.
  const legible = detalle && detalle !== titular && !/^[[{]|\n\s*"/.test(detalle);
  if (legible) {
    const linea = document.createElement('span');
    linea.className = 'detalle';
    linea.textContent = detalle;
    caja.append(linea);
  }

  if (reintentar) {
    const acciones = document.createElement('div');
    acciones.className = 'acciones';
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'btn ghost small';
    boton.textContent = 'Reintentar';
    boton.addEventListener('click', () => {
      caja.hidden = true;
      reintentar();
    });
    acciones.append(boton);
    caja.append(acciones);
  }

  caja.hidden = false;
}

// --- Historial -------------------------------------------------------------

async function loadHistory() {
  const { jobs } = await api('/api/jobs');
  state.jobs = jobs;
  renderHistory();
}

/**
 * Pinta el historial ya cargado. La busqueda filtra en memoria: los trabajos
 * ya estan aqui, asi que pedirlos otra vez al servidor solo anadiria espera.
 */
function renderHistory() {
  const filtro = state.historyFilter.trim().toLowerCase();
  const visibles = filtro
    ? state.jobs.filter((j) => j.filename.toLowerCase().includes(filtro))
    : state.jobs;

  $('historyConfirm').hidden = true;
  $('clearHistory').hidden = state.jobs.length === 0;
  // Buscar entre tres cosas no ayuda a nadie; el buscador aparece cuando la
  // lista empieza a ser larga.
  $('historySearchBox').hidden = state.jobs.length < 5;

  const container = $('history');
  container.innerHTML = '';

  if (state.jobs.length === 0) {
    container.innerHTML = '<p class="empty">Aún no hay transcripciones.</p>';
    return;
  }
  if (visibles.length === 0) {
    container.innerHTML = '<p class="empty">Ninguna transcripción coincide con la búsqueda.</p>';
    return;
  }

  for (const job of visibles) container.appendChild(historyRow(job));
}

$('historySearch').addEventListener('input', (event) => {
  state.historyFilter = event.target.value;
  renderHistory();
});

// El punto de color no basta: quien no distingue los colores necesita leerlo.
const ESTADO_TEXTO = { queued: 'En cola', running: 'Procesando', error: 'Error' };

/** Una fila: un boton para abrir y otro para borrar, no un boton dentro de otro. */
function historyRow(job) {
  const row = document.createElement('div');
  row.className = `job${job.id === state.currentJobId ? ' active' : ''}`;
  row.dataset.jobId = job.id;

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'job-open';
  open.innerHTML = `
    <span class="dot ${job.status}"></span>
    <span class="meta">
      <span class="name"></span>
      <span class="when"></span>
    </span>`;
  open.querySelector('.name').textContent = job.filename;
  open.querySelector('.when').textContent =
    `${relativeTime(job.created_at)}${job.duration_s ? ` · ${formatDuration(job.duration_s)}` : ''}`;
  open.addEventListener('click', () => openJob(job.id));

  if (ESTADO_TEXTO[job.status]) {
    const estado = document.createElement('span');
    estado.className = `state ${job.status}`;
    estado.textContent = ESTADO_TEXTO[job.status];
    open.append(estado);
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'job-delete';
  // El icono no tiene texto: sin nombre accesible, un lector de pantalla solo
  // anunciaria "boton".
  remove.setAttribute('aria-label', `Borrar ${job.filename}`);
  remove.innerHTML = '<svg class="icon"><use href="#i-close"/></svg>';
  remove.addEventListener('click', () => askDeleteJob(row, job));

  row.append(open, remove);
  return row;
}

/** Cuenta lo que se pierde de verdad, incluidos los documentos generados. */
const frase = (n, singular, plural) => `${n} ${n === 1 ? singular : plural}`;

function askDeleteJob(row, job) {
  const salidas = job.output_count ?? 0;
  row.className = 'job confirming';
  row.textContent =
    salidas > 0
      ? `Se borrará la transcripción y ${frase(salidas, 'resultado', 'resultados')} de plantilla. No se puede deshacer.`
      : 'Se borrará esta transcripción. No se puede deshacer.';

  row.append(
    confirmarAcciones('Borrar', async () => {
      await api(`/api/jobs/${job.id}`, { method: 'DELETE' });
      if (state.currentJobId === job.id) resetResultPanel();
      toast('Transcripción borrada.');
    }),
  );
}

$('clearHistory').addEventListener('click', () => {
  const total = state.jobs.length;
  const salidas = state.jobs.reduce((n, j) => n + (j.output_count ?? 0), 0);

  const bar = $('historyConfirm');
  bar.textContent =
    `Se borrarán ${frase(total, 'transcripción', 'transcripciones')}` +
    (salidas > 0 ? ` y ${frase(salidas, 'resultado', 'resultados')} de plantilla` : '') +
    '. No se puede deshacer.';

  bar.append(
    confirmarAcciones('Borrar todo', async () => {
      const { deleted } = await api('/api/jobs', { method: 'DELETE' });
      resetResultPanel();
      toast(`${frase(deleted, 'transcripción borrada', 'transcripciones borradas')}.`);
    }),
  );
  bar.hidden = false;
});

/**
 * El par de botones de una confirmacion. Cancelar vuelve a pintar el historial,
 * que es la forma mas segura de deshacer el estado a medias.
 */
function confirmarAcciones(etiqueta, accion) {
  const caja = document.createElement('div');
  caja.className = 'acciones';

  const si = document.createElement('button');
  si.type = 'button';
  si.className = 'btn danger small';
  si.textContent = etiqueta;
  si.addEventListener('click', async () => {
    si.disabled = true;
    try {
      await accion();
    } catch (error) {
      toast(error.message, 'error');
    }
    await loadHistory();
  });

  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'btn ghost small';
  no.textContent = 'Cancelar';
  no.addEventListener('click', () => loadHistory());

  caja.append(si, no);
  // El foco va al boton destructivo pero la accion sigue necesitando un clic:
  // asi quien navega con teclado no tiene que buscar donde ha aparecido esto.
  queueMicrotask(() => si.focus());
  return caja;
}

/** Deja la columna derecha como al entrar, sin trabajo abierto. */
function resetResultPanel() {
  $('aiProgress').hidden = true;
  state.currentJobId = null;
  state.transcript = null;
  state.outputs = [];
  renderOutputs();
  setOutput('');
  $('resultTitle').textContent = 'Resultado';
  $('resultTitle').title = '';
  $('templateBar').hidden = true;
  $('stats').hidden = true;
  $('resultNote').hidden = true;
  $('resultError').hidden = true;
}

function selectJob(jobId) {
  state.currentJobId = jobId;
  // Se compara por identificador y no por posicion: correlacionar los hijos
  // del DOM con el array por indice resaltaba la fila equivocada en cuanto
  // los dos se desincronizaban.
  for (const node of $('history').children) {
    node.classList?.toggle('active', node.dataset?.jobId === jobId);
  }
}

async function openJob(jobId) {
  selectJob(jobId);
  $('resultError').hidden = true;
  $('resultNote').hidden = true;
  // Los resultados son de la transcripcion anterior: fuera hasta saber que
  // tiene esta.
  state.outputs = [];
  renderOutputs();

  const { job, transcript } = await api(`/api/jobs/${jobId}`);
  $('resultTitle').textContent = job.filename;
  $('resultTitle').title = job.filename;

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
  if (transcript) await loadOutputs(transcript.id);
}

const MOTIVO_RESPALDO = {
  RATE_LIMITED: 'el motor principal agoto su cuota',
  BLOCKED: 'el motor principal rechazo el audio por su filtro de contenido',
  EMPTY_RESPONSE: 'el motor principal no devolvió texto',
};

function renderStats(job, transcript) {
  const speed = job.elapsed_ms > 0 ? job.duration_s / (job.elapsed_ms / 1000) : null;
  const words = (transcript?.text ?? '').split(/\s+/).filter(Boolean).length;

  // Si algun fragmento lo atendio otro modelo, hay que decirlo: cambia el
  // precio y puede cambiar la calidad.
  const fellBack = job.fell_back ? JSON.parse(job.fell_back) : [];
  const cached = Boolean(job.from_cache);

  if (fellBack.length > 0) {
    const motivo = MOTIVO_RESPALDO[fellBack[0].reason] ?? 'el motor principal fallo';
    $('resultNote').textContent =
      `${fellBack.length} de ${job.chunk_count} fragmentos se transcribieron con ` +
      `${fellBack[0].usedModel} porque ${motivo}.`;
    $('resultNote').hidden = false;
  } else if (cached) {
    $('resultNote').textContent =
      'Este audio ya se había transcrito con el mismo motor, idioma y vocabulario, ' +
      'así que se reutilizó el texto guardado: no se volvió a transcribir ni a pagar.';
    $('resultNote').hidden = false;
  } else {
    $('resultNote').hidden = true;
  }

  // Un acierto de cache no es una transcripcion instantanea: no hubo
  // fragmentos que contar ni velocidad que medir. Presentarlo como "0,5 s a
  // 9710x tiempo real con 0 fragmentos" parecia un fallo del pipeline.
  const cells = [
    ['Duración', formatDuration(job.duration_s)],
    ['Tiempo de proceso', cached ? 'Reutilizada' : job.elapsed_ms ? `${(job.elapsed_ms / 1000).toFixed(1)} s` : '—'],
    ['Velocidad', cached || !speed ? '—' : `${speed.toFixed(0)}x tiempo real`],
    ['Fragmentos', cached ? '—' : job.chunk_count ?? '—'],
    ['Palabras', words.toLocaleString('es')],
    ['Coste', cached ? 'Sin coste' : job.cost_estimate != null ? `$${job.cost_estimate.toFixed(4)}` : '—'],
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
  if (!state.transcript) return toast('Primero abre una transcripción.', 'error');

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

  // La etapa 2 tiene su propio indicador: es un proceso distinto del de
  // transcribir y conviene que se vea cual de los dos esta corriendo.
  $('aiProgressDetail').textContent =
    `Plantilla: ${isCustom ? 'Instrucciones propias' : templateName(templateId)} · ` +
    `Modelo: ${llmName($('llmModel').value)}`;
  $('aiProgress').hidden = false;
  // El texto anterior se queda hasta que llegue el primer fragmento del nuevo.
  // Vaciarlo aqui dejaba la pantalla en blanco durante toda la espera y, si la
  // llamada fallaba, se habia perdido sin haberlo generado de nuevo.

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
          setOutput(accumulated, { plano: true });
          $('output').scrollTop = $('output').scrollHeight;
        } else if (type === 'error') {
          throw new Error(data.error);
        }
      }
    }
    toast('Resultado generado.');
    // El servidor acaba de guardarla: se recarga la lista y se marca la
    // recien hecha, que es la que se esta leyendo.
    await loadOutputs(state.transcript.id);
    renderOutputs(state.outputs[0]?.id ?? null);
    // Ya completo: ahora si se reparten las marcas de tiempo.
    setOutput(state.displayed);
  } catch (error) {
    showResultError('No se pudo generar el resultado con IA.', error.message, () => $('applyBtn').click());
  } finally {
    $('aiProgress').hidden = true;
    button.disabled = false;
    button.innerHTML = '<svg class="icon"><use href="#i-wand"/></svg> Aplicar plantilla con IA';
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

// --- Resultados guardados --------------------------------------------------

/**
 * Trae los resultados de plantilla que ya existen para esta transcripcion.
 *
 * El servidor guarda cada uno al aplicarlo, pero hasta ahora nadie los pedia:
 * el acta de ayer seguia en la base de datos y la pantalla solo sabia enseniar
 * la transcripcion cruda.
 */
async function loadOutputs(transcriptId, activeId = null) {
  try {
    const { outputs } = await api(`/api/transcripts/${transcriptId}`);
    state.outputs = outputs ?? [];
  } catch {
    // Que falle esto no debe tumbar la vista: la transcripcion ya esta en
    // pantalla y es lo principal.
    state.outputs = [];
  }
  renderOutputs(activeId);
}

const templateName = (id) =>
  id === 'personalizada'
    ? 'Instrucciones propias'
    : state.templates.builtin.find((t) => t.id === id)?.name ??
      state.templates.custom.find((t) => t.id === id)?.name ??
      id;

const llmName = (id) => state.models.llm.find((m) => m.id === id)?.label ?? id;

/**
 * Pestanas del documento. `activeId` null = la transcripcion original.
 *
 * La original es siempre la primera y nunca se sobrescribe: cada plantilla
 * aplicada se guarda aparte, de modo que se pueda comparar el resultado con
 * la fuente. Sin resultados todavia no hay nada que elegir y la barra sobra.
 */
function renderOutputs(activeId = null) {
  const box = $('results');
  box.innerHTML = '';

  if (state.outputs.length === 0) {
    box.hidden = true;
    return;
  }

  const tab = (id, titulo, detalle) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(id === activeId));
    button.append(document.createTextNode(titulo));
    if (detalle) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = detalle;
      button.append(meta);
    }
    button.addEventListener('click', () => showOutput(id));
    return button;
  };

  box.append(tab(null, 'Transcripción original', null));
  for (const out of state.outputs) {
    box.append(tab(out.id, templateName(out.template_id), `${llmName(out.llm_model)} · ${relativeTime(out.created_at)}`));
  }
  box.hidden = false;
}

function showOutput(id) {
  const out = state.outputs.find((o) => o.id === id);
  setOutput(out ? out.text : state.transcript?.formatted || state.transcript?.text || '');
  renderOutputs(id);
}

// --- Salida ----------------------------------------------------------------

function setOutput(text, { plano = false } = {}) {
  state.displayed = text;
  const has = Boolean(text);

  $('output').hidden = !has;
  $('emptyState').hidden = has;
  if (has) {
    // Mientras llega el texto en directo se pinta plano: repartir las marcas
    // de tiempo en cada fragmento recibido rehace el documento entero decenas
    // de veces por segundo.
    if (plano) $('output').textContent = text;
    else renderDocument(text);
  }

  $('copyBtn').disabled = !has;
  $('downloadBtn').disabled = !has;
}

/**
 * Pinta el texto apartando las marcas de tiempo del cuerpo.
 *
 * Se construye con nodos y no con innerHTML: esto es texto transcrito de un
 * audio, y no hay ninguna razon para que el navegador lo interprete como
 * marcado.
 */
function renderDocument(text) {
  const out = $('output');
  out.textContent = '';
  for (const parte of text.split(/(\[\d{2}:\d{2}:\d{2}\])/g)) {
    if (!parte) continue;
    if (/^\[\d{2}:\d{2}:\d{2}\]$/.test(parte)) {
      const marca = document.createElement('span');
      marca.className = 'ts';
      marca.textContent = parte;
      out.append(marca);
    } else {
      out.append(document.createTextNode(parte));
    }
  }
}

$('copyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.displayed);
    toast('Copiado al portapapeles.');
  } catch {
    toast('El navegador bloqueó el portapapeles.', 'error');
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
