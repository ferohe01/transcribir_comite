/**
 * Cliente HTTP con timeout, reintentos y limite de espera.
 *
 * La version anterior llamaba a `fetch` sin timeout ni reintentos: un 429 del
 * proveedor tumbaba la transcripcion entera despues de varios minutos de
 * trabajo. Aqui se reintenta con retroceso exponencial ante 408/429/5xx y
 * errores de red, respetando la cabecera `Retry-After` cuando llega.
 *
 * La espera total esta acotada a proposito. El plan gratuito de Groq permite
 * 7.200 segundos de audio por hora; al superarlo responde 429 con
 * `Retry-After: 100` una y otra vez, y sin tope el proceso se quedaba
 * esperando en silencio mas de diez minutos. Es mejor rendirse pronto con un
 * mensaje que explique el limite real que dejar al usuario mirando una barra
 * congelada.
 */

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class ApiError extends Error {
  constructor(message, { status, provider, retryable = false, rateLimited = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.provider = provider;
    this.retryable = retryable;
    this.rateLimited = rateLimited;
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Operacion cancelada'));
    }, { once: true });
  });

/** Extrae el mensaje util de un error del proveedor, sin el JSON alrededor. */
function providerMessage(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed.error?.message ?? parsed.message ?? body;
  } catch {
    return body;
  }
}

export async function fetchWithRetry(url, options = {}, {
  provider = 'api',
  attempts = 4,
  timeoutMs = 300_000,
  // Tope de espera acumulada entre reintentos. Quien llama puede acortarlo:
  // si hay un motor de respaldo disponible, esperar a que el proveedor
  // saturado se recupere sale mucho mas caro en tiempo que cambiar de motor.
  maxTotalWaitMs = 150_000,
  onRetry = null,
  signal,
} = {}) {
  let lastError;
  let waited = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // La peticion y la decision de reintentar van en bloques separados a
    // proposito: teniendolas en el mismo try, un `throw` para rendirse acababa
    // capturado por el propio `catch` del bucle, que lo interpretaba como un
    // fallo reintentable y seguia dando vueltas.
    let suggestedDelayMs = null;

    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await fetch(url, { ...options, signal: composed });

      if (response.ok) return response;

      const body = await response.text().catch(() => '');
      lastError = new ApiError(`${provider}: ${providerMessage(body).slice(0, 400)}`, {
        status: response.status,
        provider,
        retryable: RETRYABLE_STATUS.has(response.status),
        rateLimited: response.status === 429,
      });

      const retryAfter = Number.parseFloat(response.headers.get('retry-after') ?? '');
      if (Number.isFinite(retryAfter)) suggestedDelayMs = retryAfter * 1000;
    } catch (error) {
      if (signal?.aborted) throw new Error('Operacion cancelada');
      // Error de red o timeout: reintentable.
      lastError = new ApiError(`${provider}: ${error.message}`, { provider, retryable: true });
    }

    if (!lastError.retryable || attempt === attempts) throw lastError;

    const delay = suggestedDelayMs ?? Math.min(30_000, 2 ** attempt * 500 + Math.random() * 500);
    if (waited + delay > maxTotalWaitMs) throw lastError;

    onRetry?.({
      attempt,
      delayMs: delay,
      status: lastError.status,
      message: lastError.message,
      rateLimited: lastError.rateLimited,
    });
    waited += delay;
    await sleep(delay, signal);
  }

  throw lastError;
}

/** Ejecuta tareas con un limite de concurrencia, conservando el orden. */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
