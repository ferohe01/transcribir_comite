/**
 * Alta de usuarios desde la terminal.
 *
 * No hay registro publico a proposito: en un servicio que gasta creditos de
 * API por cada uso, quien entra lo decide el administrador.
 *
 *   npm run create-user -- persona@correo.com
 *   npm run create-user -- persona@correo.com --admin
 *   npm run create-user -- persona@correo.com --password "una-contrasena-larga"
 */
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { users, getDb } from '../db/index.js';
import { hashPassword, validatePasswordStrength } from '../auth/password.js';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'));
const isAdmin = args.includes('--admin');

const passwordFlag = args.indexOf('--password');
let password = passwordFlag >= 0 ? args[passwordFlag + 1] : null;

if (!email || !email.includes('@')) {
  console.error('Uso: npm run create-user -- correo@ejemplo.com [--admin] [--password "..."]');
  process.exit(1);
}

getDb();

if (users.byEmail(email)) {
  console.error(`El usuario ${email} ya existe.`);
  process.exit(1);
}

let generated = false;
if (!password) {
  // Si hay terminal interactiva se pregunta; si no (docker exec sin -it,
  // scripts de despliegue), se genera una contrasena y se muestra una vez.
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question(`Contrasena para ${email}: `);
    rl.close();
  } else {
    password = crypto.randomBytes(12).toString('base64url');
    generated = true;
  }
}

const problem = validatePasswordStrength(password);
if (problem) {
  console.error(problem);
  process.exit(1);
}

const id = users.create({
  email,
  passwordHash: await hashPassword(password),
  role: isAdmin ? 'admin' : 'user',
});

console.log(`\nUsuario creado: ${email} (id ${id}${isAdmin ? ', admin' : ''})`);
if (generated) {
  console.log(`Contrasena generada: ${password}`);
  console.log('Guardala ahora: no se vuelve a mostrar.\n');
}
