# Entrega a la Unidad de TI

Este documento acompana la entrega del codigo fuente del **servicio de
transcripcion** para que la Unidad de TI lo despliegue en un servidor de la
institucion. Resume lo que hay que saber antes de empezar y remite a los
documentos que ya existen en el repositorio para el detalle.

- **[README.md](README.md)** — que hace la aplicacion, rendimiento medido y
  limitaciones de cada proveedor.
- **[DEPLOY.md](DEPLOY.md)** — procedimiento de despliegue paso a paso.
- **[CLAUDE.md](CLAUDE.md)** — notas tecnicas internas, utiles para quien vaya
  a modificar el codigo.

---

## 1. Que es

Aplicacion web que transcribe grabaciones largas de reuniones (1-3 h) y despues
aplica plantillas sobre el texto para producir actas, evaluaciones o resumenes.
Node 22, Express 5, SQLite, sin framework de frontend.

Funciona en dos fases separadas:

```
FASE 1  audio -> texto        modelo de transcripcion (ASR)
FASE 2  texto -> documento    modelo de chat (LLM)
```

Los dos modelos son servicios externos en la nube (Groq, OpenAI, Google
Gemini). **La aplicacion no transcribe en local**: necesita salida a internet
hacia esos proveedores. Conviene confirmar ese punto con TI antes que ningun
otro (ver seccion 3).

## 2. Como obtener las fuentes

El codigo esta en GitHub, en `ferohe01/transcribir_comite`, rama
**`MIT-cloud-devops`** (es la rama por defecto y la que se despliega).

Lo recomendable es que TI **importe el repositorio al Git de la institucion** y
trabaje desde ahi: asi el repositorio pasa a ser suyo, con su control de
accesos, y las actualizaciones no dependen de una cuenta personal externa.

### Opcion A — importador de la plataforma

- **GitHub**: *New repository → Import a repository*, pegando la URL de origen.
- **GitLab**: *New project → Import project → Repository by URL*.

### Opcion B — clon espejo por linea de comandos

Funciona con cualquier plataforma (GitHub, GitLab, Gitea, Bitbucket):

```bash
git clone --mirror https://github.com/ferohe01/transcribir_comite.git
cd transcribir_comite.git
git push --mirror <URL-DEL-REPOSITORIO-INSTITUCIONAL>
```

Se lleva todo el historial y todas las ramas. Despues, en el servidor:

```bash
git clone <URL-DEL-REPOSITORIO-INSTITUCIONAL> /opt/transcript
cd /opt/transcript
```

> Si el repositorio de origen es privado, la cuenta que importa necesita acceso
> de lectura. Se concede desde *Settings → Collaborators*.

## 3. Requisitos del servidor

| | |
|---|---|
| Software | Solo **Docker** con el plugin `compose` v2. Node, ffmpeg, Redis y el proxy HTTPS van dentro de los contenedores. |
| CPU / RAM | 2 nucleos y 2 GB bastan para un equipo pequeno. Con 4 nucleos y 8 GB se procesan mas trabajos a la vez. |
| Disco | Poco: se guarda texto. El audio se borra en cuanto termina cada trabajo. 20 GB sobran. |
| Puertos entrantes | **80 y 443** abiertos desde internet. El 80 es imprescindible para que Let's Encrypt emita el certificado. La aplicacion (3001), Redis y la base de datos no se exponen. |
| DNS | Un registro `A` (por ejemplo `transcript.institucion.edu`) apuntando a la IP del servidor **antes** de arrancar. |

### Salida a internet: comprobar esto primero

El servidor debe poder abrir conexiones HTTPS salientes hacia los proveedores
que se vayan a usar:

| Proveedor | Destino |
|---|---|
| Groq (recomendado: el mas rapido y barato) | `api.groq.com` |
| OpenAI | `api.openai.com` |
| Google Gemini | `generativelanguage.googleapis.com` |

Ademas, al construir la imagen se descargan paquetes de `registry.npmjs.org` y
de los repositorios de Debian.

**Si la politica de red no permite esas salidas, el servicio no puede
funcionar**, porque no existe modo local: toda la transcripcion ocurre en la
API del proveedor. Es la unica dependencia que no se resuelve dentro del
servidor.

## 4. Lo que TI debe aportar

Nada de esto viaja en el repositorio, a proposito.

| Dato | De donde sale |
|---|---|
| `GROQ_API_KEY` | https://console.groq.com/keys |
| `OPENAI_API_KEY` (opcional) | https://platform.openai.com/api-keys |
| `GEMINI_API_KEY` (opcional) | https://aistudio.google.com/apikey |
| `SESSION_SECRET` | Generar con `openssl rand -hex 32`. **Minimo 32 caracteres o el servicio no arranca.** |
| `PUBLIC_HOST` | El dominio publico del servicio |
| `SIGNUP_CODE` (opcional) | Generar con `openssl rand -base64 12` |

