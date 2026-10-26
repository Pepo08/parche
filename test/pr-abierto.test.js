// 0.7.6: lo que pasa cuando ya hay un PR de Parche abierto (P9) y cuando GitHub no deja que Actions abra PRs (P8).
// Hasta la 0.7.5, `parche pr` pusheaba su rama con --force y pedía otro PR: pisaba los commits que alguien le hubiera
// sumado al PR, GitHub rechazaba el PR repetido y la corrida se cortaba ahí (F2 del chat de página, 25/10). Sin red: la
// API de GitHub es un `fetch` falso y el remote, un repo bare local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { run } from '../src/engine.js';
import { loadPacks } from '../src/packs.js';
import * as git from '../src/git.js';
import { publishPr, isParcheCommit } from '../src/publish.js';
import { githubClient, apiError, ACTIONS_CANNOT_OPEN_PRS_MESSAGE } from '../src/github.js';
import { stepSummary } from '../src/actions.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'parche.js');
const ARCA = loadPacks().find((p) => p.id === 'arca.wsfe.condicion-iva-receptor');
const BRANCH = `parche/${ARCA.id}`;
const VOUCHER = "export const emitir = (afip) => afip.ElectronicBilling.createVoucher({\n  CbteTipo: 6,\n  DocTipo: 99,\n  DocNro: 0,\n});\n";
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const TARGET = { owner: 'acme', repo: 'demo' };

// Un repo con su "origin" en un bare local, y una copia aparte para hacer de la persona que suma commits al PR.
function setup() {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-pr-'));
  const bare = path.join(top, 'origin.git');
  const root = path.join(top, 'repo');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'f.js'), VOUCHER);
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  g(...ID, 'add', '-A');
  g(...ID, 'commit', '-q', '-m', 'init');
  g('remote', 'add', 'origin', bare);
  g('push', '-q', 'origin', 'main');
  const remoteSha = () => execFileSync('git', ['rev-parse', BRANCH], { cwd: bare, encoding: 'utf8' }).trim();
  // Otra persona: clona, suma un commit a la rama de Parche y lo pushea.
  const someoneCommits = (message = 'Ajuste a mano') => {
    const other = fs.mkdtempSync(path.join(top, 'otra-'));
    execFileSync('git', ['clone', '-q', '-b', BRANCH, bare, other]);
    fs.appendFileSync(path.join(other, 'src', 'f.js'), '// revisado\n');
    execFileSync('git', [...ID, 'commit', '-q', '-am', message], { cwd: other });
    execFileSync('git', ['push', '-q', 'origin', BRANCH], { cwd: other });
  };
  return { top, root, g, remoteSha, someoneCommits };
}

// La rama de Parche con su commit, como la arma `parche pr`.
function parcheCommit(root, edit) {
  git.checkoutNewBranch(root, BRANCH, 'main');
  run(root, { write: true, packIds: [ARCA.id] });
  if (edit) fs.appendFileSync(path.join(root, 'src', 'f.js'), edit);
  git.commitAll(root, `Parche: ${ARCA.title}\n\n${ARCA.summary_es}\nPack ${ARCA.id} v${ARCA.version}.`, { ...process.env, PARCHE_GIT_NAME: 't', PARCHE_GIT_EMAIL: 't@t' });
  git.checkout(root, 'main');
}

// La API de GitHub, falsa: guarda cada llamada y responde con el PR abierto que le digamos.
function fakeGithub(openPr = null) {
  const calls = [];
  const client = {
    findOpenPull: async (q) => { calls.push(['find', q.head]); return openPr; },
    openPull: async (q) => { calls.push(['open', q.head]); return { html_url: 'https://github.com/acme/demo/pull/7', number: 7 }; },
    updatePull: async (q) => { calls.push(['update', q.number]); return {}; },
  };
  return { client, calls };
}
const OPEN = { html_url: 'https://github.com/acme/demo/pull/7', number: 7 };
const publish = (root, client) => publishPr({ root, client, target: TARGET, pushTo: TARGET, pushRemote: 'origin', branch: BRANCH, base: 'main', pack: ARCA, title: 't', body: 'b', draft: false });

test('sin PR abierto: pushea la rama y abre el PR, como siempre', async () => {
  const { top, root, remoteSha, g } = setup();
  parcheCommit(root);
  const { client, calls } = fakeGithub();
  const r = await publish(root, client);
  assert.equal(r.status, 'opened');
  assert.equal(r.url, OPEN.html_url);
  assert.deepEqual(calls, [['find', `acme:${BRANCH}`], ['open', BRANCH]]);
  assert.equal(remoteSha(), g('rev-parse', BRANCH));
  fs.rmSync(top, { recursive: true, force: true });
});

