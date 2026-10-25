#!/usr/bin/env node
// Parche — Dependabot para APIs.
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../src/engine.js';
import { loadPacks } from '../src/packs.js';
import { scanReport, prBody, counts, LABEL, daysUntil, partialCovers } from '../src/report.js';
import { verify } from '../src/verify.js';
import * as git from '../src/git.js';
import { parseGithubRemote, openPullRequest } from '../src/github.js';
import { record } from '../src/ledger.js';
import { apiLabel, noUsesLabel } from '../src/inventory/index.js';
import { isTestFile } from '../src/paths.js';
import { stepSummary, annotations, byPack, workspacePrefix } from '../src/actions.js';

const HELP = `parche — Dependabot para APIs

Uso:
  parche packs                         Lista los cambios de API que Parche conoce
  parche scan <dir> [--json] [--upgrades]
                                       Inventario de APIs + qué te afecta; con --upgrades,
                                       qué cambia en las versiones nuevas de tus SDKs de npm
  parche diff <paquete> --from <v> --to <v> [--json] [--all]
                                       Qué cambia en la API de un paquete de npm entre dos versiones
  parche fix <dir> [--pack <id>]       Aplica los arreglos en el código
  parche pr <dir> [--pack <id>] [--dry-run] [--verify] [--push-remote <remote>] [--author "Nombre <email>"]
                                       Rama + commit + PR por cada cambio. Con --push-remote,
                                       pushea a ese remote (tu fork) y abre el PR contra origin.
                                       Con --author, firma con esa identidad y no con la de git
  parche feedback <dir> --pack <id> --outcome merged|edited|rejected [--note "..."]
  parche --version                     La versión instalada (para reportar un error)
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; } else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

function summary(findings) {
  const c = counts(findings);
  return ['auto', 'needs-review', 'needs-input', 'blocked', 'detect-only']
    .filter((k) => c[k]).map((k) => `${LABEL[k]}: ${c[k]}`).join('   ');
}

function ensureLocalDir(root) {
  fs.mkdirSync(path.join(root, '.parche'), { recursive: true });
  const exclude = path.join(root, '.git', 'info', 'exclude');
  if (fs.existsSync(path.dirname(exclude))) {
    const cur = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    if (!cur.includes('.parche/')) fs.appendFileSync(exclude, '\n.parche/\n');
  }
}

// Inventario de cualquier API (nivel 1): todo lo que el repo usa, tenga pack o no.
function printInventory(inventory) {
  const KIND = { sdk: 'SDK ', http: 'HTTP', 'ai-model': 'IA  ' };
  console.log(`APIs del repo (${inventory.apis.length}):`);
  if (!inventory.apis.length) console.log('  (no se encontraron APIs de terceros)');
  for (const api of inventory.apis) {
    const ops = api.operations.map((o) => (o.count > 1 ? `${o.op} ×${o.count}` : o.op));
    const shown = ops.length > 4 ? [...ops.slice(0, 4), `+${ops.length - 4} más`] : ops;
    const packs = api.packs.length ? '  · con pack' : '';
    console.log(`  ${KIND[api.kind]}  ${apiLabel(api).padEnd(38)} ${api.confidence.padEnd(5)}  ${shown.join(', ') || `(${noUsesLabel(api)})`}${packs}`);
  }
  if (inventory.unresolved.length) {
    console.log(`  + ${inventory.unresolved.length} llamada(s) HTTP con URL dinámica (no se sabe a qué host van; detalle en el reporte)`);
  }
}

// Versiones nuevas de los SDKs de npm (scan --upgrades): qué operaciones del repo cambian o desaparecen.
function printUpgrades(results) {
  console.log('\nVersiones nuevas de tus SDKs de npm:');
  if (!results.length) console.log('  (no hay SDKs de npm con operaciones para comparar)');
  for (const r of results) {
    const head = `  ${r.package.padEnd(22)} ${r.installed ? `${r.installed} → ${r.latest}`.padEnd(20) : ''.padEnd(20)}`;
    if (r.status === 'afectado') {
      console.log(`${head} ⚠ ${r.affected.length} de tus operaciones cambian o desaparecen`);
      for (const a of r.affected) {
        const where = a.locations.map((l) => `${l.file}:${l.line}`).join(', ');
        console.log(`      ${a.op}  (${where})`);
        for (const c of a.changes) console.log(`        ${c.message}`);
      }
    } else if (r.status === 'sin-impacto') {
      console.log(`${head} ✓ lo que usás no cambia (${r.totalChanges} cambios en el SDK)${r.unverified.length ? ` · ${r.unverified.length} operación(es) sin verificar` : ''}`);
    } else if (r.status === 'al-dia') {
      console.log(`${head} ✓ al día`);
    } else if (r.status === 'sin-verificar') {
      console.log(`${head} ? tus operaciones no aparecen en los tipos de la versión instalada: no se puede verificar`);
    } else {
      console.log(`${head} — ${r.error || 'no se pudo determinar la versión instalada'}`);
    }
  }
}

// Salida de `parche diff`.
function printDiff(d, { all = false } = {}) {
  const groups = [
    ['Desaparecen', d.changes.filter((c) => c.type === 'removed')],
    ['Cambian los parámetros', d.changes.filter((c) => ['new-required', 'param-removed', 'type-changed'].includes(c.type))],
    ['Pasan a deprecados', d.changes.filter((c) => c.type === 'deprecated')],
  ];
  console.log(`${d.pkg} ${d.from} → ${d.to}  (tipos: ${d.typesFrom} → ${d.typesTo})`);
  if (!d.changes.length) console.log('  No hay cambios incompatibles en la superficie pública.');
  for (const [title, list] of groups) {
    if (!list.length) continue;
    console.log(`\n${title} (${list.length}):`);
    const shown = all ? list : list.slice(0, 25);
    for (const c of shown) console.log(`  - ${c.message}`);
    if (shown.length < list.length) console.log(`  … y ${list.length - shown.length} más (--all para verlos todos)`);
  }
}

// Lo que no se revisó por ser copia de respaldo: se dice, no se oculta.
function printSkipped(skipped = []) {
  if (!skipped.length) return;
  const shown = skipped.slice(0, 8).join(', ');
  console.log(`\nNo revisé ${skipped.length} copia(s) de respaldo: ${shown}${skipped.length > 8 ? ` y ${skipped.length - 8} más` : ''}. Si alguna es código que corre, renombrala o movela.`);
}

function printFindings(result) {
  for (const pack of result.packs) {
    const fs2 = result.findings.filter((f) => f.pack === pack.id);
    if (!fs2.length) continue;
    const d = pack.deadline ? ` · vence ${pack.deadline} (${daysUntil(pack.deadline)} días)` : '';
    console.log(`\n■ ${pack.title}\n  ${pack.provider} · severidad ${pack.severity}${d}`);
    for (const f of fs2) {
      console.log(`  ${LABEL[f.status].padEnd(16)} ${f.file}${f.line ? ':' + f.line : ''}  ${f.message}`);
      // partial.message ya empieza con "No cubre…": sin prefijo (antes salía "No cubre: No cubre").
      if (f.partial) console.log(`  ${''.padEnd(16)} ${f.partial.message}`);
    }
  }
}

const VERSION = () => JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, dirArg] = args._;
  if (args.version || cmd === '-v') {
    console.log(VERSION());
    return 0;
  }
  if (!cmd || args.help) { console.log(HELP); return 0; }

  if (cmd === 'packs') {
    for (const p of loadPacks()) {
      console.log(`${p.id.padEnd(36)} ${p.provider.padEnd(16)} ${p.kind.padEnd(10)} ${p.severity.padEnd(9)} ${p.deadline || '—'}  ${p.codemod ? 'con arreglo' : 'solo detección'}`);
    }
    return 0;
  }

  if (cmd === 'diff') {
    const pkg = dirArg;
    if (!pkg || !args.from || !args.to) throw new Error('Uso: parche diff <paquete> --from <versión> --to <versión>');
    // TypeScript se carga recién acá: el scan común no lo necesita.
    const { createRegistry } = await import('../src/sdk-diff/registry.js');
    const { diffVersions } = await import('../src/sdk-diff/upgrades.js');
    const d = await diffVersions(createRegistry(), pkg, String(args.from), String(args.to));
    if (d.error) throw new Error(d.error);
    if (args.json) { console.log(JSON.stringify({ pkg, from: d.from, to: d.to, changes: d.changes }, null, 2)); return 0; }
    printDiff(d, { all: !!args.all });
    return 0;
  }

  const root = path.resolve(dirArg || '.');
  if (!fs.existsSync(root)) throw new Error(`No existe ${root}`);
  const packIds = args.pack ? [args.pack] : null;

  if (cmd === 'scan') {
    const result = run(root, { write: false, packIds });
    let upgrades = null;
    if (args.upgrades) {
      if (!args.json) console.error('Buscando versiones nuevas de tus SDKs en npm...');
      const { createRegistry } = await import('../src/sdk-diff/registry.js');
      const { checkUpgrades } = await import('../src/sdk-diff/upgrades.js');
      upgrades = await checkUpgrades(result.inventory, root, createRegistry());
      result.inventory.upgrades = upgrades;
    }
    ensureLocalDir(root);
    fs.writeFileSync(path.join(root, '.parche', 'inventory.json'), JSON.stringify(result.inventory, null, 2));
    fs.writeFileSync(path.join(root, '.parche', 'report.md'), scanReport({ ...result, changed: [], upgrades }));
    record(root, { type: 'scan', findings: counts(result.findings) });
    // parcheVersion: qué versión (y por lo tanto qué reglas) generó este JSON; la foto de cada corrida de la Action lo guarda.
    if (args.json) { console.log(JSON.stringify({ parcheVersion: VERSION(), inventory: result.inventory, findings: result.findings, skipped: result.skipped }, null, 2)); return 0; }
    console.log(`Parche · scan de ${path.basename(root)}\n`);
    printInventory(result.inventory);
    if (upgrades) printUpgrades(upgrades);
    printFindings(result);
    printSkipped(result.skipped);
    const s = summary(result.findings);
    console.log(s ? `\n${s}` : '\nNinguno de los packs verificados tiene cambios que te afecten hoy.');
    console.log(`Reporte: ${path.join(root, '.parche', 'report.md')}`);
    return 0;
  }

  if (cmd === 'fix') {
    const result = run(root, { write: true, packIds });
    ensureLocalDir(root);
    fs.writeFileSync(path.join(root, '.parche', 'report.md'), scanReport(result));
    record(root, { type: 'fix', packs: packIds, changed: result.changed.map((c) => c.file) });
    console.log(result.changed.length ? 'Archivos modificados:' : 'Nada para modificar.');
    for (const c of result.changed) console.log(`  ${c.file}  (${c.packs.join(', ')})`);
    console.log(`\n${summary(result.findings)}`);
    return 0;
  }

  if (cmd === 'pr') {
    if (!git.isRepo(root)) throw new Error('`parche pr` necesita un repositorio git.');
    if (!git.isClean(root)) throw new Error('Hay cambios sin commitear. Commiteá o guardá (stash) antes de correr `parche pr`.');
    if (git.tracksParcheDir(root)) {
      console.warn('Ojo: `.parche/` está commiteado en el repo. Parche lo usa para sus reportes y no lo incluye en sus PRs. Si no lo querés versionar: `git rm -r --cached .parche` y sumalo al .gitignore.');
    }
    // Quién firma el commit se resuelve antes de escribir nada: si falla al commitear, el repo quedaría sucio.
    const env = args.author !== undefined ? { ...process.env, ...git.parseAuthor(args.author) } : process.env;
    const identity = git.commitIdentity(root, env);
    console.log(`Firma los commits: ${identity.name} <${identity.email}>`);
    // El email queda público en el PR: si no es un noreply de GitHub, se avisa antes de pushear (frente B, punto 20).
    if (!args['dry-run'] && process.env.GITHUB_TOKEN && process.env.GITHUB_ACTIONS !== 'true' && !git.isNoreply(identity.email)) {
      console.warn(`Ojo: ${identity.email} va a quedar público en el commit del PR. Si preferís no mostrarlo, usá --author "Nombre <usuario@users.noreply.github.com>".`);
    }
    ensureLocalDir(root);
    const base = git.currentBranch(root);
    const packs = loadPacks().filter((p) => p.codemod && (!packIds || packIds.includes(p.id)));
    // A dónde se pushea: origin, o el fork de quien abre el PR (--push-remote fork). El PR se abre contra origin.
    const pushRemote = typeof args['push-remote'] === 'string' ? args['push-remote'] : 'origin';
    // Para el resumen del job en GitHub Actions: los PRs de esta corrida y lo que quedó sin PR.
    const opened = [];
    const withoutPr = [];
    for (const pack of packs) {
      const preview = run(root, { write: false, packIds: [pack.id] });
      if (!preview.findings.length) continue;
      const branch = `parche/${pack.id}`;
      // Un arreglo parcial lo dice en el título: "(parcial: consumidor final)".
      const covers = partialCovers(preview.findings);
      const title = `Parche: ${pack.title}${covers.length ? ` (parcial: ${covers.join(', ')})` : ''}`;
      git.checkoutNewBranch(root, branch, base);
      let keepBranch = false;
      try {
        const result = run(root, { write: true, packIds: [pack.id] });
        const changedFiles = result.changed.map((c) => c.file);
        const c = counts(result.findings);
        const bodyPath = path.join(root, '.parche', `pr-${pack.id}.md`);
        console.log(`\n■ ${title}`);
        // La sintaxis se chequea siempre (no ejecuta nada del repo); los tests, solo con --verify.
        const verification = changedFiles.length ? verify(root, changedFiles, { runTests: !!args.verify }) : null;
        if (verification && !verification.ok) {
          // Nada de lo que escribió Parche queda en el repo: se descarta y se borra la rama.
          git.discardChanges(root);
          throw new Error(`La verificación falló para ${pack.id}; no se abre el PR y el repo queda como estaba.\n${JSON.stringify(verification, null, 2)}`);
        }
        // Si solo cambiarían tests o mocks no hay PR: el texto queda como issue, sin "Modifica 1 archivo" (frente B, punto 20).
        const reportOnly = !changedFiles.length || changedFiles.every(isTestFile);
        // La Action avisa si usa el GITHUB_TOKEN por defecto (PARCHE_DEFAULT_TOKEN): los workflows del PR esperan aprobación.
        const ciApproval = process.env.GITHUB_ACTIONS === 'true' && process.env.PARCHE_DEFAULT_TOKEN === 'true';
        fs.writeFileSync(bodyPath, prBody({ pack, findings: result.findings, changed: reportOnly ? [] : result.changed, verification: reportOnly ? null : verification, ciApproval }));
        if (reportOnly) {
          const why = changedFiles.length ? 'solo cambiaría tests o mocks: no se abre un PR' : 'sin cambios de código';
          git.discardChanges(root);
          console.log(`  ${summary(result.findings)}`);
          console.log(`  ${why[0].toUpperCase()}${why.slice(1)}; queda como issue o reporte: ${bodyPath}`);
          record(root, { type: 'report-only', pack: pack.id, findings: c, reason: why });
          withoutPr.push({ pack, findings: result.findings });
          continue;
        }
        const draft = !!(c['needs-review'] || c['needs-input'] || c.blocked);
        const sha = git.commitAll(root, `${title}\n\n${pack.summary_es}\nPack ${pack.id} v${pack.version}.`, env);
        keepBranch = true;
        console.log(`  Rama ${branch} · commit ${sha} · ${changedFiles.length} archivo(s)${verification ? ` · verificación ${verification.ok ? 'OK' : 'FALLÓ'}` : ''}`);
        console.log(`  ${summary(result.findings)}`);
        console.log(`  Cuerpo del PR: ${bodyPath}`);
        const target = parseGithubRemote(git.originUrl(root));
        const pushTo = parseGithubRemote(git.remoteUrl(root, pushRemote));
        let url = null;
        if (!args['dry-run'] && process.env.GITHUB_TOKEN && target && pushTo) {
          git.push(root, branch, pushRemote);
          const head = pushTo.owner !== target.owner ? `${pushTo.owner}:${branch}` : branch;
          url = await openPullRequest({ token: process.env.GITHUB_TOKEN, ...target, head, base, title, body: fs.readFileSync(bodyPath, 'utf8'), draft });
          console.log(`  PR abierto${draft ? ' (borrador)' : ''}: ${url}`);
        } else {
          console.log(`  Modo prueba: no se abrió el PR${draft ? ' (iría como borrador por tener ítems para revisar)' : ''}.`);
        }
        opened.push({ title, url, draft });
        record(root, { type: 'pr', pack: pack.id, packVersion: pack.version, branch, sha, url, draft, files: changedFiles, findings: c,
          partial: result.findings.filter((f) => f.partial).length });
      } finally {
        // Pase lo que pase, se vuelve a la rama base; la rama de Parche solo queda si tiene un commit.
        git.checkout(root, base);
        if (!keepBranch) git.deleteBranch(root, branch);
      }
    }
    // Los packs de solo detección (IA) no abren PR: sus avisos se muestran acá y, en GitHub Actions, en el resumen del
    // job y como anotaciones, junto con lo que quedó sin PR. Antes `pr` los salteaba y en la Action no se veían (D67).
    const detectPacks = loadPacks().filter((p) => !p.codemod && (!packIds || packIds.includes(p.id)));
    const detected = detectPacks.length ? run(root, { write: false, packIds: detectPacks.map((p) => p.id) }) : { packs: [], findings: [] };
    const notices = byPack(detected);
    if (notices.length) {
      console.log('\nAvisos sin PR (solo detección):');
      printFindings(detected);
    }
    if (process.env.GITHUB_ACTIONS === 'true') {
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, stepSummary({ opened, reportOnly: withoutPr, notices }));
      for (const line of annotations([...notices, ...withoutPr], workspacePrefix(root, process.env.GITHUB_WORKSPACE))) console.log(line);
    }
    return 0;
  }

  if (cmd === 'feedback') {
    if (!args.pack || !['merged', 'edited', 'rejected'].includes(args.outcome)) throw new Error('Uso: parche feedback <dir> --pack <id> --outcome merged|edited|rejected');
    record(root, { type: 'feedback', pack: args.pack, outcome: args.outcome, note: args.note || null });
    console.log(`Registrado: ${args.pack} → ${args.outcome}. Gracias, esto mejora el pack para todos.`);
    return 0;
  }

  console.log(HELP);
  return 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
