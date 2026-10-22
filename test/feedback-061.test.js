// 0.6.1: puntos 18 a 20 del feedback del frente B (17/10/2026) y el "No cubre" repetido en la consola.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import arca from '../src/codemods/arca-wsfe-condicion-iva.js';
import { loadPacks } from '../src/packs.js';
import { run } from '../src/engine.js';
import { isBackupDir, isBackupFile } from '../src/paths.js';
import { gitArgs, parseAuthor, isNoreply } from '../src/git.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'parche.js');
const pack = loadPacks().find((p) => p.id === 'arca.wsfe.condicion-iva-receptor');
const js = (source, file = 'x.ts') => arca({ source, file, pack });

// Repo de prueba con una identidad de git propia y nada de la máquina a la vista.
function repo(files, { identity = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-061-'));
  const globalCfg = path.join(root, '..', `${path.basename(root)}.gitconfig`);
  fs.writeFileSync(globalCfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: globalCfg, GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of ['GITHUB_ACTIONS', 'GITHUB_TOKEN', 'PARCHE_GIT_NAME', 'PARCHE_GIT_EMAIL', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete env[k];
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', env });
  g('init', '-q', '-b', 'main');
  if (identity) { g('config', 'user.name', 'Ralph'); g('config', 'user.email', 'ralph@gmail.com'); }
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  return { root, g, env, cleanup: () => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(globalCfg, { force: true }); } };
}

const PARTIAL = 'export const emitir = (afip, docTipo) => afip.ElectronicBilling.createVoucher({\n  CbteTipo: 6,\n  DocTipo: docTipo,\n  DocNro: 0,\n});\n';

test('consola: lo que no cubre un arreglo parcial sale una sola vez, sin "No cubre: No cubre"', () => {
  const { root, env, cleanup } = repo({ 'src/f.js': PARTIAL });
  const out = execFileSync('node', [BIN, 'scan', root], { encoding: 'utf8', env });
  assert.match(out, /No cubre los comprobantes con DocTipo distinto de 99/);
  assert.doesNotMatch(out, /No cubre: No cubre/);
  cleanup();
});

test('punto 18: si el objeto recibe el campo después, cuenta como migrado (como en PHP)', () => {
  const emitir = (extra) => `export async function emitir(afip, input, docTipo) {\n  const voucherData = {\n    CbteTipo: 6,\n    DocTipo: docTipo,\n    DocNro: 0,\n  };\n${extra}  return afip.ElectronicBilling.createVoucher(voucherData);\n}\n`;
  const migrated = [
    '  if (input.condicionIvaReceptor) { voucherData.CondicionIVAReceptorId = input.condicionIvaReceptor; }\n', // vibook-services
    "  voucherData['CondicionIVAReceptorId'] = input.c;\n",
    '  (voucherData as any).CondicionIVAReceptorId = input.c;\n',
    '  Object.assign(voucherData, { CondicionIVAReceptorId: input.c });\n',
  ];
  for (const extra of migrated) {
    const r = js(emitir(extra));
    assert.equal(r.output, null, extra);
    assert.equal(r.findings.length, 0, extra);
  }
  // Otro campo no cuenta: sigue el arreglo parcial.
  assert.match(js(emitir('  voucherData.ImpTotal = 1;\n')).output, /Number\(docTipo\) === 99/);
  // Una variable con el mismo nombre en otra función no es la misma: sigue el arreglo parcial.
  const shadow = 'function a(afip, docTipo) {\n  const voucherData = { CbteTipo: 6, DocTipo: docTipo, DocNro: 0 };\n  return afip.ElectronicBilling.createVoucher(voucherData);\n}\nfunction b() {\n  const voucherData = {};\n  voucherData.CondicionIVAReceptorId = 1;\n}\n';
  assert.match(js(shadow).output, /Number\(docTipo\) === 99/);
  // También con DocTipo 99 fijo: si lo completa después, no se agrega nada.
  assert.equal(js(emitir('  voucherData.CondicionIVAReceptorId = 5;\n').replace('DocTipo: docTipo', 'DocTipo: 99')).output, null);
});

test('punto 19: las copias de respaldo no se leen ni se editan, y el scan dice cuáles saltó', () => {
  for (const d of ['BAK', 'bak', 'backup', 'Backups', 'old', '_old', 'deprecated']) assert.ok(isBackupDir(d), d);
  for (const d of ['src', 'olders', 'legacy', 'bakery']) assert.ok(!isBackupDir(d), d);
  for (const f of ['informarFacturaARCA copy.php', 'factura - Copy.js', 'factura copia.php', 'factura copy 2.js', 'factura copy (2).ts', 'factura.bak.php', 'factura-old.php', 'factura_old.js', 'factura.old.php']) assert.ok(isBackupFile(f), f);
  for (const f of ['deep_copy.js', 'copy.js', 'gold.js', 'bold.php', 'factura.php', 'backup.js']) assert.ok(!isBackupFile(f), f);

  const voucher = "<?php\n$afip->ElectronicBilling->CreateVoucher(array('CbteTipo' => 6, 'DocTipo' => 99, 'DocNro' => 0));\n";
  const { root, env, cleanup } = repo({
    'src/factura.php': voucher,
    'BAK/admin/generarNC.php': voucher,
    'BAK/nuevaVenta.php': voucher,
    'informarFacturaARCA copy.php': voucher,
    'old/package.json': JSON.stringify({ dependencies: { stripe: '^1.0.0' } }),
    'old/wsfe.wsdl': '<definitions><element name="FECAEDetRequest"><DocTipo/></element></definitions>',
  });
  const r = run(root);
  assert.deepEqual(r.findings.map((f) => f.file), ['src/factura.php']);
  assert.deepEqual(r.changed.map((c) => c.file), ['src/factura.php'], 'solo se arregla el archivo vigente');
  assert.deepEqual(r.skipped, ['BAK/', 'informarFacturaARCA copy.php', 'old/']);
  // Los manifiestos y los WSDL de una carpeta de respaldo tampoco cuentan.
  assert.ok(!r.inventory.apis.some((a) => a.name === 'stripe' || /stripe/i.test(a.provider || '')), 'stripe de old/ no entra al inventario');
  assert.deepEqual(r.context.staleWsdl, []);
  const out = execFileSync('node', [BIN, 'scan', root], { encoding: 'utf8', env });
  assert.match(out, /No revisé 3 copia\(s\) de respaldo: BAK\/, informarFacturaARCA copy\.php, old\/\. Si alguna es código que corre, renombrala o movela\./);
  assert.match(fs.readFileSync(path.join(root, '.parche', 'report.md'), 'utf8'), /\*\*Copias de respaldo que no se revisaron\*\*[^\n]*\n\n- `BAK\/`\n- `informarFacturaARCA copy\.php`\n- `old\/`/);
  cleanup();
});

test('punto 20: rutas largas en Windows, --author y el aviso de email público', () => {
  // Rutas largas: en Windows cada comando de git lleva core.longpaths.
  assert.deepEqual(gitArgs(['status'], 'win32'), ['-c', 'core.longpaths=true', 'status']);
  assert.deepEqual(gitArgs(['status'], 'linux'), ['status']);
  // --author "Nombre <email>".
  assert.deepEqual(parseAuthor('Joaquin Gonzalez Menza <124802690+Pepo08@users.noreply.github.com>'),
    { PARCHE_GIT_NAME: 'Joaquin Gonzalez Menza', PARCHE_GIT_EMAIL: '124802690+Pepo08@users.noreply.github.com' });
  for (const bad of ['', 'Joaquin', 'Joaquin <sin-arroba>', true]) assert.throws(() => parseAuthor(bad), /--author tiene que ser "Nombre <email>"/);
  assert.ok(isNoreply('124802690+Pepo08@users.noreply.github.com'));
  assert.ok(!isNoreply('ralph@gmail.com'));

  const { root, g, env, cleanup } = repo({ 'src/f.js': PARTIAL });
  // Con --author firma esa identidad, aunque la de git de la máquina sea otra.
  const out = execFileSync('node', [BIN, 'pr', root, '--pack', pack.id, '--dry-run', '--author', 'Joaquin Gonzalez Menza <124802690+Pepo08@users.noreply.github.com>'], { encoding: 'utf8', env });
  assert.match(out, /Firma los commits: Joaquin Gonzalez Menza <124802690\+Pepo08@users\.noreply\.github\.com>/);
  assert.equal(g('log', '-1', '--format=%an <%ae>', `parche/${pack.id}`).trim(), 'Joaquin Gonzalez Menza <124802690+Pepo08@users.noreply.github.com>');
  g('branch', '-D', `parche/${pack.id}`);
  // --author mal escrito: frena antes de tocar el repo.
  const bad = spawnSync('node', [BIN, 'pr', root, '--pack', pack.id, '--dry-run', '--author', 'Joaquin'], { encoding: 'utf8', env });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /--author tiene que ser/);
  assert.equal(g('status', '--porcelain').trim(), '');
  assert.equal(g('branch', '--list', 'parche/*').trim(), '');
  // Aviso antes de pushear con un email que no es noreply (sin remote no se pushea nada: es solo el aviso).
  const warn = spawnSync('node', [BIN, 'pr', root, '--pack', pack.id], { encoding: 'utf8', env: { ...env, GITHUB_TOKEN: 'x' } });
  assert.equal(warn.status, 0);
  assert.match(warn.stderr, /Ojo: ralph@gmail\.com va a quedar público en el commit del PR\. Si preferís no mostrarlo, usá --author/);
  g('branch', '-D', `parche/${pack.id}`);
  const quiet = spawnSync('node', [BIN, 'pr', root, '--pack', pack.id, '--author', 'J <1+J@users.noreply.github.com>'], { encoding: 'utf8', env: { ...env, GITHUB_TOKEN: 'x' } });
  assert.doesNotMatch(quiet.stderr, /Ojo:/);
  cleanup();
});

test('punto 20 (pendiente de 0.5.0): si solo cambiarían tests, el texto queda como issue, sin "Modifica 1 archivo"', () => {
  const { root, env, cleanup } = repo({ 'test/mock-client.test.ts': PARTIAL.replace('docTipo', '99').replace('(afip, 99)', '(afip, docTipo)') });
  const out = execFileSync('node', [BIN, 'pr', root, '--pack', pack.id, '--dry-run'], { encoding: 'utf8', env });
  assert.match(out, /Solo cambiaría tests o mocks/);
  const body = fs.readFileSync(path.join(root, '.parche', `pr-${pack.id}.md`), 'utf8');
  assert.match(body, /### Qué encontró Parche/);
  assert.doesNotMatch(body, /Modifica \d+ archivo|### Qué hace este PR|### Verificación/);
  cleanup();
});
