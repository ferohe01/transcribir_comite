# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Etapa 1: dependencias
# better-sqlite3 se compila de forma nativa, asi que necesita herramientas de
# compilacion que no tienen por que acabar en la imagen final.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS deps

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# Etapa 2: imagen final
# Lleva ffmpeg dentro: es lo que comprime y trocea el audio, la parte que hace
# que una hora de grabacion se transcriba en menos de un minuto.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# El volumen de datos lo monta docker-compose; se crea aqui con el dueno
# correcto para poder correr sin privilegios de root.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini como PID 1: reenvia las senales para que un `docker compose stop` cierre
# el proceso con orden en lugar de matarlo a los 10 segundos.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
