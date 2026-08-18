# Despliegue en el VPS

Hay dos caminos, segun como este montado el servidor:

- **[Con Dokploy](#despliegue-con-dokploy)** — si el VPS ya tiene Dokploy, que
  trae su propio Traefik. Usa `docker-compose.dokploy.yml`.
- **[Docker Compose a pelo](#despliegue-con-docker-compose)** — servidor limpio,
  sin nada mas escuchando en los puertos 80 y 443. Usa `docker-compose.yml`,
  que incluye Caddy.

Los dos comparten los pasos de **Antes de empezar** y de **Crear usuarios**.

## Antes de empezar

**Rota las claves de API.** La version anterior empaquetaba el archivo `.env`
dentro de `convierte_audio_texto_v3.exe`, asi que cualquiera que recibiera ese
ejecutable tiene tus claves de OpenAI y Gemini. Ademas quedan copias del `.exe`
en otras carpetas del equipo.

1. OpenAI: https://platform.openai.com/api-keys — revoca la antigua y crea una nueva.
2. Gemini: https://aistudio.google.com/apikey — igual.
3. Groq (recomendado, gratuito): https://console.groq.com/keys

---

# Despliegue con Dokploy

Dokploy ya ocupa los puertos 80 y 443 con su propio Traefik, asi que este
proyecto trae un compose aparte, `docker-compose.dokploy.yml`, **sin Caddy y
sin publicar puertos**. Usar el `docker-compose.yml` normal en Dokploy falla
por conflicto de puertos.

## 1. Crear el servicio

En Dokploy: **Create Service → Compose**.

| Campo | Valor |
|---|---|
| Provider | GitHub |
| Repository | `ferohe01/transcribir_comite` |
| Branch | `MIT-cloud-devops` |
| Compose Path | `docker-compose.dokploy.yml` |

Si el repositorio es privado, conecta antes la cuenta de GitHub en
**Settings → Git Providers**.

## 2. Variables de entorno

En la pestana **Environment** del servicio. Dokploy las escribe en un `.env`
que el compose consume:

```ini
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=...
SESSION_SECRET=<resultado de: openssl rand -hex 32>
PUBLIC_HOST=transcript.tudominio.com
```

`SESSION_SECRET` debe tener al menos 32 caracteres o el servicio no arranca.

## 3. Dominio

En la pestana **Domains**, anadir uno:

| Campo | Valor |
|---|---|
| Host | `transcript.tudominio.com` |
| Service Name | `app` |
| Container Port | `3001` |
| HTTPS | activado (Let's Encrypt) |

El registro `A` del dominio debe apuntar ya a la IP del VPS: Traefik no
consigue el certificado hasta que el DNS resuelva.

## 4. Desplegar

Pulsa **Deploy**. La primera vez tarda unos minutos (se compila
better-sqlite3 y se instala ffmpeg en la imagen).

Comprobacion:

```bash
curl -f https://transcript.tudominio.com/api/health
```

## 5. Crear el primer usuario

Desde la pestana **Terminal** del servicio, o por SSH en el VPS:

```bash
docker exec -it $(docker ps -qf name=app) npm run create-user -- tu@correo.com
```

Si no hay terminal interactiva, el comando genera una contrasena y la muestra
una sola vez.

Para que el resto se cree la cuenta sin pasar por aqui, anade la variable
`SIGNUP_CODE` en **Environment** y pulsa Redeploy: la pantalla de acceso
mostrara entonces *Crear una cuenta* y pedira ese codigo. Reparte el codigo
solo a quien deba usar el servicio; cada transcripcion gasta creditos de tus
claves de API.

## Notas sobre Dokploy

- **Subidas grandes.** Traefik no limita el tamano del cuerpo por defecto, asi
  que un audio de varios cientos de MB pasa sin tocar nada. Si tienes un
  Cloudflare por delante en modo proxy, ahi si hay un limite de 100 MB en los
  planes gratuitos: pon el registro en modo "DNS only" o comprime el audio
  antes de subirlo.
- **La barra de progreso** viaja por Server-Sent Events. Traefik no almacena la
  respuesta en un buffer, asi que funciona sin configuracion extra.
- **Actualizar**: `git push` y luego **Redeploy** en Dokploy. Los volumenes
  `data` y `redis` sobreviven al redespliegue.
- **Copia de seguridad**: todo lo que importa esta en el volumen `data`.
  ```bash
  docker run --rm -v transcribir_comite_data:/d -v $PWD:/b alpine     tar czf /b/backup-$(date +%F).tar.gz -C /d .
  ```
  El nombre exacto del volumen sale de `docker volume ls`.

---

# Despliegue con Docker Compose

Para un VPS limpio, sin Dokploy ni nada mas en los puertos 80 y 443. Este
camino usa `docker-compose.yml`, que incluye Caddy para el HTTPS.

## 1. Requisitos en el VPS

Solo hace falta Docker. Todo lo demas (Node, ffmpeg, Redis, Caddy) va dentro de
los contenedores.

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # cierra sesion y vuelve a entrar
```

Recursos: 2 nucleos y 2 GB de RAM bastan para un equipo pequeno. El disco lo
consume sobre todo la base de datos de transcripciones (texto, muy poco); el
audio se borra en cuanto termina cada trabajo.

## 2. DNS

Apunta un registro `A` de tu dominio (por ejemplo `transcript.tudominio.com`)
a la IP del VPS. Caddy no podra emitir el certificado hasta que el DNS resuelva.

## 3. Copiar el proyecto

```bash
git clone <tu-repositorio> /opt/transcript   # o subelo por scp
cd /opt/transcript
```

## 4. Configurar

```bash
cp .env.example .env
nano .env
```

Lo minimo:

```ini
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=...
SESSION_SECRET=<pega aqui el resultado de: openssl rand -hex 32>
PUBLIC_HOST=transcript.tudominio.com
NODE_ENV=production
```

`SESSION_SECRET` debe tener al menos 32 caracteres o el servicio no arranca.

## 5. Abrir el cortafuegos

```bash
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
```

Los puertos 80 y 443 son de Caddy. La aplicacion (3001), Redis y la base de
datos no se exponen: solo son accesibles desde la red interna de Docker.

## 6. Arrancar

```bash
docker compose up -d --build
docker compose ps          # los cuatro servicios en "running"/"healthy"
docker compose logs -f app
```

La primera compilacion tarda unos minutos (se compila better-sqlite3 y se
instala ffmpeg). Caddy pide el certificado solo, en unos segundos.

## 7. Crear usuarios

Con `SIGNUP_CODE` vacio no hay registro publico y las altas se hacen desde la
terminal:

```bash
# Con contrasena generada automaticamente (se muestra una sola vez)
docker compose exec app npm run create-user -- persona@empresa.com

# O eligiendola tu
docker compose exec app npm run create-user -- persona@empresa.com --password "una-contrasena-larga"
```

Si prefieres que cada uno se cree la cuenta, pon un codigo de invitacion en el
`.env` y reinicia:

```bash
echo "SIGNUP_CODE=$(openssl rand -base64 12)" >> .env
docker compose up -d
```

La pantalla de acceso ofrecera entonces *Crear una cuenta*, pidiendo ese codigo
ademas del correo y la contrasena. Las cuentas asi creadas son siempre de rol
`user`; los administradores siguen saliendo de `create-user --admin`.

## 8. Comprobar

```bash
curl -f https://transcript.tudominio.com/api/health
```

Debe devolver `"ok": true` y `"ffmpeg": {"ok": true}`. Luego entra desde el
navegador, inicia sesion y sube un audio.

---

## Operacion

### Actualizar

```bash
cd /opt/transcript && git pull
docker compose up -d --build
```

Los datos viven en volumenes de Docker: no se pierden al reconstruir.

### Copia de seguridad

Todo lo que importa esta en el volumen `data` (transcripciones, usuarios,
historial):

```bash
docker compose exec app tar czf - -C /app/data . > backup-$(date +%F).tar.gz
```

Restaurar:

```bash
docker compose down
docker compose run --rm -T app tar xzf - -C /app/data < backup-2026-08-18.tar.gz
docker compose up -d
```

### Registros

```bash
docker compose logs -f app      # peticiones y errores
docker compose logs -f worker   # progreso de las transcripciones
docker compose logs -f caddy    # certificados y accesos
```

### Ajustar el rendimiento

En `.env`:

| Variable | Por defecto | Que hace |
|---|---|---|
| `TRANSCRIBE_CONCURRENCY` | 4 | Fragmentos que se transcriben a la vez. El valor por defecto es prudente para planes gratuitos. **Con un plan de pago, ponlo en 8.** |
| `WORKER_CONCURRENCY` | 2 | Trabajos simultaneos. La compresion usa todos los nucleos disponibles por trabajo, asi que subirlo en una maquina pequena no compensa. |
| `CHUNK_TARGET_SECONDS` | 600 | Duracion de cada fragmento. Dejalo como esta: ver la medicion de abajo. |

### Que gana cada ajuste, medido

Sobre la grabacion de 1 h 00 min con Groq y limites de plan de pago:

| Configuracion | Total | Preparar | Transcribir |
|---|---|---|---|
| 600 s / concurrencia 4 | 9,3 s | 5,8 s | 2,6 s |
| **600 s / concurrencia 8** | **8,6 s** | 5,8 s | 1,8 s |
| 300 s / concurrencia 12 | 7,9 s | 5,8 s | 1,2 s |
| 180 s / concurrencia 12 | 9,2 s | 6,2 s | 2,1 s |

Subir la concurrencia a 8 es gratis y ahorra ~1 s. Acortar los fragmentos a
300 s ahorra otros 0,7 s, pero no compensa: da mas cortes donde se puede
perder contexto, y el margen es ruido. Por debajo de 300 s empeora, porque el
coste de arrancar un proceso de ffmpeg por fragmento se come la ganancia.

El tiempo esta dominado por la preparacion (5,8 s), que apenas se mueve: son
2,4 s de detectar pausas mas 3,5 s de comprimir repartidos entre los nucleos.
Ahi es donde habria que mirar si algun dia hicieran falta menos de 8 segundos
por hora de audio.

Para mas capacidad, escala el worker en vez de tocar la app:

```bash
docker compose up -d --scale worker=3
```

---

## Problemas frecuentes

**Caddy no consigue el certificado.** Comprueba que el DNS ya resuelve a la IP
del VPS (`dig +short transcript.tudominio.com`) y que los puertos 80 y 443
estan abiertos. Let's Encrypt limita los reintentos, asi que arregla el DNS
antes de insistir.

**La barra de progreso no avanza.** El progreso viaja por Server-Sent Events.
Si has puesto otro proxy inverso por delante de Caddy, desactiva su buffer de
respuesta (`proxy_buffering off` en Nginx).

**"ffmpeg no esta disponible".** Solo puede pasar fuera de Docker; la imagen lo
incluye. Reconstruye con `docker compose build --no-cache app`.

**Un trabajo se queda en "En cola".** Mira si el worker esta vivo
(`docker compose ps worker`) y si Redis responde
(`docker compose exec redis redis-cli ping`).

**Transcripciones incompletas con Gemini.** Su filtro de contenido rechaza
fragmentos de audio perfectamente normales. El sistema reintenta cada fragmento
rechazado con otro modelo automaticamente, pero conviene tener configurada la
clave de Groq o la de OpenAI para que ese respaldo use un motor sin filtro.

**"Limite de uso del proveedor" en la barra de progreso.** El plan gratuito de
Groq permite 7.200 segundos de audio por hora; al superarlo devuelve 429 hasta
que la ventana se renueva. El sistema espera y reintenta, y si la espera se
alarga falla con el mensaje del proveedor en lugar de quedarse colgado. Con uso
diario de varias horas de audio conviene pasar al plan de pago de Groq o
repartir la carga con OpenAI.
