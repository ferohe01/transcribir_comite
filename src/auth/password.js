import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

// Parametros recomendados por OWASP para scrypt (N=2^17, r=8, p=1).
const PARAMS = { N: 131072, r: 8, p: 1, keyLength: 64 };
// scrypt necesita ~128*N*r bytes; con N=2^17 son ~134 MB, por encima del
// limite por defecto de Node, de ahi el maxmem explicito.
const MAX_MEM = 256 * 1024 * 1024;

/**
 * Hash de contrasena con scrypt de node:crypto.
 *
 * Se usa scrypt en lugar de bcrypt o argon2 para no arrastrar una dependencia
 * nativa mas: viene en la biblioteca estandar y es igual de solido.
 * Formato almacenado: scrypt$N$r$p$salt$hash
 */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, PARAMS.keyLength, { ...PARAMS, maxmem: MAX_MEM });
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scrypt(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: MAX_MEM,
    });
    // Comparacion en tiempo constante: evita filtrar informacion por el tiempo
    // que tarda en fallar.
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'La contrasena debe tener al menos 10 caracteres.';
  }
  return null;
}
