import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { config } from './config/index.js';
import { sessionMiddleware, requireAuth } from './auth/index.js';
import authRoutes from './routes/auth.js';
import jobRoutes from './routes/jobs.js';
import transcriptRoutes from './routes/transcripts.js';
import metaRoutes, { healthRouter } from './routes/meta.js';

/**
 * Construye la aplicacion Express.
 *
 * Vive aparte de server.js para que las pruebas puedan montar la API sin
 * arrancar el servidor, comprobar ffmpeg ni levantar la cola.
 */
export function createApp() {
  const app = express();

  // Detras de Caddy/Nginx: sin esto la limitacion por IP veria siempre la del
  // proxy y las cookies `secure` no se enviarian.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      // La app reproduce el audio local via blob:; esta cabecera lo bloquearia.
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(sessionMiddleware());

  app.use('/api', healthRouter);
  app.use('/api/auth', authRoutes);
  app.use('/api/jobs', requireAuth, jobRoutes);
  app.use('/api/transcripts', requireAuth, transcriptRoutes);
  app.use('/api', requireAuth, metaRoutes);

  // Solo se sirve el directorio public. La version anterior hacia
  // `express.static(__dirname)`, dejando descargables server.js y package.json.
  app.use(express.static(config.paths.public, { index: false, dotfiles: 'deny' }));

  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(config.paths.public, 'index.html'));
  });

  app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

  // Manejador de errores final. Necesita los cuatro argumentos para que
  // Express lo reconozca como tal.
  app.use((error, req, res, next) => {
    if (error?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `El archivo supera el limite de ${Math.round(config.audio.maxUploadBytes / 1048576)} MB.`,
      });
    }
    console.error('[error]', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  });

  return app;
}
