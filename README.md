# Servicio de transcripcion de audio

Aplicacion web para transcribir grabaciones largas con IA y procesarlas con
plantillas reutilizables. Pensada para desplegarse en un VPS con Docker.

Sustituye a la version anterior, que era un `.exe` de escritorio: mandaba el
audio entero a la API de un tiron, sin comprimir ni trocear, y el "progreso"
del navegador era una animacion temporizada, no el estado real.

## Que hace

- **Transcribe audio largo rapido.** Comprime, trocea por silencios y transcribe
  los fragmentos en paralelo. Una grabacion de una hora se procesa en 10
  segundos con Groq y en minuto y medio con Gemini.
- **Separa transcribir de procesar.** Primero obtiene la transcripcion literal
  con marcas de tiempo y hablantes; despues aplica una plantilla (acta de
  reunion, resumen, evaluacion de proyectos, o la tuya). Cambiar de plantilla
  tarda segundos y no vuelve a transcribir ni a pagar el audio.
- **Cola de trabajos con progreso real.** Puedes cerrar la pestana: el trabajo
  sigue en el servidor y aparece luego en tu historial.
- **Varios motores con respaldo automatico.** Groq, OpenAI y Gemini,
  seleccionables por trabajo. Si el motor elegido rechaza un fragmento o agota
  su cuota, otro lo recoge y el trabajo termina igual; la interfaz dice cuantos
  fragmentos se desviaron y por que.
- **Cache por archivo.** Resubir el mismo audio devuelve el resultado al
  instante en lugar de volver a pagarlo.

## Como funciona

```
Subida  →  Analizar    →  Detectar pausas  →  Comprimir cada    →  Transcribir      →  Fusionar
           (ffprobe)      (sin codificar)     fragmento en          (N en paralelo)     (+ offsets)
                                              paralelo
```

Medido sobre una grabacion real de comite tecnico de 1 h 00 min (20,6 MB), en
una maquina de 12 nucleos:

| Etapa | Tiempo |
|---|---|
| Analizar y hashear | 1,0 s |
| Preparar (detectar pausas 2,4 s + comprimir 6 fragmentos en paralelo 3,5 s) | 5,9 s |
| Transcribir 6 fragmentos en paralelo (Groq) | 3,1 s |
| Fusionar | 0,0 s |
| **Total con Groq Whisper Turbo** | **10,0 s — 362x tiempo real** |
| Total con Gemini 3.7 Flash | 90 s — 40x |
| Resubir el mismo archivo | 2,3 s (cache) |
| Aplicar otra plantilla | 8-13 s, sin retranscribir |

Coste de esa hora de audio: $0,04 con Groq, $0,06 con Gemini.

Dos decisiones explican casi todo el rendimiento:

- **Comprimir a Opus mono 16 kHz.** Los motores ASR remuestrean a eso de todos
  modos, asi que no cuesta precision, y reduce a un tercio lo que hay que subir
  en cada peticion (20,6 MB → 6,6 MB).
- **Detectar las pausas antes de comprimir, no durante.** Parecia gratis
  hacerlo de paso mientras se codificaba, pero obligaba a que la compresion
  fuese un unico proceso secuencial de 22 s. Separandolo, la deteccion cuesta
  2,4 s y la compresion se reparte entre todos los nucleos: 5,9 s en total en
  lugar de 24,7 s.

## Puesta en marcha

Para el VPS, sigue **[DEPLOY.md](DEPLOY.md)**: hay una via para servidores con
Dokploy (`docker-compose.dokploy.yml`, sin Caddy porque Traefik ya cubre el
HTTPS) y otra para un servidor limpio (`docker-compose.yml`, con Caddy).

Para desarrollo local necesitas Node 22+ y ffmpeg en el PATH:

```bash
npm install
cp .env.example .env        # rellena las claves y SESSION_SECRET
npm run create-user -- tu@correo.com
npm start                   # http://localhost:3001
```

Sin `REDIS_URL` la cola corre dentro del propio proceso, asi que en local no
hace falta levantar Redis ni un worker aparte.

### Quien puede entrar

Cada transcripcion gasta creditos de API de quien monta el servicio, asi que
el acceso no esta abierto de par en par. Hay dos vias de alta:

- **Codigo de invitacion.** Si `SIGNUP_CODE` tiene valor, la pantalla de
  acceso ofrece *Crear una cuenta* y entra quien conozca el codigo. Es la via
  para repartir acceso sin dar de alta a nadie a mano. Cambiar el codigo cierra
  la puerta a quien lo tuviera, sin tocar las cuentas ya creadas.
