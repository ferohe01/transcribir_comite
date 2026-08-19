# Guia del proyecto

Servicio web que transcribe grabaciones largas de reuniones (1-3 h) con modelos
de ASR y despues aplica **plantillas** —prompts guardados— sobre el texto para
producir actas, evaluaciones de proyectos o resumenes. Node 22, Express 5,
SQLite, sin framework de frontend. Todo en castellano: interfaz, comentarios y
mensajes de commit.

Este archivo existe para no tener que leerse el proyecto entero. Cubre lo que
no es evidente leyendo el codigo por encima. Lo demas ya esta escrito:

- **[README.md](README.md)** — que hace, rendimiento medido, motores
  disponibles y limitaciones conocidas de cada proveedor.
- **[DEPLOY.md](DEPLOY.md)** — despliegue en el VPS, variables de entorno,
  copias de seguridad y ajuste de rendimiento.

---

## La idea central: dos fases separadas

Es lo unico que hay que entender para orientarse en el resto.

```
FASE 1  audio -> texto        modelo ASR      cuesta minutos y dinero
FASE 2  texto -> documento    modelo de chat  cuesta segundos
```

Las dos fases usan **modelos distintos y catalogos distintos** (`ASR_MODELS` y
`LLM_MODELS` en `src/config/models.js`). El modelo de la fase 2 nunca oye el
audio: recibe el texto ya transcrito mas el prompt de la plantilla.

Separarlas es lo que hace que cambiar de plantilla cueste segundos en lugar de
volver a transcribir. La transcripcion se guarda una vez; cada plantilla
aplicada se guarda aparte en `outputs`, ligada a esa transcripcion.

Cuando dudes de donde tocar algo, empieza por preguntarte de que fase es.

---

## Donde esta cada cosa

| Si quieres cambiar... | Mira |
|---|---|
| Que modelos se ofrecen, precios, capacidades | `src/config/models.js` |
| Los prompts de las plantillas | `src/llm/templates.js` |
| El troceado, la compresion o la fusion del audio | `src/audio/` |
| Como se llama a cada proveedor, reintentos, timeouts | `src/engines/` |
| El orden de las etapas de la transcripcion | `src/pipeline.js` |
| Cache, respaldo entre motores, guardado del resultado | `src/queue/processor.js` |
| Rutas HTTP | `src/routes/` (`auth`, `jobs`, `transcripts`, `meta`) |
| Esquema y consultas | `src/db/schema.sql` y `src/db/index.js` |
| La interfaz | `src/public/` (`index.html`, `app.js`, `styles.css`) |
| Sesiones, contrasenas, control de acceso | `src/auth/` |

`legacy/` es la version anterior, archivada como referencia. No se ejecuta y no
hay que mantenerla.

**Tamanos**, por si hay que decidir que leer entero: `public/app.js` 864
lineas, `public/styles.css` 590, `db/index.js` 285, `config/models.js` 257,
`public/index.html` 245, `routes/jobs.js` 225, `pipeline.js` 202. Ningun otro
archivo pasa de 175.

---

## Invariantes que se rompen sin darse cuenta

Cada una de estas costo un fallo real. Romperlas no da un error claro.

### La familia GPT-5 rechaza `temperature`

GPT-5.5, GPT-5 mini y GPT-5.6 Luna devuelven **400** ante cualquier
temperatura que no sea la suya por defecto. Por eso llevan `fixedTemperature:
true` en el catalogo y el motor omite el parametro
(`src/engines/openai-compatible.js`). Al anadir un modelo de OpenAI, **pruebalo
contra la API antes de darlo por bueno**: sin ese flag falla en cada plantilla,
no al arrancar.

### Las claves foraneas de SQLite van desactivadas por defecto

`getDb()` hace `pragma('foreign_keys = ON')`, y de eso dependen las cascadas:
borrar un trabajo se lleva su transcripcion y todas sus salidas. Cualquier
script suelto que abra la base de datos **tiene que repetir ese pragma**, o
dejara filas huerfanas invisibles.

### Las migraciones van antes del esquema

En `getDb()`, `migrate()` se ejecuta **antes** de aplicar `schema.sql`. El
esquema crea indices sobre columnas nuevas que en una base ya existente aun no
estan. Al reves falla con "no such column". Las columnas nuevas se anaden en
`migrate()`, no en el `CREATE TABLE`.

### Dos topes de espera distintos, a proposito

`fetchWithRetry` usa 300 s por defecto (transcripcion: cada peticion es un
fragmento de diez minutos) y **15 minutos** en la ruta de chat
(`CHAT_TIMEOUT_MS`), porque aplicar una plantilla a una reunion larga puede
tardar minutos escribiendo. Agotar el tope **no da un error limpio**: el
`AbortSignal` sigue vivo sobre el cuerpo de la respuesta y corta el stream a la
mitad, perdiendo el texto ya generado. No unifiques los dos valores.

