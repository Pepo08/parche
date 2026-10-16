// Inventario de cualquier API (nivel 1 del producto): junta las dependencias declaradas, lo que
// encontró js-scan en cada archivo y lo que reportaron los packs, y arma .parche/inventory.json.
// El esquema está documentado en docs/inventario.md; si cambia de forma incompatible, sube SCHEMA_VERSION.
import fs from 'node:fs';
import path from 'node:path';
import { classifyPackage, providerForHost } from './known.js';
import { findFiles } from '../paths.js';

export const SCHEMA_VERSION = 1;
const KIND_ORDER = { sdk: 0, http: 1, 'ai-model': 2 };

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

// requirements.txt: "paquete==1.2", "paquete>=1", "paquete[extra]"; sin comentarios, -r, -e ni URLs.
export function parseRequirements(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line || line.startsWith('-') || /^[a-z]+:\/\//i.test(line)) continue;
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(.*)$/);
    if (m) out[m[1].toLowerCase()] = m[3].trim() || '*';
  }
  return out;
}

const MANIFEST_NAMES = new Set(['package.json', 'composer.json', 'requirements.txt']);

// Todos los manifiestos del repo, no solo los de la raíz: los monorepos (packages/backend/package.json,
// ms-billing/package.json) declaran ahí sus SDKs. Primero la raíz, después por profundidad.
export function findManifests(root) {
  return findFiles(root, (name) => MANIFEST_NAMES.has(name));
}

// Dependencias declaradas por ecosistema (si un paquete aparece en varios manifiestos, gana el más cercano a la raíz).
export function readManifests(root) {
  const deps = { npm: {}, composer: {}, pypi: {} };
  const files = { npm: [], composer: [], pypi: [] };
  const merge = (eco, entries, file) => {
    files[eco].push(file);
    for (const [name, version] of entries) if (!(name in deps[eco])) deps[eco][name] = version;
  };
  for (const rel of findManifests(root)) {
    const abs = path.join(root, rel);
    const name = path.posix.basename(rel);
    if (name === 'package.json') {
      const pkg = readJson(abs) || {};
      merge('npm', Object.entries({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }), rel);
    } else if (name === 'composer.json') {
      const c = readJson(abs) || {};
      // fuera "php" y las extensiones "ext-*": no son paquetes
      merge('composer', Object.entries({ ...(c.require || {}), ...(c['require-dev'] || {}) }).filter(([n]) => n.includes('/')), rel);
    } else {
      merge('pypi', Object.entries(parseRequirements(fs.readFileSync(abs, 'utf8'))), rel);
    }
  }
  return { ...deps, files };
}

// fileScans: [{ file, scan }] con el resultado de scanJs; packs: los packs cargados.
export function buildInventory({ repo, manifests, fileScans, packs }) {
  const apis = new Map();
  const add = (id, base) => {
    if (!apis.has(id)) apis.set(id, { id, ...base, operations: new Map() });
    return apis.get(id);
  };
  const addOp = (api, op, file, line) => {
    const o = api.operations.get(op) || { op, count: 0, locations: [] };
    o.count++;
    o.locations.push({ file, line });
    api.operations.set(op, o);
  };
  const packsFor = (pkg) => packs.filter((p) => (p.detect.packages || []).includes(pkg)).map((p) => p.id);

  // Dependencias declaradas que son SDKs de una API (aunque todavía no se vean usadas).
  for (const eco of ['npm', 'composer', 'pypi']) {
    for (const [name, version] of Object.entries(manifests[eco] || {})) {
      const c = classifyPackage(eco, name);
      if (!c || c.kind !== 'sdk') continue;
      add(`${eco}:${name}`, { kind: 'sdk', provider: c.provider, category: c.category, ecosystem: eco, package: name, version,
        confidence: c.confidence, source: c.source, packs: packsFor(name) });
    }
  }

  const unresolved = [];
  for (const { file, scan } of fileScans) {
    for (const u of scan.sdk) {
      let api = apis.get(`npm:${u.pkg}`);
      if (!api) {
        const c = classifyPackage('npm', u.pkg);
        if (!c || c.kind !== 'sdk') continue; // no es el cliente de una API (lodash, react...)
        api = add(`npm:${u.pkg}`, { kind: 'sdk', provider: c.provider, category: c.category, ecosystem: 'npm', package: u.pkg,
          version: null, confidence: c.confidence, source: c.source, packs: packsFor(u.pkg) });
      }
      addOp(api, u.op, file, u.line);
    }
    for (const h of scan.http) {
      const known = providerForHost(h.host);
      const api = add(`http:${h.host}`, { kind: 'http', provider: known?.provider || null, category: known?.category || null,
        host: h.host, confidence: known ? 'alta' : 'media', source: known ? 'curated' : 'usage', packs: [] });
      addOp(api, `${h.method} ${h.path}`, file, h.line);
    }
    for (const m of scan.models) {
      const api = add(`ai:${m.provider}`, { kind: 'ai-model', provider: m.provider, category: 'ia', confidence: 'alta',
        source: 'usage', packs: packs.some((p) => p.id === 'ai.model-retirements') ? ['ai.model-retirements'] : [] });
      addOp(api, m.id, file, m.line);
    }
    for (const r of scan.unresolved) unresolved.push({ file, ...r });
  }

  const list = [...apis.values()].map((api) => {
    const operations = [...api.operations.values()].sort((a, b) => b.count - a.count || a.op.localeCompare(b.op));
    // Un SDK detectado por el nombre que además se ve usado deja de ser una corazonada.
    const confidence = api.source === 'heuristic' && operations.length ? 'media' : api.confidence;
    return { ...api, confidence, operations };
  }).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || (a.provider || a.package || a.host || '').localeCompare(b.provider || b.package || b.host || ''));

  const { files: manifestFiles = {}, ...dependencies } = manifests;
  return { schemaVersion: SCHEMA_VERSION, repo, apis: list, unresolved, dependencies, manifestFiles };
}

// Nombre corto para mostrar una API en el reporte y en la CLI.
export function apiLabel(api) {
  if (api.kind === 'sdk') return api.provider ? `${api.provider} · ${api.package}` : api.package;
  if (api.kind === 'http') return api.provider ? `${api.provider} · ${api.host}` : api.host;
  return `${api.provider} · modelos`;
}
