import express from 'express';
import rateLimit from 'express-rate-limit';
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

  // Renovar el id de sesion tras autenticarse evita la fijacion de sesion.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'No se pudo iniciar la sesion.' });
    req.session.userId = user.id;
    req.session.save(() => {
      res.json({ user: { id: user.id, email: user.email, role: user.role } });
    });
  });
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