### La clave de cache cubre cuatro cosas

`cacheKeyFor()` en `src/queue/processor.js` mezcla **audio, modelo, idioma y
vocabulario**. Si anades algo que cambie el resultado de una transcripcion,
tiene que entrar en esa clave; si no, subir el mismo archivo devolvera el texto
viejo y el cambio parecera no surtir efecto.

Un acierto de cache marca `from_cache = 1` en el trabajo, y la interfaz oculta
velocidad, fragmentos y coste. Sin eso, reutilizar texto se presentaba como una
transcripcion instantanea de cero fragmentos a 11000x tiempo real.

### El progreso no viaja por la cola

El worker lo escribe en SQLite y el endpoint SSE lo lee de ahi. Asi funciona
igual con Redis y sin el, sin canal de pub/sub entre procesos.

### La cola tiene dos modos

Con `REDIS_URL` usa BullMQ y un worker aparte (es lo del VPS); sin ella corre
en el propio proceso (desarrollo local). Misma interfaz. Al tocar la cola hay
que comprobar los dos caminos.

### La interfaz solo ofrece modelos con clave configurada

`availableModels()` filtra por `envKey`. Un modelo en el catalogo sin su clave
en el entorno simplemente no aparece en el desplegable. Si alguien dice que
"falta un modelo", suele ser esto y no un fallo.

### SQLite guarda las fechas en UTC sin sufijo

`datetime('now')` produce `2026-08-19 15:04:05`, sin `Z`. El cliente le anade
la `T` y la `Z` antes de convertir (`relativeTime` en `app.js`). Sin eso, el
navegador lo interpreta como hora local y muestra desfases.

### Nada de CDNs

La politica de seguridad de contenido (helmet, en `src/app.js`) solo permite
recursos propios. Por eso los iconos son SVG en linea y no hay tipografias ni
scripts externos. Anadir una etiqueta a un CDN no falla al escribirla: falla en
el navegador, en silencio.

### Rutas relativas en el frontend

Todas las llamadas van a `/api/...`. La version anterior las tenia escritas
como `http://localhost:3001`, lo que impedia servir la aplicacion desde un
dominio.

---

## Seguridad y acceso

- **Contrasenas**: scrypt de `node:crypto` con los parametros de OWASP
  (N=2^17). Formato `scrypt$N$r$p$salt$hash`. Sin dependencias nativas
  adicionales a proposito.
- **Sesiones**: cookie `transcript.sid`, 7 dias, `rolling`, almacenadas en
  `data/sessions.db`. El id se regenera al autenticarse (fijacion de sesion).
- **Altas**: hay dos vias. Con `SIGNUP_CODE` en el entorno, la pantalla de
  acceso ofrece crear cuenta y pide ese codigo; sin ella, el registro
  desaparece de la interfaz y las altas son solo por
  `npm run create-user`. Los administradores salen siempre de ahi: un alta
  desde la web es siempre rol `user`. El codigo se compara en tiempo constante
  y **antes** que nada mas, para que la ruta no sirva de comprobador de que
  correos estan dados de alta.
- **Limites**: 10 intentos de acceso por IP cada 15 minutos; 10 de registro por
  hora.
- **Aislamiento**: todo lo que devuelve datos filtra por `user_id`. Un trabajo,
  su transcripcion y sus salidas solo son visibles para quien los creo.

Cada transcripcion gasta creditos de API de quien monta el servicio. Esa es la
razon de que el acceso no este abierto; tenlo presente antes de relajarlo.

---

## Base de datos

`data/transcript.db`, SQLite en modo WAL. Cinco tablas:

```
users ──< jobs ──< transcripts ──< outputs
  └──< templates                (plantillas propias de cada usuario)
```

Todas las flechas son `ON DELETE CASCADE`. Borrar un usuario o un trabajo se
lleva por delante los documentos generados, que es lo que cuesta dinero: avisa
de cuantos son antes de borrar nada. `listForUser` devuelve `output_count` por
trabajo justo para poder decirlo.

`transcripts.cache_key` indexa la reutilizacion. Las filas anteriores a esa
columna se quedan sin clave y por tanto fuera de la cache, a proposito: se
crearon sin registrar con que idioma ni vocabulario y no se puede saber si
servirian.

---

## La interfaz

Vanilla: sin framework, sin compilacion, tres archivos. `index.html` es la
aplicacion entera; `app.js` la mueve; `styles.css` es el sistema visual.

