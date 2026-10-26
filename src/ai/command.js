// `parche ai-upgrade`: el nivel 2 a prueba (0.9.0). Apagado salvo que se pida: en la CLI, este comando; en la Action,
// `ai-upgrades: 'true'`. Por cada SDK de npm con llamadas que cambian en su última versión, pide el arreglo al modelo,
// lo verifica (src/ai/upgrade.js) y, si pasa, abre un PR siempre en borrador, con la versión nueva en package.json.
// Con --measure no toca el repo: solo dice qué propondría y si pasó la verificación (para medir la tasa de acierto en
// repos públicos, nunca en código de clientes).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../engine.js';
import * as git from '../git.js';
import { record } from '../ledger.js';
import { verify } from '../verify.js';
import { parseGithubRemote, githubClient } from '../github.js';
import { publishPr } from '../publish.js';
import { checkUpgrades } from '../sdk-diff/upgrades.js';
import { proposeUpgrade } from './upgrade.js';
import { askModel, DEFAULT_MODEL } from './model.js';
import { aiPrBody } from './body.js';

const slug = (pkg) => pkg.replace(/^@/, '').replace(/[^\w.-]+/g, '-');

// La versión nueva en package.json, cambiando solo el texto del rango (respeta el formato del archivo).
export function bumpDependency(text, pkg, version) {
  const re = new RegExp(`("${pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"\\s*:\\s*")([^"]*)(")`, 'g');
  let hits = 0;
  const out = text.replace(re, (_, a, range, b) => { hits++; return `${a}${/^[~^]/.test(range) ? range[0] : '^'}${version}${b}`; });
  return hits ? out : null;
}

const npm = (root, args) => spawnSync('npm', args, { cwd: root, encoding: 'utf8', timeout: 300000, shell: process.platform === 'win32' });

