// Motor: recorre el repo, arma el inventario de APIs y corre los packs.
import crypto from 'node:crypto';
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

// Identificador estable de un aviso (P5 de docs/app-vigilancia.md): el pack, el archivo y el texto de la línea, sin el
// número de línea ni el mensaje. Así una corrida reconoce el mismo aviso de la anterior aunque se muevan las líneas o
// cambie el texto del pack, y "nuevo", "sigue" y "resuelto" no dependen de la posición. Los espacios y el \r no cuentan
// (una reindentación o pasar a CRLF no es otro aviso).
// Si el mismo texto se repite en el archivo, cuenta el orden entre las líneas del archivo con ese texto, tengan aviso o
// no (P10, 0.7.6). Antes contaba entre los avisos: al arreglarse uno, el siguiente con el mismo texto heredaba su
// fingerprint, y en tienda-demo la factura A, que sigue con "falta un dato", salía como "resuelta". Dos avisos del mismo
// pack en la misma línea se distinguen por su orden en esa línea; un aviso sin línea, por su orden en el archivo.
const normalized = (line) => line.replace(/\s+/g, ' ').trim();

export function fingerprint(finding, source, seen) {
  const lines = finding.line ? source.split('\n') : [];
  const text = finding.line ? normalized(lines[finding.line - 1] ?? '') : '';
  const key = [finding.pack, finding.file, text].join('\u0000');
  let n;
  if (finding.line) {
    n = 0;
    for (let i = 0; i < finding.line && i < lines.length; i++) if (normalized(lines[i]) === text) n++;
    n = Math.max(n, 1);
  }
  // Cuántos avisos de este pack ya salieron en esta línea (o sin línea, en este archivo).
  const slot = `${finding.pack}\u0000${finding.file}\u0000${finding.line || ''}`;
  const k = (seen.get(slot) || 0) + 1;
  seen.set(slot, k);
  if (!finding.line) n = k;
  // Con un solo aviso en la línea, la clave es la misma que en la 0.7.3: no cambian los fingerprint de siempre.
  const suffix = finding.line && k > 1 ? `\u0000${k}` : '';
  return crypto.createHash('sha256').update(`${key}\u0000${n}${suffix}`).digest('hex').slice(0, 16);
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
  const seen = new Map(); // para fingerprint(): cuántos avisos de cada pack salieron en cada línea

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
        const f = { pack: pack.id, file: rel, line: null, status: 'needs-input', message: `Parche no pudo procesar este archivo: ${err.message}` };
        findings.push({ ...f, fingerprint: fingerprint(f, source, seen) });
        continue;
      }
      // El texto de la línea, del archivo tal como lo leyó este pack (antes de su propio cambio).
      findings.push(...res.findings.map((f) => ({ ...f, fingerprint: fingerprint(f, source, seen) })));
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
