// `parche scan --upgrades` y `parche diff`: para cada SDK de npm que el repo usa, compara la versión
// instalada con la última publicada y dice qué operaciones del repo cambian o desaparecen.
import fs from 'node:fs';
import path from 'node:path';
import { extractSurface } from './surface.js';
import { diffSurfaces, affectedOperations, unverifiedOperations, dedupeChanges } from './compare.js';
import { compareVersions } from './registry.js';

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

// Versión instalada: node_modules → package-lock.json → la base del rango declarado ("^3.2.1" → 3.2.1).
// Si la base no existe en el registry, la más alta de la misma versión mayor. → { version, from } | null
export function installedVersion(root, pkg, declared, meta) {
  const nm = readJson(path.join(root, 'node_modules', pkg, 'package.json'));
  if (nm?.version) return { version: nm.version, from: 'node_modules' };
  const lock = readJson(path.join(root, 'package-lock.json'));
  const locked = lock?.packages?.[`node_modules/${pkg}`]?.version || lock?.dependencies?.[pkg]?.version;
  if (locked) return { version: locked, from: 'package-lock.json' };
  const m = String(declared || '').match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  const base = `${m[1]}.${m[2] || 0}.${m[3] || 0}`;
  if (!meta || meta.versions[base]) return { version: base, from: 'package.json' };
  const sameMajor = Object.keys(meta.versions).filter((v) => v.split('.')[0] === m[1] && !v.includes('-')).sort(compareVersions);
  return sameMajor.length ? { version: sameMajor[sameMajor.length - 1], from: 'package.json' } : null;
}

// "latest", "4" o "4.1" → la versión exacta más alta que corresponde, según el registry.
export function resolveSpec(meta, spec) {
  if (spec === 'latest') return meta['dist-tags']?.latest || null;
  if (meta.versions[spec]) return spec;
  const matches = Object.keys(meta.versions).filter((v) => !v.includes('-') && v.startsWith(`${spec}.`)).sort(compareVersions);
  return matches.length ? matches[matches.length - 1] : null;
}

// Diff completo entre dos versiones de un paquete (acepta "latest" y versiones parciales).
export async function diffVersions(registry, pkg, fromSpec, toSpec) {
  const meta = await registry.metadata(pkg);
  const from = resolveSpec(meta, fromSpec);
  const to = resolveSpec(meta, toSpec);
  if (!from || !to) return { pkg, from: fromSpec, to: toSpec, error: `${pkg}: no existe la versión ${!from ? fromSpec : toSpec} en el registry.` };
  const [ta, tb] = await Promise.all([registry.types(pkg, from), registry.types(pkg, to)]);
  if (!ta || !tb) return { pkg, from, to, error: `No hay tipos (.d.ts) para ${!ta ? from : to}: no se puede comparar.` };
  const sa = extractSurface({ files: ta.files, entry: ta.entry, pkgName: pkg });
  const sb = extractSurface({ files: tb.files, entry: tb.entry, pkgName: pkg });
  const all = diffSurfaces(sa, sb);
  // changes: para mostrar (sin repetidos); allChanges: para cruzar con lo que usa el repo.
  return { pkg, from, to, typesFrom: ta.source, typesTo: tb.source, before: sa, changes: dedupeChanges(all), allChanges: all };
}

// Para cada SDK de npm del inventario que tiene operaciones: versión instalada vs última.
export async function checkUpgrades(inventory, root, registry) {
  const results = [];
  const sdks = inventory.apis.filter((a) => a.kind === 'sdk' && a.ecosystem === 'npm' && a.operations.length);
  for (const api of sdks) {
    const base = { package: api.package, provider: api.provider };
    try {
      const meta = await registry.metadata(api.package);
      const latest = meta['dist-tags']?.latest;
      const installed = installedVersion(root, api.package, api.version, meta);
      if (!latest || !installed) {
        results.push({ ...base, status: 'sin-version', installed: installed?.version || null, latest: latest || null });
        continue;
      }
      if (compareVersions(installed.version, latest) >= 0) {
        results.push({ ...base, status: 'al-dia', installed: installed.version, latest });
        continue;
      }
      const d = await diffVersions(registry, api.package, installed.version, latest);
      if (d.error) {
        results.push({ ...base, status: 'sin-tipos', installed: installed.version, latest, error: d.error });
        continue;
      }
      const ops = api.operations.map((o) => o.op);
      const affected = affectedOperations(d.allChanges, ops, d.before).map((a) => ({
        ...a, locations: api.operations.find((o) => o.op === a.op).locations,
      }));
      const unverified = unverifiedOperations(ops, d.before);
      const status = affected.length ? 'afectado' : unverified.length === ops.length ? 'sin-verificar' : 'sin-impacto';
      results.push({ ...base, status, installed: installed.version, installedFrom: installed.from, latest,
        totalChanges: d.changes.length, affected, unverified });
    } catch (err) {
      const notPublished = /respondió 404/.test(err.message);
      results.push({ ...base, status: notPublished ? 'no-publicado' : 'error',
        error: notPublished ? `${api.package} no está publicado en el registry de npm (¿paquete privado o interno?).` : err.message });
    }
  }
  return results;
}

// Hallazgos detect-only (en castellano) para el reporte.
export function upgradeFindings(results) {
  const findings = [];
  for (const r of results.filter((x) => x.status === 'afectado')) {
    for (const a of r.affected) {
      const where = a.locations[0];
      findings.push({ pack: 'sdk.upgrades', file: where.file, line: where.line, status: 'detect-only',
        message: `${r.package} ${r.installed} → ${r.latest}: ${a.changes.map((c) => c.message).join(' ')}` });
    }
  }
  return findings;
}
