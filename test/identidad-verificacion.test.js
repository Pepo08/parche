// Quién firma los commits de Parche y qué dice la verificación cuando Parche no corre los tests del repo.
// Salieron del primer PR real (lunamarie11/obraya#1, 17/10/2026): el commit se firmaba con bot@parche.dev
// (un dominio de otra persona) y el cuerpo decía "Sin verificar" aunque la sintaxis se había chequeado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { commitIdentity, ACTIONS_BOT } from '../src/git.js';
import { verify, prWorkflows } from '../src/verify.js';
import { prBody } from '../src/report.js';
import { loadPacks } from '../src/packs.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'parche.js');
const pack = loadPacks().find((p) => p.id === 'arca.wsfe.condicion-iva-receptor');
const VOUCHER = "export const emitir = (afip) => afip.ElectronicBilling.createVoucher({\n  CbteTipo: 6,\n  DocTipo: 99,\n  DocNro: 0,\n});\n";

// Repo de prueba sin ninguna identidad de git a la vista: ni global, ni de sistema, ni del repo.
function bareRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-id-'));
  const emptyGlobal = path.join(root, '..', `${path.basename(root)}.gitconfig`);
  fs.writeFileSync(emptyGlobal, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: emptyGlobal, GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of ['GITHUB_ACTIONS', 'PARCHE_GIT_NAME', 'PARCHE_GIT_EMAIL', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete env[k];
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', env });
  g('init', '-q', '-b', 'main');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  const cleanup = () => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(emptyGlobal, { force: true }); };
  return { root, g, env, cleanup };
}

test('identidad del commit: nunca parche.dev; variables, git de quien lo corre, bot de Actions o error', () => {
  const { root, g, env, cleanup } = bareRepo({ 'src/f.js': VOUCHER });
  // Sin identidad y fuera de Actions: error claro, no un autor inventado.
  assert.throws(() => commitIdentity(root, env), /No hay una identidad de git para firmar el commit/);
  // En GitHub Actions sin identidad configurada: el bot de Actions.
  assert.deepEqual(commitIdentity(root, { ...env, GITHUB_ACTIONS: 'true' }), ACTIONS_BOT);
  assert.equal(ACTIONS_BOT.email, '41898282+github-actions[bot]@users.noreply.github.com');
  // Las variables de Parche mandan sobre todo lo demás.
  assert.deepEqual(commitIdentity(root, { ...env, GITHUB_ACTIONS: 'true', PARCHE_GIT_NAME: 'Equipo', PARCHE_GIT_EMAIL: 'equipo@empresa.com' }),
    { name: 'Equipo', email: 'equipo@empresa.com' });
  // La identidad de git de quien lo corre (o la que configuró su workflow), también dentro de Actions.
  g('config', 'user.name', 'Ana Dev');
  g('config', 'user.email', 'ana@empresa.com');
  assert.deepEqual(commitIdentity(root, { ...env, GITHUB_ACTIONS: 'true' }), { name: 'Ana Dev', email: 'ana@empresa.com' });
  // De punta a punta: el commit de la rama de Parche lo firma esa identidad.
  execFileSync('node', [BIN, 'pr', root, '--pack', pack.id, '--dry-run'], { encoding: 'utf8', env });
  assert.equal(g('log', '-1', '--format=%an <%ae>', `parche/${pack.id}`).trim(), 'Ana Dev <ana@empresa.com>');
  // En Actions sin identidad, el commit lo firma el bot de Actions.
  g('config', '--unset', 'user.name');
  g('config', '--unset', 'user.email');
  g('branch', '-D', `parche/${pack.id}`);
  execFileSync('node', [BIN, 'pr', root, '--pack', pack.id, '--dry-run'], { encoding: 'utf8', env: { ...env, GITHUB_ACTIONS: 'true' } });
  assert.equal(g('log', '-1', '--format=%an <%ae>', `parche/${pack.id}`).trim(), `${ACTIONS_BOT.name} <${ACTIONS_BOT.email}>`);
  cleanup();
});

test('sin identidad, `parche pr` frena antes de tocar el repo', () => {
  const { root, g, env, cleanup } = bareRepo({ 'src/f.js': VOUCHER });
  const r = spawnSync('node', [BIN, 'pr', root, '--pack', pack.id, '--dry-run'], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No hay una identidad de git/);
  assert.equal(g('status', '--porcelain').trim(), '', 'el repo queda como estaba');
  assert.equal(g('branch', '--list', 'parche/*').trim(), '', 'sin rama de Parche');
  cleanup();
});

