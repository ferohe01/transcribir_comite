import { spawn } from 'node:child_process';

/**
 * Envoltorio unico sobre ffmpeg/ffprobe. Centraliza el manejo de errores para
 * que un fallo del binario no se convierta en un error opaco tres capas mas
 * arriba.
 */
function run(bin, args, { signal, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { signal, windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => {
      const text = String(c);
      stderr += text;
      // ffmpeg puede escribir cientos de KB de progreso; se conserva solo el
      // final, que es donde aparece el mensaje de error real.
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
      onStderr?.(text);
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`No se encontro '${bin}'. Debe estar instalado y en el PATH.`));
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} termino con codigo ${code}:\n${stderr.slice(-2000)}`));
    });
  });
}

export const ffmpeg = (args, opts) => run('ffmpeg', ['-hide_banner', '-nostdin', ...args], opts);
export const ffprobe = (args, opts) => run('ffprobe', ['-hide_banner', ...args], opts);

/** Comprueba que ambos binarios existen. Se usa en /api/health. */
export async function checkFfmpeg() {
  try {
    const { stdout } = await run('ffmpeg', ['-version']);
    return { ok: true, version: stdout.split('\n')[0] };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
