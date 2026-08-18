/**
 * Recupera el nombre original de un archivo subido.
 *
 * En una peticion multipart el navegador manda el nombre en UTF-8, pero la
 * especificacion original de HTTP declara las cabeceras como latin1 y eso es
 * lo que asume busboy, la libreria que hay debajo de multer. El resultado es
 * mojibake: "Grabacion de la reunion.mp3" con acentos llega con cada caracter
 * acentuado convertido en los dos bytes de su representacion UTF-8, leidos
 * por separado.
 *
 * La correccion es deshacer esa lectura: volver a los bytes originales y
 * decodificarlos como UTF-8. Si el resultado no es UTF-8 valido se devuelve
 * el nombre tal cual llego, porque entonces la suposicion de partida era
 * falsa y reinterpretarlo lo estropearia.
 */
export function decodeUploadFilename(name) {
  if (typeof name !== 'string' || name === '') return name;

  // Sin bytes altos no hay nada que reinterpretar.
  if (!/[\u0080-\u00ff]/.test(name)) return name;

  const decoded = Buffer.from(name, 'latin1').toString('utf8');

  // U+FFFD es el caracter de reemplazo: aparece cuando los bytes no formaban
  // UTF-8 valido, senal de que el nombre ya venia bien.
  return decoded.includes('\ufffd') ? name : decoded;
}

/**
 * Nombre seguro para mostrar y guardar: sin separadores de ruta, sin
 * caracteres de control y de longitud acotada.
 *
 * En disco nunca se usa este nombre -- ahi va un identificador aleatorio --
 * pero si viaja a la base de datos, a la interfaz y al archivo que el usuario
 * se descarga.
 */
export function safeDisplayName(name) {
  const clean = decodeUploadFilename(name)
    .replaceAll('/', '_')
    .replaceAll('\\', '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255);

  return clean || 'audio';
}