**Sistema visual (minimalista, agosto 2026).** Lienzo gris neutro, secciones de
papel plano con borde de 1px, sin sombras. El violeta (`--brand`) aparece **solo
en cuatro sitios**: el boton principal, el anillo de foco, la barra de progreso
y el resultado seleccionado. Si vas a anadir color, esa es la regla que hay que
respetar o romper a conciencia.

Todo sale de tokens en `:root`: tres intensidades de acento, tres pesos de
tinta, una escala tipografica de cinco pasos (`--t-xs` a `--t-xl`). **Los pares
de color estan medidos y todos cumplen 4,5:1**; el mas ajustado es 5,11. Si
tocas un color, vuelve a medirlo: el violeta anterior daba 3,66:1 en el boton
principal, que era su uso mas importante.

**Cuidado con dos cosas al maquetar:**

- Las columnas separan sus tarjetas con `gap` de rejilla, no con
  `.card + .card`. La tarjeta de progreso empieza oculta, y el selector de
  hermano adyacente no distingue oculto de visible: descuadraba las dos
  columnas 20px.
- La zona de subida es una `<label>` con el `<input type="file">` **dentro**,
  oculto con `clip-path` y no con `display: none`, que lo sacaria del orden de
  foco. Era la unica forma de poder elegir archivo con el teclado. No la
  conviertas en un `div` con `onclick`.

---

## Verificar antes de dar algo por bueno

```bash
npm test              # 60 pruebas, sin red, ~5 s
npm run check-models  # comprueba contra las APIs que los modelos existen
```

`npm test` monta la API sobre una base de datos temporal y no toca la real. Las
pruebas de motores simulan `fetch`, asi que no gastan creditos.

Para probar la interfaz hace falta **ffmpeg en el PATH**; sin el, `/api/health`
responde 503 y toda subida falla en el analisis inicial.

Si esta instalada la skill de diseno `impeccable`, su detector es util tras
tocar el frontend:

```bash
node <ruta-skill>/scripts/detect.mjs --json src/public
```

Debe devolver `[]`.

---

## Despliegue

VPS con **Dokploy**, desde `ferohe01/transcribir_comite`, rama
`MIT-cloud-devops`, con `docker-compose.dokploy.yml`. El ciclo es `git push` y
despues **Redeploy** en el panel; no hay despliegue automatico.

Las variables se rellenan en la pestana **Environment** de Dokploy. Ojo: ese
compose **enumera las variables una a una**, asi que anadir una al `.env` no
basta — hay que anadirla tambien al archivo, o no llegara al contenedor.

Detalles completos en [DEPLOY.md](DEPLOY.md).

---

## Estado conocido y deuda pendiente

De una revision de diseno de agosto de 2026. Ninguno esta arreglado; estan
ordenados por lo que mas afecta a quien usa la aplicacion.

1. **La subida no tiene indicador de progreso.** Un archivo de 500 MB puede
   ser siete minutos de spinner sin porcentaje, sin bytes y sin poder
   cancelar. Es el peor momento del producto y precede a todos los demas.
2. **No hay tiempo estimado.** `duration_s` se conoce por ffprobe antes de
   empezar y las estadisticas presumen de "142x tiempo real" *despues*: hay
   todo lo necesario para decir "unos 4 minutos" en el segundo cero.
3. **Los errores se entregan en un toast de 4 segundos** sin `role="alert"`,
   que no se puede pausar ni copiar. Los mensajes del servidor son buenos y a
   menudo tardan mas de 4 s en leerse.
4. **Sin cancelar un trabajo en curso** ni reintentar uno fallido.
5. **No se puede comparar los 8 motores**: la ayuda describe solo el
   seleccionado, y el catalogo ya marca `recommended: true` en Groq Turbo, que
   el frontend ignora.
6. **`source.close()` en el manejador de error de SSE** mata la reconexion
   automatica de EventSource. Un corte de red de 20 s desconecta la interfaz de
   un trabajo de 3 horas de forma permanente.
7. **La expiracion de sesion a media faena** deja una pantalla de acceso en
   blanco sin explicacion: `openJob` y `loadHistory` no capturan el error que
   lanza `api()` tras llamar a `showLogin()`.
8. **Las salidas se renderizan con `textContent` en monoespaciada**, pero las
   plantillas emiten Markdown: se lee `**Acuerdos**` literal. Un acta es prosa,
   no un listado de codigo.

**La oportunidad mas grande**, si hay una version siguiente: `GET /api/jobs/:id`
devuelve `segments` con marcas de tiempo (6 de los 9 motores las dan) y el
frontend **no las lee nunca**. Existe un `<audio>` que solo se usa como vista
previa del archivo a subir y nunca se restaura al reabrir un trabajo. La unica
interaccion que solo puede ofrecer una herramienta de transcripcion —pinchar
una frase y oir ese momento— esta pagada por el backend y sin construir.
