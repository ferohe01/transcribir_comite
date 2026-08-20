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
/**
 * Saca la frase que hay dentro del error de un proveedor.
 *
 * Los SDK anidan JSON dentro de JSON: el error de Gemini llega como una cadena
 * JSON cuyo `message` es a su vez otra cadena JSON con el error de verdad. Con
 * una sola vuelta de desenvoltura, la pantalla acababa ensenando al usuario un
 * volcado que empezaba por `{"error":{"message":"{ \"error\": { \"code\": 429`.
 */
export function providerMessage(body) {
  let texto = typeof body === 'string' ? body : String(body?.message ?? body ?? '');

  // Tres vueltas bastan: ningun proveedor anida mas que eso.
  for (let i = 0; i < 3; i += 1) {
    let dentro;
    try {
      const parsed = JSON.parse(texto);
      dentro = parsed?.error?.message ?? parsed?.message ?? null;
    } catch {
      break;
    }
    if (typeof dentro !== 'string' || dentro === texto) break;
    texto = dentro;
  }

  return texto.replace(/\s+/g, ' ').trim();
}

// Lo que de verdad le ha pasado al usuario, dicho en su idioma. El texto del
// proveedor viene en ingles y a menudo con enlaces a su consola: sirve para el
// registro, no para la pantalla.
const CAUSAS = [
  {
    patron: /credits?\s+are\s+depleted|prepayment|billing|insufficient[_\s]quota/i,
    texto: (p) => `La cuenta de ${p} se ha quedado sin saldo. Elige otro modelo o recarga la cuenta del proveedor.`,
  },
  {
    patron: /resource[_\s]exhausted|rate.?limit|quota|too many requests/i,
    texto: (p) => `${p} ha alcanzado su limite de uso. Prueba con otro modelo o espera unos minutos.`,
  },
  {
    patron: /api.?key|unauthenticated|unauthorized|permission.?denied|invalid.?authentication/i,
    texto: (p) => `La clave de ${p} no es valida o no tiene permiso para este modelo.`,
  },
  {
    patron: /model.*not found|does not exist|unsupported model/i,
    texto: (p) => `El modelo elegido ya no existe en ${p}. Revisa el catalogo con: npm run check-models`,
  },
];

/**
 * Traduce el fallo de un proveedor a una frase que se pueda enseniar.
 *
 * Solo para la fase de plantillas. En la de transcripcion NO se usa: alli el
 * motivo concreto del proveedor ("7200 seconds of audio per hour") es lo que
 * aparece en la barra de progreso y explica por que un fragmento paso al motor
 * de respaldo; cambiarlo por una frase generica quita informacion util.
 *
 * Si no encaja en ninguna causa conocida se devuelve el mensaje del proveedor
 * ya desenvuelto: vale mas un texto en ingles que un volcado de JSON.
 */
export function describeProviderError(provider, body) {
  const crudo = providerMessage(body);
  const causa = CAUSAS.find((c) => c.patron.test(crudo));
  return causa ? causa.texto(provider) : crudo.slice(0, 300);
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