test('PR abierto con el mismo arreglo: no pushea ni toca el PR (la corrida de la semana siguiente)', async () => {
  const { top, root, remoteSha } = setup();
  parcheCommit(root);
  await publish(root, fakeGithub().client);
  const before = remoteSha();
  parcheCommit(root); // otra corrida: otro commit, mismo arreglo
  const { client, calls } = fakeGithub(OPEN);
  const r = await publish(root, client);
  assert.equal(r.status, 'unchanged');
  assert.equal(r.url, OPEN.html_url);
  assert.deepEqual(calls.map((c) => c[0]), ['find']);
  assert.equal(remoteSha(), before);
  fs.rmSync(top, { recursive: true, force: true });
});

test('PR abierto con solo el commit de Parche y un arreglo distinto: actualiza la rama y el PR, sin abrir otro', async () => {
  const { top, root, remoteSha, g } = setup();
  parcheCommit(root);
  await publish(root, fakeGithub().client);
  parcheCommit(root, '// el pack cambió\n');
  const { client, calls } = fakeGithub(OPEN);
  const r = await publish(root, client);
  assert.equal(r.status, 'updated');
  assert.deepEqual(calls, [['find', `acme:${BRANCH}`], ['update', 7]]);
  assert.equal(remoteSha(), g('rev-parse', BRANCH));
  fs.rmSync(top, { recursive: true, force: true });
});

test('PR abierto con un commit de otra persona encima: Parche no lo pisa ni lo actualiza', async () => {
  const { top, root, remoteSha, someoneCommits } = setup();
  parcheCommit(root);
  await publish(root, fakeGithub().client);
  someoneCommits();
  const theirs = remoteSha();
  parcheCommit(root, '// el pack cambió\n');
  const { client, calls } = fakeGithub(OPEN);
  const r = await publish(root, client);
  assert.equal(r.status, 'kept');
  assert.equal(r.others, 1);
  assert.equal(r.url, OPEN.html_url);
  assert.deepEqual(calls.map((c) => c[0]), ['find']);
  assert.equal(remoteSha(), theirs, 'el commit de la otra persona sigue ahí');
  fs.rmSync(top, { recursive: true, force: true });
});

test('sin PR abierto pero con la rama de otra persona (cerraron el PR y la dejaron): tampoco la pisa', async () => {
  const { top, root, remoteSha, someoneCommits } = setup();
  parcheCommit(root);
  await publish(root, fakeGithub().client);
  someoneCommits();
  const theirs = remoteSha();
  parcheCommit(root);
  const { client, calls } = fakeGithub(null);
  const r = await publish(root, client);
  assert.equal(r.status, 'kept');
  assert.equal(r.url, null);
  assert.deepEqual(calls.map((c) => c[0]), ['find']);
  assert.equal(remoteSha(), theirs);
  fs.rmSync(top, { recursive: true, force: true });
});

test('un commit es de Parche solo con su título y la línea del pack', () => {
  assert.ok(isParcheCommit(`Parche: x\n\nresumen\nPack ${ARCA.id} v1.`, ARCA));
  assert.ok(!isParcheCommit('Ajuste a mano', ARCA));
  assert.ok(!isParcheCommit(`Merge branch 'main' into ${BRANCH}`, ARCA));
  assert.ok(!isParcheCommit('Parche: x\n\nPack otro.pack v1.', ARCA));
});

