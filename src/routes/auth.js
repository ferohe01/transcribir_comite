import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { users } from '../db/index.js';
import { verifyPassword, hashPassword, validatePasswordStrength } from '../auth/password.js';
import { requireAuth } from '../auth/index.js';

const router = express.Router();

// Freno a la fuerza bruta: 10 intentos por IP cada 15 minutos.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Prueba de nuevo en unos minutos.' },
});

// El registro tiene su propio freno, mas estrecho: el codigo de invitacion es
// lo unico que separa el servicio de cualquiera que pase por el dominio, y
// diez intentos cada cuarto de hora bastarian para ir probando codigos a mano.
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de registro. Prueba de nuevo dentro de un rato.' },
});

// Validacion deliberadamente laxa: comprobar de verdad que un correo existe
// solo lo hace enviarle un mensaje, y esto solo pretende cazar erratas.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const signupIsOpen = () => config.signup.code.length > 0;

/**
 * Compara el codigo de invitacion sin filtrar informacion por el tiempo que
 * tarda. Se comparan los resumenes y no los textos porque timingSafeEqual
 * exige la misma longitud, y comprobarla antes revelaria cuanto mide el
 * codigo bueno.
 */
function codeMatches(given, expected) {
  const digest = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest();
  return crypto.timingSafeEqual(digest(given), digest(expected));
}

/**
 * Deja la sesion iniciada y responde con el usuario.
 *
 * Renovar el id de sesion tras autenticarse evita la fijacion de sesion; lo
 * necesitan por igual el acceso y el alta, de ahi que este aqui.
 */
function startSession(req, res, user, status = 200) {
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'No se pudo iniciar la sesion.' });
    req.session.userId = user.id;
    req.session.save(() => {
      res.status(status).json({ user: { id: user.id, email: user.email, role: user.role } });
    });
  });
}

/**
 * Lo que la pantalla de acceso necesita saber antes de que nadie entre: si
 * ofrecer el enlace de crear cuenta. No expone el codigo, solo si lo hay.
 */
router.get('/config', (req, res) => {
  res.json({ signupEnabled: signupIsOpen() });
});

router.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email ?? '').trim();
  const password = String(req.body?.password ?? '');

  const user = users.byEmail(email);
  // Se verifica siempre contra algo, incluso si el usuario no existe, para que
  // el tiempo de respuesta no revele que correos estan dados de alta.
  const stored = user?.password_hash ?? 'scrypt$131072$8$1$AAAA$AAAA';
  const ok = await verifyPassword(password, stored);

  if (!user || !ok) {
    return res.status(401).json({ error: 'Correo o contrasena incorrectos.' });
  }

  startSession(req, res, user);
});

/**
 * Alta de una cuenta desde la pantalla de acceso.
 *
 * Siempre con rol 'user': el alta de administradores sigue siendo cosa de
 * `npm run create-user -- correo --admin`.
 */
router.post('/register', signupLimiter, async (req, res) => {
  if (!signupIsOpen()) {
    return res.status(403).json({
      error: 'El registro esta cerrado. Pide una cuenta a quien administra el servicio.',
    });
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const code = String(req.body?.code ?? '');

  // El codigo se comprueba lo primero: asi las respuestas siguientes, que si
  // distinguen un correo ya registrado de uno libre, solo las ve quien ya
  // tiene acceso. Sin esto la ruta seria un comprobador de quien esta dado de
  // alta abierto a cualquiera.
  if (!codeMatches(code, config.signup.code)) {
    return res.status(403).json({ error: 'El codigo de invitacion no es valido.' });
  }

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Escribe un correo valido.' });
  }

  const problem = validatePasswordStrength(password);
  if (problem) return res.status(400).json({ error: problem });

  if (users.byEmail(email)) {
    return res.status(409).json({ error: 'Ese correo ya tiene cuenta. Inicia sesion.' });
  }

  let id;
  try {
    id = users.create({ email, passwordHash: await hashPassword(password) });
  } catch (error) {
    // Dos altas simultaneas del mismo correo: la comprobacion de arriba pasa
    // en las dos y es la restriccion UNIQUE de la tabla la que corta.
    if (String(error.code).startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'Ese correo ya tiene cuenta. Inicia sesion.' });
    }
    throw error;
  }

  startSession(req, res, users.byId(id), 201);
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('transcript.sid');
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/password', requireAuth, async (req, res) => {
  const current = String(req.body?.current ?? '');
  const next = String(req.body?.next ?? '');

  const problem = validatePasswordStrength(next);
  if (problem) return res.status(400).json({ error: problem });

  const full = users.byEmail(req.user.email);
  if (!(await verifyPassword(current, full.password_hash))) {
    return res.status(401).json({ error: 'La contrasena actual no es correcta.' });
  }

  const { getDb } = await import('../db/index.js');
  getDb()
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(await hashPassword(next), req.user.id);

  res.json({ ok: true });
});

export default router;
