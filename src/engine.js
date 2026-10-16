// Motor: recorre el repo, arma el inventario de APIs y corre los packs.
import fs from 'node:fs';
import path from 'node:path';
import { loadPacks, transformFor } from './packs.js';

// vendor/ es donde composer instala las dependencias de PHP (incluida la propia librería de ARCA).
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', 'dist', 'build', 'coverage', '.next', '.parche']);
const EXT = /\.(m?js|cjs|jsx|ts|tsx|php)$/;

export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(d, e.name));
      } else if (EXT.test(e.name) && !/\.d\.ts$/.test(e.name)) {
        out.push(path.join(d, e.name));
      }
    }
  };
  walk(dir);
  // Mismo orden en Windows y en Linux: se ordena por la ruta con "/".
  return out.sort((a, b) => (toPosix(a) < toPosix(b) ? -1 : 1));
}

// Rutas siempre con "/": van al reporte, al cuerpo del PR y al inventario.
const toPosix = (p) => p.split(path.sep).join('/');

// Dependencias declaradas en package.json (npm) y composer.json (PHP).
function readDeps(dir) {
  const read = (name) => {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) return {};
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return {};
    }
  };
  const pkg = read('package.json');
  const composer = read('composer.json');
  return {
    ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}),
    ...(composer.require || {}), ...(composer['require-dev'] || {}),
  };
}

export function run(dir, { write = false, packIds = null, today } = {}) {
  const root = path.resolve(dir);
  const packs = loadPacks().filter((p) => !packIds || packIds.includes(p.id));
  const deps = readDeps(root);
  const files = listFiles(root);
  const findings = [];
  const usages = [];
  const changed = new Map(); // archivo relativo → [packs]

  for (const abs of files) {
    const rel = toPosix(path.relative(root, abs));
    let source = fs.readFileSync(abs, 'utf8');
    for (const pack of packs) {
      const t = transformFor(pack.id, rel);
      if (!t) continue;
      let res;
      try {
        res = t({ source, file: rel, pack, today });
      } catch (err) {
        findings.push({ pack: pack.id, file: rel, line: null, status: 'needs-input', message: `Parche no pudo procesar este archivo: ${err.message}` });
        continue;
      }
      findings.push(...res.findings);
      usages.push(...res.usages.map((u) => ({ ...u, file: rel, pack: pack.id })));
      if (res.output !== null && res.output !== source) {
        source = res.output;
        changed.set(rel, [...(changed.get(rel) || []), pack.id]);
        if (write) fs.writeFileSync(abs, source);
      }
    }
  }

  const providers = {};
  for (const u of usages) {
    const p = (providers[u.provider] ||= { callSites: 0, ops: {}, files: new Set() });
    p.callSites++;
    p.ops[u.op] = (p.ops[u.op] || 0) + 1;
    p.files.add(u.file);
  }
  const inventory = {
    generated_at: new Date().toISOString(),
    repo: path.basename(root),
    packages: Object.fromEntries(Object.entries(deps).filter(([name]) =>
      packs.some((p) => (p.detect.packages || []).includes(name)))),
    providers: Object.fromEntries(Object.entries(providers).map(([k, v]) => [k, { ...v, files: [...v.files] }])),
    usages,
  };
  return { root, packs, inventory, findings, changed: [...changed.entries()].map(([file, packIds]) => ({ file, packs: packIds })) };
}

export const STATUS_ORDER = ['blocked', 'needs-input', 'needs-review', 'auto', 'detect-only'];