test('P8: el 403 de "Allow GitHub Actions to create and approve pull requests" se explica en castellano', async () => {
  const forbidden = { message: 'GitHub Actions is not permitted to create or approve pull requests.' };
  assert.equal(apiError(403, forbidden).message, ACTIONS_CANNOT_OPEN_PRS_MESSAGE);
  assert.match(ACTIONS_CANNOT_OPEN_PRS_MESSAGE, /Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests"/);
  assert.match(ACTIONS_CANNOT_OPEN_PRS_MESSAGE, /organización/);
  // Los demás errores siguen diciendo qué respondió GitHub.
  assert.equal(apiError(422, { message: 'Validation Failed' }).message, 'GitHub respondió 422: Validation Failed');
  assert.equal(apiError(403, { message: 'Resource not accessible by integration' }).message, 'GitHub respondió 403: Resource not accessible by integration');
  // Por el cliente: un fetch falso que responde 403 al pedir el PR.
  const requests = [];
  const fakeFetch = async (url, init) => {
    requests.push(`${init.method} ${url}`);
    return init.method === 'POST' ? { ok: false, status: 403, json: async () => forbidden } : { ok: true, status: 200, json: async () => [] };
  };
  const client = githubClient('t', fakeFetch);
  assert.equal(await client.findOpenPull({ ...TARGET, head: `acme:${BRANCH}` }), null);
  await assert.rejects(client.openPull({ ...TARGET, head: BRANCH, base: 'main', title: 't', body: 'b', draft: false }), { message: ACTIONS_CANNOT_OPEN_PRS_MESSAGE });
  assert.deepEqual(requests, [
    `GET https://api.github.com/repos/acme/demo/pulls?state=open&head=${encodeURIComponent(`acme:${BRANCH}`)}&per_page=1`,
    'POST https://api.github.com/repos/acme/demo/pulls',
  ]);
});

test('el resumen del job dice qué pasó con cada PR que ya existía y qué pack no se pudo', () => {
  const md = stepSummary({
    opened: [
      { title: 'A', url: 'u1', draft: true, status: 'opened' },
      { title: 'B', url: 'u2', draft: false, status: 'unchanged' },
      { title: 'C', url: 'u3', draft: true, status: 'kept' },
      { title: 'D', url: null, draft: true, status: null },
    ],
    failed: [{ pack: { title: 'E' }, message: 'La verificación falló para e; no se abre el PR.\n{ "detalle": 1 }' }],
  });
  assert.match(md, /- \[A\]\(u1\) · borrador\n/);
  assert.match(md, /- \[B\]\(u2\) · ya estaba abierto con este mismo arreglo: no se tocó\n/);
  assert.match(md, /- \[C\]\(u3\) · la rama tiene commits de otra persona: Parche no la pisa/);
  assert.match(md, /- D · borrador · modo prueba: no se abrió\n/);
  assert.match(md, /### No se pudo\n\n- \*\*E\*\* · La verificación falló para e; no se abre el PR\.\n/);
  assert.doesNotMatch(md, /detalle/);
});

test('un pack que falla no corta la corrida: los que siguen corren, el resumen lo dice y pr termina con error', () => {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-loop-'));
  const files = {
    'src/f.js': VOUCHER,
    'src/pago.js': [
      "import { MercadoPagoConfig, Payment } from 'mercadopago';",
      "const client = new MercadoPagoConfig({ accessToken: process.env.MP_TOKEN });",
      'const payment = new Payment(client);',
      "export const pagar = (token) => payment.create({ body: { transaction_amount: 100, token, installments: 1, payment_method_id: 'visa', payer: { email: 'a@b.c' } } });",
      '',
    ].join('\n'),
    // Los tests del repo fallan solo con el arreglo de ARCA: falla el primer pack y el de Mercado Pago tiene que correr igual.
    'check.cjs': "process.exit(require('fs').readFileSync('src/f.js', 'utf8').includes('CondicionIVAReceptorId') ? 1 : 0);\n",
    'package.json': JSON.stringify({ name: 'demo', private: true, scripts: { test: 'node check.cjs' }, dependencies: { mercadopago: '2.4.0' } }),
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(top, rel)), { recursive: true });
    fs.writeFileSync(path.join(top, rel), text);
  }
  const g = (...a) => execFileSync('git', a, { cwd: top, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  g(...ID, 'add', '-A');
  g(...ID, 'commit', '-q', '-m', 'init');
  const summaryFile = path.join(top, 'resumen.md');
  const env = { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryFile, GITHUB_WORKSPACE: top };
  delete env.GITHUB_TOKEN;
  const r = spawnSync('node', [BIN, 'pr', top, '--dry-run', '--verify', '--author', 't <t@users.noreply.github.com>'], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No se pudo con arca\.wsfe\.condicion-iva-receptor: La verificación falló/);
  assert.match(r.stderr, /La verificación falló para arca\.wsfe\.condicion-iva-receptor/);
  // Mercado Pago corrió después del error de ARCA y dejó su rama.
  assert.match(r.stdout, /■ Parche: .*Orders/);
  assert.match(g('branch', '--list', 'parche/*'), /parche\/mercadopago\.payments-to-orders/);
  assert.doesNotMatch(g('branch', '--list', 'parche/*'), /arca/);
  const md = fs.readFileSync(summaryFile, 'utf8');
  assert.match(md, /### PRs\n\n- Parche: .*Orders.* · modo prueba: no se abrió/);
  assert.match(md, /### No se pudo\n\n- \*\*.*\*\* · La verificación falló para arca/);
  const ledger = fs.readFileSync(path.join(top, '.parche', 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(ledger.filter((e) => e.type === 'error' || e.type === 'pr').map((e) => `${e.type} ${e.pack}`),
    ['error arca.wsfe.condicion-iva-receptor', 'pr mercadopago.payments-to-orders']);
  fs.rmSync(top, { recursive: true, force: true });
});
