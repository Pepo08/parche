// Lee un .zip en memoria (sin dependencias): alcanza para el artifact de la foto de una corrida, que GitHub entrega
// como zip. Solo entradas guardadas (método 0) o con deflate (8), y sin zip64: la foto pesa unos KB.
import zlib from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

// Map de nombre de archivo → Buffer con su contenido (las carpetas no se incluyen).
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no es un zip.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CENTRAL) throw new Error('El zip está dañado.');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // El tamaño sale del directorio central: el encabezado local puede traerlo en cero (con data descriptor).
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (!name.endsWith('/')) {
      if (method === 0) files.set(name, Buffer.from(data));
      else if (method === 8) files.set(name, zlib.inflateRawSync(data));
      else throw new Error(`El zip usa un método de compresión que Parche no lee (${method}).`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