- **Terminal.** Con `SIGNUP_CODE` vacio el registro desaparece de la interfaz y
  las altas se hacen solo con `npm run create-user`. Los administradores
  (`--admin`) se crean siempre asi: un alta desde la web nunca lo es.

## Comandos

| Comando | Para que |
|---|---|
| `npm start` | Arranca el servidor |
| `npm run worker` | Worker independiente (solo con Redis) |
| `npm test` | Pruebas automaticas, sin red |
| `npm run create-user -- correo@ejemplo.com [--admin]` | Da de alta un usuario |
| `npm run delete-user -- correo@ejemplo.com` | Da de baja un usuario y todo lo suyo |
| `npm run check-models` | Verifica que los modelos del catalogo siguen existiendo |
| `npm run transcribe -- audio.mp3 [--model groq-whisper-turbo]` | Transcribe desde la terminal, sin servidor |

## Motores disponibles

Se configuran en `src/config/models.js`; el desplegable de la interfaz solo
muestra aquellos cuya clave de API este presente.

| Motor | Cuando usarlo |
|---|---|
| **Groq · Whisper Large v3 Turbo** | Por defecto. El mas rapido (362x tiempo real de principio a fin) y el mas barato (~$0,04/hora). Marcas de tiempo exactas. No identifica hablantes. |
| Groq · Whisper Large v3 | Algo mas lento, mejor con audio dificil. |
| OpenAI · GPT-4o (mini) Transcribe | Buena precision. La variante `diarize` identifica hablantes. |
| Google · Gemini 3.7 Flash / 3.1 Pro | Identifica hablantes y produce texto mas limpio, pero las marcas de tiempo son estimadas y su filtro de contenido rechaza audio legitimo (ver abajo). |

Comparados sobre el mismo audio de una hora: Groq da la ultima marca en
01:00:01 para un audio de 01:00:16 (exacta, viene del decodificador), mientras
que Gemini llegaba a 01:06:50 antes de acotarla. A cambio, Gemini etiqueta
"Hablante 1/2/3" y limpia mejor el texto.

`npm run check-models` consulta las APIs en vivo y avisa de los modelos del
catalogo que un proveedor haya retirado.

## Limitaciones conocidas

- **El filtro de contenido de Gemini rechaza audio legitimo.** En la grabacion
  de prueba rechazo 2 de 6 fragmentos de una reunion de trabajo normal, con
  `PROHIBITED_CONTENT`. Poner los umbrales de seguridad en OFF recupera algunos;
  el resto los bloquea un filtro no configurable. Por eso el pipeline reintenta
  cada fragmento rechazado con otro modelo. Ten configurada la clave de Groq o
  de OpenAI para que ese respaldo use un motor sin filtro.
- **Las marcas de tiempo de Gemini son aproximadas.** Las estima en lugar de
  medirlas: en la prueba de 1 h 00 min llego a devolver marcas de 1 h 06 min.
  El sistema las acota al tramo real de cada fragmento, pero si necesitas
  marcas exactas usa Groq u OpenAI, que las obtienen del decodificador.
- **Gemini razona antes de responder** y gasta unos 30.000 tokens de pensamiento
  por fragmento de diez minutos. Encarece y ralentiza frente a un modelo ASR
  puro.
- **El plan gratuito de Groq permite 7.200 segundos de audio por hora** (dos
  horas). Al superarlo responde 429 con `Retry-After` de dos minutos largos, de
  forma sostenida. El sistema no se queda colgado: informa del motivo en la
  barra de progreso y, si hay otro motor configurado, pasa a el fragmento a
  fragmento y avisa en pantalla de cuantos se transcribieron con el respaldo y
  por que. Sin motor alternativo, espera hasta 150 s y despues falla con el
  mensaje del proveedor. Para uso intensivo, plan de pago de Groq o repartir
  con OpenAI.

## Estructura

```
src/
├─ server.js          arranque y apagado ordenado
├─ app.js             la aplicacion Express (aparte, para poder probarla)
├─ pipeline.js        analizar → preparar → transcribir → fusionar
├─ config/models.js   catalogo de motores y modelos
├─ audio/             ffmpeg: probe, split (pausas y cortes), prepare, merge
├─ engines/           groq, openai, gemini + reintentos y concurrencia
├─ llm/               plantillas de post-proceso
├─ queue/             cola (Redis o en proceso) y worker
├─ routes/            auth, jobs (+SSE), transcripts, meta
├─ db/                SQLite: usuarios, trabajos, transcripciones, salidas
└─ public/            interfaz web
legacy/               la version anterior, archivada como referencia
```

## Licencia

MIT
