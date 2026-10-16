// Acceso al registry de npm para comparar versiones de un SDK: metadata, tarballs (con verificación
// de integridad) y los archivos de tipos de cada versión. Todo queda cacheado en ~/.parche/cache:
// los tarballs son inmutables, así que una versión se baja una sola vez.
//
// PARCHE_CACHE cambia la carpeta del caché; PARCHE_OFFLINE=1 usa solo el caché (lo usan los tests).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractTypes } from './tar.js';

const REGISTRY = 'https://registry.npmjs.org';
const METADATA_TTL_MS = 60 * 60 * 1000;

export function defaultCacheDir() {
  return process.env.PARCHE_CACHE || path.join(os.homedir(), '.parche', 'cache');
}

const safeName = (pkg) => pkg.replace('/', '__');

export function createRegistry({ cacheDir = defaultCacheDir(), fetch = globalThis.fetch, offline = process.env.PARCHE_OFFLINE === '1' } = {}) {
  const dirFor = (pkg) => path.join(cacheDir, safeName(pkg));

  async function metadata(pkg) {
    const file = path.join(dirFor(pkg), 'metadata.json');
    if (fs.existsSync(file)) {
      const fresh = Date.now() - fs.statSync(file).mtimeMs < METADATA_TTL_MS;
      if (offline || fresh) return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    if (offline) throw new Error(`Sin conexión y sin metadata de ${pkg} en el caché (${file}).`);
    const res = await fetch(`${REGISTRY}/${pkg.replace('/', '%2F')}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`El registry respondió ${res.status} para ${pkg}.`);
    const json = await res.json();
    // Solo lo que hace falta: versiones con su tarball e integridad, y los dist-tags.
    const slim = {
      name: json.name,
      'dist-tags': json['dist-tags'] || {},
      versions: Object.fromEntries(Object.entries(json.versions || {}).map(([v, m]) => [v, { dist: { tarball: m.dist?.tarball, integrity: m.dist?.integrity } }])),
    };
    fs.mkdirSync(dirFor(pkg), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(slim));
    return slim;
  }

  async function tarball(pkg, version) {
    const file = path.join(dirFor(pkg), `${version}.tgz`);
    if (fs.existsSync(file)) return fs.readFileSync(file);
    if (offline) throw new Error(`Sin conexión y sin ${pkg}@${version} en el caché (${file}).`);
    const meta = await metadata(pkg);
    const dist = meta.versions[version]?.dist;
    if (!dist?.tarball) throw new Error(`${pkg}@${version} no existe en el registry.`);
    const res = await fetch(dist.tarball);
    if (!res.ok) throw new Error(`No se pudo bajar ${pkg}@${version} (${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    // Integridad: el hash tiene que coincidir con el que publica el registry.
    if (dist.integrity) {
      const [algo, expected] = dist.integrity.split(/-(.*)/s);
      const actual = crypto.createHash(algo).update(buf).digest('base64');
      if (actual !== expected) throw new Error(`La integridad de ${pkg}@${version} no coincide: no se usa.`);
    }
    fs.mkdirSync(dirFor(pkg), { recursive: true });
    fs.writeFileSync(file, buf);
    return buf;
  }

  // Archivos de tipos de una versión: los propios del paquete o, si no tiene, los de @types/<paquete>
  // de la misma versión mayor. → { files: Map, entry, source: 'paquete' | '@types/...' } | null
  async function types(pkg, version) {
    const own = extractTypes(await tarball(pkg, version));
    const entry = typesEntry(own);
    if (entry) return { files: own, entry, source: pkg };
    const typesPkg = `@types/${pkg.startsWith('@') ? pkg.slice(1).replace('/', '__') : pkg}`;
    let meta;
    try {
      meta = await metadata(typesPkg);
    } catch {
      return null;
    }
    const major = version.split('.')[0];
    const candidates = Object.keys(meta.versions).filter((v) => v.split('.')[0] === major && !v.includes('-')).sort(compareVersions);
    const pick = candidates[candidates.length - 1];
    if (!pick) return null;
    const files = extractTypes(await tarball(typesPkg, pick));
    const typesEntryFile = typesEntry(files);
    return typesEntryFile ? { files, entry: typesEntryFile, source: `${typesPkg}@${pick}` } : null;
  }

  return { metadata, tarball, types };
}

// Archivo de entrada de los tipos según el package.json (types, typings o exports) o index.d.ts.
export function typesEntry(files) {
  let pkg = {};
  try {
    pkg = JSON.parse(files.get('package.json') || '{}');
  } catch { /* package.json roto: se busca index.d.ts */ }
  const fromExports = typesInExports(pkg.exports);
  const candidates = [pkg.types, pkg.typings, fromExports, 'index.d.ts'].filter((x) => typeof x === 'string');
  for (const c of candidates) {
    const norm = c.replace(/^\.\//, '');
    const withExt = /\.d\.(ts|mts|cts)$/.test(norm) ? norm : `${norm.replace(/\.(js|mjs|cjs)$/, '')}.d.ts`;
    if (files.has(withExt)) return withExt;
  }
  return null;
}

// `types` dentro de `exports`, que puede ser { ".": {...} } o directamente un objeto de condiciones
// anidadas (stripe 23: exports.default.require.types). Se prefiere lo de Node/CommonJS.
const CONDITION_ORDER = ['types', 'require', 'node', 'default', 'import'];
export function typesInExports(exp, depth = 0) {
  if (!exp || typeof exp !== 'object' || depth > 5) return null;
  if (Array.isArray(exp)) {
    for (const e of exp) { const t = typesInExports(e, depth + 1); if (t) return t; }
    return null;
  }
  if ('.' in exp) return typeof exp['.'] === 'string' ? null : typesInExports(exp['.'], depth + 1);
  if (Object.keys(exp).some((k) => k.startsWith('./'))) return null; // solo subrutas: no hay entrada principal
  if (typeof exp.types === 'string') return exp.types;
  const keys = Object.keys(exp).sort((a, b) => {
    const ia = CONDITION_ORDER.indexOf(a);
    const ib = CONDITION_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  for (const k of keys) {
    const t = typesInExports(exp[k], depth + 1);
    if (t) return t;
  }
  return null;
}

// Comparación de versiones semver simples (x.y.z); las prereleases van antes que la estable.
export function compareVersions(a, b) {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < 3; i++) {
    const d = Number(pa[i] || 0) - Number(pb[i] || 0);
    if (d) return d;
  }
  const preA = a.includes('-');
  const preB = b.includes('-');
  return preA === preB ? a.localeCompare(b) : preA ? -1 : 1;
}
