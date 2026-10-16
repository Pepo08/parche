#!/usr/bin/env node
// Parche — Dependabot para APIs.
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../src/engine.js';
import { loadPacks } from '../src/packs.js';
import { scanReport, prBody, counts, LABEL, daysUntil } from '../src/report.js';
import { verify } from '../src/verify.js';
import * as git from '../src/git.js';
import { parseGithubRemote, openPullRequest } from '../src/github.js';
import { record } from '../src/ledger.js';
import { apiLabel } from '../src/inventory/index.js';

const HELP = `parche — Dependabot para APIs

Uso:
  parche packs                         Lista los cambios de API que Parche conoce
  parche scan <dir> [--json]           Inventario de APIs + qué te afecta
  parche fix <dir> [--pack <id>]       Aplica los arreglos en el código
  parche pr <dir> [--pack <id>] [--dry-run] [--verify]
                                       Rama + commit + PR por cada cambio
  parche feedback <dir> --pack <id> --outcome merged|edited|rejected [--note "..."]
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
    console.log(`  ${KIND[api.kind]}  ${apiLabel(api).padEnd(38)} ${api.confidence.padEnd(5)}  ${shown.join(', ') || '(declarada, sin usos encontrados)'}${packs}`);
  }
  if (inventory.unresolved.length) {
    console.log(`  + ${inventory.unresolved.length} llamada(s) HTTP con URL dinámica (no se sabe a qué host van; detalle en el reporte)`);
  }
}

function printFindings(result) {
  for (const pack of result.packs) {
    const fs2 = result.findings.filter((f) => f.pack === pack.id);
    if (!fs2.length) continue;
    const d = pack.deadline ? ` · vence ${pack.deadline} (${daysUntil(pack.deadline)} días)` : '';
    console.log(`\n■ ${pack.title}\n  ${pack.provider} · severidad ${pack.severity}${d}`);
    for (const f of fs2) console.log(`  ${LABEL[f.status].padEnd(16)} ${f.file}${f.line ? ':' + f.line : ''}  ${f.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, dirArg] = args._;
  if (!cmd || args.help) { console.log(HELP); return 0; }

  if (cmd === 'packs') {
    for (const p of loadPacks()) {
      console.log(`${p.id.padEnd(36)} ${p.provider.padEnd(16)} ${p.kind.padEnd(10)} ${p.severity.padEnd(9)} ${p.deadline || '—'}  ${p.codemod ? 'con arreglo' : 'solo detección'}`);
    }
    return 0;
  }

  const root = path.resolve(dirArg || '.');
  if (!fs.existsSync(root)) throw new Error(`No existe ${root}`);
  const packIds = args.pack ? [args.pack] : null;

  if (cmd === 'scan') {
    const result = run(root, { write: false, packIds });
    ensureLocalDir(root);
    fs.writeFileSync(path.join(root, '.parche', 'inventory.json'), JSON.stringify(result.inventory, null, 2));
    fs.writeFileSync(path.join(root, '.parche', 'report.md'), scanReport({ ...result, changed: [] }));
    record(root, { type: 'scan', findings: counts(result.findings) });
    if (args.json) { console.log(JSON.stringify({ inventory: result.inventory, findings: result.findings }, null, 2)); return 0; }
    console.log(`Parche · scan de ${path.basename(root)}\n`);
    printInventory(result.inventory);
    printFindings(result);
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
    ensureLocalDir(root);
    const base = git.currentBranch(root);
    const packs = loadPacks().filter((p) => p.codemod && (!packIds || packIds.includes(p.id)));
    for (const pack of packs) {
      const preview = run(root, { write: false, packIds: [pack.id] });
      if (!preview.findings.length) continue;
      const branch = `parche/${pack.id}`;
      git.checkoutNewBranch(root, branch, base);
      const result = run(root, { write: true, packIds: [pack.id] });
      const changedFiles = result.changed.map((c) => c.file);
      const verification = args.verify || args['dry-run'] ? verify(root, changedFiles, { runTests: !!args.verify }) : null;
      if (verification && !verification.ok) {
        git.checkout(root, base);
        throw new Error(`La verificación falló para ${pack.id}; no se abre el PR.\n${JSON.stringify(verification, null, 2)}`);
      }
      const body = prBody({ pack, findings: result.findings, changed: result.changed, verification });
      const bodyPath = path.join(root, '.parche', `pr-${pack.id}.md`);
      fs.writeFileSync(bodyPath, body);
      const c = counts(result.findings);
      const draft = !!(c['needs-review'] || c['needs-input'] || c.blocked);
      const title = `Parche: ${pack.title}`;
      console.log(`\n■ ${title}`);
      if (!changedFiles.length) {
        console.log('  Sin cambios de código: queda como issue/reporte (ver cuerpo del PR).');
        git.checkout(root, base);
        record(root, { type: 'report-only', pack: pack.id, findings: c });
        continue;
      }
      const sha = git.commitAll(root, `${title}\n\n${pack.summary_es}\nPack ${pack.id} v${pack.version}.`);
      console.log(`  Rama ${branch} · commit ${sha} · ${changedFiles.length} archivo(s)${verification ? ` · verificación ${verification.ok ? 'OK' : 'FALLÓ'}` : ''}`);
      console.log(`  ${summary(result.findings)}`);
      console.log(`  Cuerpo del PR: ${bodyPath}`);
      const remote = parseGithubRemote(git.originUrl(root));
      let url = null;
      if (!args['dry-run'] && process.env.GITHUB_TOKEN && remote) {
        git.push(root, branch);
        url = await openPullRequest({ token: process.env.GITHUB_TOKEN, ...remote, head: branch, base, title, body, draft });
        console.log(`  PR abierto${draft ? ' (borrador)' : ''}: ${url}`);
      } else {
        console.log(`  Modo prueba: no se abrió el PR${draft ? ' (iría como borrador por tener ítems para revisar)' : ''}.`);
      }
      record(root, { type: 'pr', pack: pack.id, packVersion: pack.version, branch, sha, url, draft, files: changedFiles, findings: c });
      git.checkout(root, base);
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
