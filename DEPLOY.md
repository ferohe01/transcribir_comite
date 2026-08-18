# Despliegue en el VPS

Pasos exactos, de principio a fin. Tiempo estimado: 15 minutos.

## Antes de empezar

**Rota las claves de API.** La version anterior empaquetaba el archivo `.env`
dentro de `convierte_audio_texto_v3.exe`, asi que cualquiera que recibiera ese
ejecutable tiene tus claves de OpenAI y Gemini. Ademas quedan copias del `.exe`
en otras carpetas del equipo.

1. OpenAI: https://platform.openai.com/api-keys — revoca la antigua y crea una nueva.
2. Gemini: https://aistudio.google.com/apikey — igual.
3. Groq (recomendado, gratuito): https://console.groq.com/keys

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

No hay registro publico: los usuarios se dan de alta desde la terminal.

```bash
# Con contrasena generada automaticamente (se muestra una sola vez)
docker compose exec app npm run create-user -- persona@empresa.com

# O eligiendola tu
docker compose exec app npm run create-user -- persona@empresa.com --password "una-contrasena-larga"
```

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
| `TRANSCRIBE_CONCURRENCY` | 4 | Fragmentos que se transcriben a la vez. Subirlo acelera cada trabajo hasta que el proveedor empieza a devolver 429. |
| `WORKER_CONCURRENCY` | 2 | Trabajos simultaneos. La compresion usa todos los nucleos disponibles por trabajo, asi que subirlo en una maquina pequena no compensa. |
| `CHUNK_TARGET_SECONDS` | 600 | Duracion de cada fragmento. Bajarlo aumenta el paralelismo; subirlo da mas contexto al modelo. |

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