export async function aiUpgradeCommand(args, { root, env = process.env, registry, ask, version = '0.0.0' } = {}) {
  const model = typeof args.model === 'string' ? args.model : env.PARCHE_AI_MODEL || DEFAULT_MODEL;
  const call = ask || ((q) => askModel({ ...q, apiKey: env.ANTHROPIC_API_KEY }));
  if (!ask && !env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY: el nivel 2 usa la clave del cliente (en GitHub Actions, un secret del repo pasado en el input `anthropic-api-key`).');
  const measure = !!args.measure;
  if (!measure) {
    if (!git.isRepo(root)) throw new Error('`parche ai-upgrade` necesita un repositorio git.');
    if (!git.isClean(root)) throw new Error('Hay cambios sin commitear. Commiteá o guardá (stash) antes de correr `parche ai-upgrade`.');
  }
  const scan = run(root);
  const upgrades = (await checkUpgrades(scan.inventory, root, registry))
    .filter((u) => u.status === 'afectado' && (typeof args.package !== 'string' || u.package === args.package));
  const results = [];
  for (const upgrade of upgrades) {
    const api = scan.inventory.apis.find((a) => a.kind === 'sdk' && a.package === upgrade.package);
    const types = await registry.types(upgrade.package, upgrade.latest);
    let proposal;
    try {
      proposal = await proposeUpgrade({ root, upgrade, api, scan, types, ask: call, model });
    } catch (err) {
      proposal = { ok: false, package: upgrade.package, reason: `no se pudo pedir el arreglo: ${err.message}` };
    }
    console.log(`\n■ ${upgrade.package} ${upgrade.installed} → ${upgrade.latest}: ${proposal.ok ? 'el arreglo pasó la verificación' : `sin arreglo (${proposal.reason})`}`);
    results.push({ ...proposal, upgrade });
    if (!proposal.ok || measure) continue;
    // Un paquete que falla al abrir su PR (los tests, npm, GitHub) no frena a los que siguen, como en `parche pr`.
    try {
      results.at(-1).pr = await openAiPr({ root, args, env, proposal, upgrade, model, version });
    } catch (err) {
      console.error(`  No se pudo con ${upgrade.package}: ${err.message.split('\n')[0]}`);
      results.at(-1).error = err.message;
      record(root, { type: 'error', pack: `sdk-upgrade.${slug(upgrade.package)}`, message: err.message.split('\n')[0] });
    }
  }
  if (!upgrades.length) console.log('Ningún SDK de npm del repo tiene llamadas que cambien en su última versión.');
  if (measure) console.log(JSON.stringify(results.map(({ upgrade, files, ...r }) => ({ ...r, files: files ? Object.keys(files) : [] })), null, 2));
  const failed = results.filter((r) => r.error);
  if (failed.length) throw new Error(failed.map((r) => `${r.package}: ${r.error}`).join('\n'));
  return results;
}

async function openAiPr({ root, args, env, proposal, upgrade, model, version }) {
  const base = git.currentBranch(root);
  const id = `sdk-upgrade.${slug(upgrade.package)}`;
  const branch = `parche/${id}`;
  const title = `Parche (a prueba): ${upgrade.package} ${upgrade.installed} → ${upgrade.latest}`;
  git.checkoutNewBranch(root, branch, base);
  let keep = false;
  try {
    for (const [rel, text] of Object.entries(proposal.files)) fs.writeFileSync(path.join(root, rel), text);
    const pkgPath = path.join(root, 'package.json');
    const bumped = bumpDependency(fs.readFileSync(pkgPath, 'utf8'), upgrade.package, upgrade.latest);
    if (!bumped) throw new Error(`No encontré ${upgrade.package} en package.json para subirle la versión.`);
    fs.writeFileSync(pkgPath, bumped);
    const lockfile = fs.existsSync(path.join(root, 'package-lock.json'));
    const changed = [...Object.keys(proposal.files), 'package.json'];
    // El lockfile, sin scripts de instalación: npm no ejecuta código de las dependencias.
    if (lockfile && !args['dry-run']) {
      const r = npm(root, ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
      if (r.status !== 0) throw new Error(`npm no pudo actualizar package-lock.json: ${(r.stderr || '').trim().split('\n').pop()}`);
      changed.push('package-lock.json');
    }
    let tests = null;
    if (args.verify) {
      const r = npm(root, ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
      if (r.status !== 0) throw new Error(`npm no pudo instalar la versión nueva: ${(r.stderr || '').trim().split('\n').pop()}`);
      tests = verify(root, Object.keys(proposal.files), { runTests: true });
      if (!tests.ok) throw new Error(`Con el arreglo, los tests del repo no pasan: no se abre el PR.\n${JSON.stringify(tests, null, 2)}`);
    }
    const body = aiPrBody({ proposal, upgrade, model, tests, lockfile: changed.includes('package-lock.json') });
    const bodyPath = path.join(root, '.parche', `pr-${id}.md`);
    fs.mkdirSync(path.dirname(bodyPath), { recursive: true });
    fs.writeFileSync(bodyPath, body);
    const sha = git.commitAll(root, `${title}\n\nArreglo generado con IA y verificado por Parche (nivel 2, a prueba).\nPack ${id} v${version}.`, env);
    keep = true;
    const target = parseGithubRemote(git.originUrl(root));
    let pr = { status: null, url: null };
    if (!args['dry-run'] && env.GITHUB_TOKEN && target) {
      pr = await publishPr({ root, client: githubClient(env.GITHUB_TOKEN), target, pushTo: target, pushRemote: 'origin', branch, base, pack: { id }, title, body, draft: true });
      console.log(`  PR ${pr.status === 'opened' ? 'abierto (borrador)' : pr.status}: ${pr.url || branch}`);
    } else {
      console.log(`  Modo prueba: la rama ${branch} quedó armada, sin abrir el PR. Cuerpo: ${bodyPath}`);
    }
    record(root, { type: 'ai-pr', pack: id, package: upgrade.package, from: upgrade.installed, to: upgrade.latest, model: proposal.model || model,
      branch, sha, url: pr.url, files: changed, check: proposal.check, tests: tests ? tests.ok : null, usage: proposal.usage || null, ...(pr.status && pr.status !== 'opened' ? { existing: pr.status } : {}) });
    return pr;
  } finally {
    // Sin commit, nada de lo que se escribió queda en el repo (el árbol estaba limpio antes de empezar).
    if (!keep) git.discardChanges(root);
    git.checkout(root, base);
    if (!keep) git.deleteBranch(root, branch);
  }
}
