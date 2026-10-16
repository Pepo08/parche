// Lector mínimo de tarballs de npm (.tgz), sin dependencias: gunzip + formato tar (ustar, pax y GNU).
// Solo devuelve los archivos que sirven para comparar APIs: package.json y declaraciones de tipos.
import zlib from 'node:zlib';

const WANTED = /(^|\/)package\.json$|\.d\.(ts|mts|cts)$/;

const str = (buf, start, len) => {
  const s = buf.subarray(start, start + len);
  const end = s.indexOf(0);
  return s.subarray(0, end === -1 ? s.length : end).toString('utf8');
};
const octal = (buf, start, len) => parseInt(str(buf, start, len).trim() || '0', 8);

// Registros pax: "<largo> clave=valor\n"
function paxPath(data) {
  for (const rec of data.toString('utf8').split('\n')) {
    const m = rec.match(/^\d+ path=(.*)$/);
    if (m) return m[1];
  }
  return null;
}

// tgz → Map(ruta sin el "package/" inicial → contenido). Ignora todo lo que no sea tipos o package.json.
export function extractTypes(tgz) {
  const tar = zlib.gunzipSync(tgz);
  const files = new Map();
  let offset = 0;
  let nextName = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // fin del archivo
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = str(header, 345, 155);
    let name = nextName || (prefix ? `${prefix}/${str(header, 0, 100)}` : str(header, 0, 100));
    nextName = null;
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512;
    if (type === 'x') { nextName = paxPath(data); continue; } // pax: el nombre largo es del próximo
    if (type === 'L') { nextName = str(data, 0, data.length); continue; } // GNU: nombre largo
    if (type !== '0' && type !== '\0') continue; // solo archivos comunes
    name = name.replace(/^[^/]+\//, ''); // "package/index.d.ts" → "index.d.ts"
    if (WANTED.test(name)) files.set(name, data.toString('utf8'));
  }
  return files;
}