test('sin --verify: la sintaxis se chequea igual y el PR dice dónde se corren los tests', () => {
  const ci = "name: CI\non:\n  push:\n  pull_request:\n    branches: [main]\njobs: {}\n";
  const { root, g, env, cleanup } = bareRepo({
    'src/f.js': VOUCHER,
    '.github/workflows/ci.yml': ci,
    '.github/workflows/lista.yaml': 'on:\n  - push\n  - pull_request\n',
    '.github/workflows/corto.yml': 'on: [push, pull_request]\n',
    '.github/workflows/deploy.yml': 'on:\n  push:\n    branches: [main]\n',
    '.github/workflows/target.yml': 'on:\n  pull_request_target:\n',
  });
  g('config', 'user.name', 'Ana Dev');
  g('config', 'user.email', 'ana@empresa.com');
  // pull_request_target corre el código de la rama base: no prueba el cambio del PR.
  assert.deepEqual(prWorkflows(root), ['.github/workflows/ci.yml', '.github/workflows/corto.yml', '.github/workflows/lista.yaml']);
  // Sin --verify (como en un PR a un repo de terceros): igual hay chequeo de sintaxis.
  const out = execFileSync('node', [BIN, 'pr', root, '--pack', pack.id], { encoding: 'utf8', env });
  assert.match(out, /verificación OK/);
  const body = fs.readFileSync(path.join(root, '.parche', `pr-${pack.id}.md`), 'utf8');
  assert.match(body, /- Sintaxis de los archivos modificados: ✅ OK/);
  assert.match(body, /- Tests del repo: Parche no los corrió; los corre el CI de este repo \(`\.github\/workflows\/ci\.yml`, `\.github\/workflows\/corto\.yml`, `\.github\/workflows\/lista\.yaml`\) en este PR\./);
  assert.doesNotMatch(body, /Sin verificar/);
  cleanup();
  // Sin CI que corra en los PRs: lo dice y pide correrlos.
  const v = verify(fs.mkdtempSync(path.join(os.tmpdir(), 'parche-v-')), [], {});
  assert.deepEqual(v.tests, { ok: true, notRun: true, ci: [] });
  const changed = [{ file: 'src/f.js', packs: [pack.id] }];
  const findings = [{ pack: pack.id, file: 'src/f.js', line: 1, status: 'auto', message: 'x' }];
  assert.match(prBody({ pack, findings, changed, verification: { ...v, parse: { ok: true, errors: [] } } }),
    /- Tests del repo: Parche no los corrió \(sin `--verify` no ejecuta código del repo\)\. Corrélos antes de mergear\./);
  // Un issue (sin cambios de código) no lleva sección de verificación.
  assert.doesNotMatch(prBody({ pack, findings: [{ ...findings[0], status: 'needs-input' }], changed: [], verification: null }), /### Verificación|Sin verificar/);
  // Abierto por GitHub Actions con el GITHUB_TOKEN: los workflows del PR esperan aprobación, y el PR lo dice.
  const approval = /CI de este PR: lo abrió GitHub Actions con el `GITHUB_TOKEN`, así que GitHub deja sus workflows esperando aprobación\. .*\*\*Approve workflows to run\*\*/;
  assert.match(prBody({ pack, findings, changed, verification: null, ciApproval: true }), approval);
  assert.doesNotMatch(prBody({ pack, findings, changed, verification: null }), approval, 'con otro token (o fuera de Actions) no se dice');
  assert.doesNotMatch(prBody({ pack, findings: [{ ...findings[0], status: 'needs-input' }], changed: [], verification: null, ciApproval: true }), approval, 'un issue no corre workflows');
});

test('Action: el nombre para el Marketplace es "Parche API Changes" y avisa el token por defecto', () => {
  const action = fs.readFileSync(path.join(path.dirname(BIN), '..', 'action.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(action, /^name: Parche API Changes$/m, 'sin "Dependabot" (función de GitHub) ni "Parche" a secas (usuario de GitHub): las reglas del Marketplace no los dejan');
  assert.match(action, /PARCHE_DEFAULT_TOKEN: \$\{\{ inputs\.token == github\.token \}\}/);
});
