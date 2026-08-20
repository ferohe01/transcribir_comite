/**
 * Baja de usuarios desde la terminal.
 *
 * Contrapartida de create-user. Existe porque hacerlo a mano con SQL es facil
 * de estropear: hay que acordarse de `PRAGMA foreign_keys = ON` --SQLite lo
 * trae desactivado-- o el borrado deja transcripciones y resultados huerfanos
 * dentro de la base, ocupando sitio y sin forma de llegar a ellos.
 *
 * Ensenia siempre lo que se va a perder ANTES de borrar nada, porque la
 * cascada alcanza los documentos generados con IA, que costaron dinero.
 *
 *   npm run delete-user -- persona@correo.com
 *   npm run delete-user -- persona@correo.com --si     (sin preguntar)
 */
import readline from 'node:readline/promises';
import { users, getDb } from '../db/index.js';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'));
const sinPreguntar = args.includes('--si') || args.includes('--yes');

if (!email || !email.includes('@')) {
  console.error('Uso: npm run delete-user -- correo@ejemplo.com [--si]');
  process.exit(1);
}

const db = getDb();
const usuario = users.byEmail(email);

if (!usuario) {
  console.error(`No hay ninguna cuenta con el correo ${email}.`);
  process.exit(1);
}

const contar = (sql) => db.prepare(sql).get(usuario.id).n;
const trabajos = contar('SELECT COUNT(*) AS n FROM jobs WHERE user_id = ?');
const transcripciones = contar(
  'SELECT COUNT(*) AS n FROM transcripts WHERE job_id IN (SELECT id FROM jobs WHERE user_id = ?)',
);
const resultados = contar(
  `SELECT COUNT(*) AS n FROM outputs WHERE transcript_id IN
     (SELECT t.id FROM transcripts t JOIN jobs j ON j.id = t.job_id WHERE j.user_id = ?)`,
);
const plantillas = contar('SELECT COUNT(*) AS n FROM templates WHERE user_id = ?');

console.log(`\nCuenta: ${usuario.email} (id ${usuario.id}, rol ${usuario.role})`);
console.log('Se borrara, sin posibilidad de deshacerlo:');
console.log(`  ${trabajos} trabajo(s)`.replace('(s)', trabajos === 1 ? '' : 's'));
console.log(`  ${transcripciones} transcripcion${transcripciones === 1 ? '' : 'es'}`);
console.log(`  ${resultados} resultado${resultados === 1 ? '' : 's'} de plantilla`);
console.log(`  ${plantillas} plantilla${plantillas === 1 ? '' : 's'} propia${plantillas === 1 ? '' : 's'}`);

if (resultados > 0) {
  console.log('\nOjo: los resultados de plantilla son documentos generados con IA.');
  console.log('Si hacen falta, exportalos antes: esto no se puede deshacer.');
}

if (!sinPreguntar) {
  if (!process.stdin.isTTY) {
    console.error('\nSin terminal interactiva. Repite con --si para confirmar.');
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const respuesta = await rl.question(`\nEscribe el correo para confirmar: `);
  rl.close();
  if (respuesta.trim().toLowerCase() !== usuario.email.toLowerCase()) {
    console.error('No coincide. No se ha borrado nada.');
    process.exit(1);
  }
}

// getDb() abre con foreign_keys en ON, asi que la cascada se encarga del resto.
const borrados = db.prepare('DELETE FROM users WHERE id = ?').run(usuario.id).changes;
console.log(`\n${borrados === 1 ? 'Cuenta borrada' : 'No se borro nada'}: ${usuario.email}\n`);