Con una sola clave basta, pero conviene tener dos: si un proveedor rechaza un
fragmento o agota su cuota, el sistema reintenta automaticamente con otro motor
y el trabajo termina igual.

> **Las claves deben ser de la institucion, no las del proyecto original.**
> Cada transcripcion consume credito de la cuenta a la que pertenece la clave.
> Esa es tambien la razon de que el acceso a la aplicacion no sea abierto:
> quien entra, gasta.

## 5. Despliegue

El procedimiento completo esta en **[DEPLOY.md](DEPLOY.md)**, seccion
**"Despliegue con Docker Compose"**, la pensada para un servidor limpio. En
resumen:

```bash
cd /opt/transcript
cp .env.example .env
nano .env                      # rellenar lo de la seccion 4
docker compose up -d --build   # la primera vez tarda unos minutos
docker compose ps              # los cuatro servicios en running/healthy
```

Levanta cuatro contenedores: `app` (web), `worker` (procesa las
transcripciones), `redis` (cola) y `caddy` (HTTPS automatico).

> **Si el servidor ya tiene un proxy inverso** ocupando los puertos 80 y 443
> (Traefik, Nginx, un balanceador institucional), **no** se usa
> `docker-compose.yml`: fallaria por conflicto de puertos. Ese caso se resuelve
> con `docker-compose.dokploy.yml`, que no publica puertos ni levanta Caddy y
> deja el HTTPS al proxy existente. Dos ajustes obligatorios en ese proxy:
> desactivar el buffer de respuesta (la barra de progreso viaja por
> Server-Sent Events) y permitir cuerpos de peticion de hasta 500 MB.

## 6. Verificacion

```bash
curl -f https://transcript.institucion.edu/api/health
```

Debe responder `"ok": true` y `"ffmpeg": {"ok": true}`.

Despues, crear la primera cuenta y entrar desde el navegador:

```bash
docker compose exec app npm run create-user -- responsable@institucion.edu --admin
```

La contrasena se muestra una sola vez. Con `SIGNUP_CODE` configurado, el resto
del equipo puede crearse la cuenta desde la propia pantalla de acceso usando
ese codigo; sin el, las altas se hacen siempre con este comando.

Prueba final: subir un audio corto y comprobar que la barra de progreso avanza
y que aparece el documento.

## 7. Lo que NO esta en el repositorio

El repositorio **no contiene ninguna credencial**, ni en los archivos ni en el
historial. Quedan fuera, deliberadamente:

- `.env` — las claves. Se crea en el servidor (seccion 4).
- `data/` — base de datos, usuarios, transcripciones. Vive en un volumen de
  Docker.
- `node_modules/` — se instala al construir la imagen.
- `samples/` — audios de prueba locales.

Por eso la entrega se hace **clonando el repositorio**, nunca copiando una
carpeta de trabajo: una copia del directorio de desarrollo si contiene el
`.env` con claves reales y la base de datos con usuarios.

## 8. Operacion

| Tarea | Comando |
|---|---|
| Actualizar | `git pull && docker compose up -d --build` |
| Copia de seguridad | `docker compose exec app tar czf - -C /app/data . > backup.tar.gz` |
| Registros | `docker compose logs -f app` / `worker` / `caddy` |
| Dar de baja a alguien | `docker compose exec app npm run delete-user -- persona@institucion.edu` |
| Mas capacidad | `docker compose up -d --scale worker=3` |

Los datos viven en volumenes de Docker y sobreviven a las reconstrucciones.
Todo lo que importa esta en el volumen `data`.

**Antes de borrar un usuario o un trabajo**, tener en cuenta que el borrado es
en cascada: se lleva por delante las transcripciones y los documentos generados
con IA, que costaron dinero. El comando avisa de cuantos son y pide
confirmacion.

DEPLOY.md incluye ademas una tabla de ajuste de rendimiento
(`TRANSCRIBE_CONCURRENCY`, `WORKER_CONCURRENCY`) con mediciones reales, y una
seccion de problemas frecuentes.

## 9. Notas para quien revise el codigo

- **`legacy/`** es la version anterior, archivada como referencia. No se
  ejecuta y no hay que mantenerla.
- **Pruebas**: `npm test` — 62 pruebas, sin red, unos 5 segundos. Monta la API
  sobre una base de datos temporal y simula las llamadas a los proveedores, asi
  que no gasta credito.
- **`npm run check-models`** comprueba contra las APIs que los modelos del
  catalogo siguen existiendo. Este si necesita claves validas.
- **Seguridad**: contrasenas con scrypt (parametros OWASP), sesiones en cookie
  `HttpOnly` de 7 dias, limites de intentos por IP, y aislamiento por usuario
  en todas las consultas. Detalle en CLAUDE.md.
- **Licencia**: MIT.
