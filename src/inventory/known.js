// Qué es cada dependencia y cada host: SDK de una API, cliente HTTP o ninguna de las dos.
// La fuente de verdad es data/known-sdks.json (datos, no código: se amplía sin tocar esto).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KNOWN = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'data', 'known-sdks.json'), 'utf8'));

// Palabras que, en el nombre de un paquete, sugieren que es el cliente de una API.
const NAME_HINT = /(^|[-_./@])(api|sdk|client)([-_./]|$)/i;

// Clasifica un paquete de un ecosistema (npm, composer, pypi).
// → { kind: 'sdk', provider, category, confidence, source } | { kind: 'http-client' } | null
export function classifyPackage(ecosystem, name) {
  const curated = KNOWN[ecosystem]?.[name];
  if (curated) return { kind: 'sdk', ...curated, confidence: 'alta', source: 'curated' };
  if (ecosystem === 'npm') {
    for (const [prefix, info] of Object.entries(KNOWN.npmPrefixes)) {
      if (name.startsWith(prefix)) return { kind: 'sdk', ...info, confidence: 'alta', source: 'curated' };
    }
  }
  if ((KNOWN.httpClients[ecosystem] || []).includes(name)) return { kind: 'http-client' };
  if (KNOWN.notApis.prefixes.some((p) => name === p || name.startsWith(p))) return null;
  // Heurística: el nombre dice api/sdk/client. Confianza baja hasta que se vea usado (el inventario la sube).
  if (NAME_HINT.test(name)) return { kind: 'sdk', provider: null, category: null, confidence: 'baja', source: 'heuristic' };
  return null;
}

// Paquete de un import: 'openai/resources' → 'openai'; '@aws-sdk/client-s3/dist' → '@aws-sdk/client-s3'.
export function packageOf(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// Proveedor de un host, por sufijo: 'sheets.googleapis.com' → Google APIs.
export function providerForHost(host) {
  if (!host) return null;
  const h = host.toLowerCase();
  for (const [known, info] of Object.entries(KNOWN.hosts)) {
    if (h === known || h.endsWith(`.${known}`)) return info;
  }
  return null;
}

// Hosts que no son APIs de terceros: la propia máquina o la red local.
export function isInternalHost(host) {
  const h = (host || '').toLowerCase();
  return !h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')
    || /^127\./.test(h) || h === '0.0.0.0' || h === '[::1]' || /^10\./.test(h) || /^192\.168\./.test(h);
}
