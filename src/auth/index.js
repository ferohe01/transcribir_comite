import session from 'express-session';
import connectSqlite3 from 'connect-sqlite3';
import { config } from '../config/index.js';
import { users } from '../db/index.js';

const SQLiteStore = connectSqlite3(session);

export function sessionMiddleware() {
  return session({
    store: new SQLiteStore({
      db: 'sessions.db',
      dir: config.paths.data,
      table: 'sessions',
    }),
    name: 'transcript.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      // `secure` solo en produccion: en desarrollo se accede por http y el
      // navegador descartaria la cookie.
      secure: config.isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });
}

/** Exige sesion iniciada. Las rutas de API responden JSON, no una redireccion. */
export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Debes iniciar sesion.' });
  }
  const user = users.byId(req.session.userId);
  if (!user) {
    // El usuario fue borrado pero la cookie sigue viva.
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Sesion no valida.' });
  }
  req.user = user;
  next();
}

