// Motor: recorre el repo, arma el inventario de APIs y corre los packs.
import fs from 'node:fs';
import path from 'node:path';
import { loadPacks, transformFor, languageOf } from './packs.js';
import { SKIP_DIRS, toPosix, isBackupDir, isBackupFile } from './paths.js';
import { scanJs } from './inventory/js-scan.js';
import { readManifests, buildInventory } from './inventory/index.js';
import { buildContext } from './context.js';

// JS/TS y PHP (codemods), WSDL (detección de esquemas viejos) y Python, C#, Java, Go, VB.NET (solo detección).
const EXT = /\.(m?js|cjs|jsx|ts|tsx|php|wsdl|py|cs|java|go|vb)$/i;

// Archivos que el motor lee. Las copias de respaldo (BAK/, "x copy.php"…) no se leen ni se editan:
// van a `skipped`, con "/", para decir en el reporte qué se ignoró.
export function listFiles(dir, skipped = []) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = () => toPosix(path.relative(dir, path.join(d, e.name)));
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (isBackupDir(e.name)) { skipped.push(`${rel()}/`); continue; }
        walk(path.join(d, e.name));
      } else if (EXT.test(e.name) && !/\.d\.ts$/.test(e.name)) {
        if (isBackupFile(e.name)) skipped.push(rel());
        else out.push(path.join(d, e.name));
      }
    }
  };
  walk(dir);
  skipped.sort();
  // Mismo orden en Windows y en Linux: se ordena por la ruta con "/".
  return out.sort((a, b) => (toPosix(a) < toPosix(b) ? -1 : 1));
}

export function run(dir, { write = false, packIds = null, today } = {}) {
  const root = path.resolve(dir);
  const packs = loadPacks().filter((p) => !packIds || packIds.includes(p.id));
  const manifests = readManifests(root);
  const deps = { ...manifests.npm, ...manifests.composer };
  const skipped = [];
  const files = listFiles(root, skipped);
  const rels = files.map((abs) => toPosix(path.relative(root, abs)));
  // Lo que un archivo solo no sabe (versiones instaladas, si el repo ya usa el campo, WSDL viejos).
  const context = buildContext(root, rels, manifests);
  const findings = [];
  const usages = [];
  const fileScans = []; // inventario de cualquier API (nivel 1), por archivo
  const changed = new Map(); // archivo relativo → [packs]

  files.forEach((abs, i) => {
    const rel = rels[i];
    let source = fs.readFileSync(abs, 'utf8');
    // El inventario se arma sobre el archivo original, antes de que un pack lo modifique.
    if (languageOf(rel) === 'js') fileScans.push({ file: rel, scan: scanJs(source, rel) });
    for (const pack of packs) {
      const t = transformFor(pack.id, rel);
      if (!t) continue;
      let res;
      try {
        res = t({ source, file: rel, pack, today, context });
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
  });

  const providers = {};
  for (const u of usages) {
    const p = (providers[u.provider] ||= { callSites: 0, ops: {}, files: new Set() });
    p.callSites++;
    p.ops[u.op] = (p.ops[u.op] || 0) + 1;
    p.files.add(u.file);
  }
  const generatedAt = new Date().toISOString();
  const inventory = {
    ...buildInventory({ repo: path.basename(root), manifests, fileScans, packs }),
    generatedAt,
    // Campos anteriores a schemaVersion: lo que reportan los packs. Se mantienen por compatibilidad.
    generated_at: generatedAt,
    packages: Object.fromEntries(Object.entries(deps).filter(([name]) =>
      packs.some((p) => (p.detect.packages || []).includes(name)))),
    providers: Object.fromEntries(Object.entries(providers).map(([k, v]) => [k, { ...v, files: [...v.files] }])),
    usages,
  };
  return { root, packs, context, inventory, findings, skipped, changed: [...changed.entries()].map(([file, packIds]) => ({ file, packs: packIds })) };
}

export const STATUS_ORDER = ['blocked', 'needs-input', 'needs-review', 'auto', 'detect-only'];
