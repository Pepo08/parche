// 0.8.5: `fix` y `pr` cambian cosas, y `parseArgs` acepta cualquier flag. `parche fix . --dry-run` (el flag es de `pr`)
// escribía en el código sin avisar, `fix --pakc <id>` aplicaba todos los packs y `pr --dryrun` podía abrir el PR de verdad.
// Ahora un flag que no conocen frena antes de tocar nada; el resto de los comandos lee los flags como antes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'parche.js');
const ARCA = 'arca.wsfe.condicion-iva-receptor';
const AUTHOR = 't <t@users.noreply.github.com>';
const VOUCHER = "export const emitir = (afip) => afip.ElectronicBilling.createVoucher({\n  CbteTipo: 6,\n  DocTipo: 99,\n  DocNro: 0,\n});\n";

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-flags-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'f.js'), VOUCHER);
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  return { root, g };
}
const parche = (...a) => spawnSync('node', [BIN, ...a], { encoding: 'utf8' });

function untouched({ root, g }) {
  assert.equal(fs.readFileSync(path.join(root, 'src', 'f.js'), 'utf8'), VOUCHER);
  assert.equal(g('status', '--porcelain').trim(), '');
  assert.equal(g('branch', '--format=%(refname:short)').trim(), 'main');
  assert.ok(!fs.existsSync(path.join(root, '.parche')));
}

test('fix --dry-run no toca nada y dice qué usar', () => {
  const r = repo();
  const out = parche('fix', r.root, '--dry-run');
  assert.equal(out.status, 1);
  assert.match(out.stderr, /`parche fix` no tiene --dry-run/);
  assert.match(out.stderr, /`parche scan`/);
  assert.match(out.stderr, /`parche pr --dry-run`/);
  untouched(r);
});

test('fix con un flag mal escrito no aplica todos los packs', () => {
  const r = repo();
  const out = parche('fix', r.root, '--pakc', ARCA);
  assert.equal(out.status, 1);
  assert.match(out.stderr, /`parche fix` no conoce --pakc/);
  assert.match(out.stderr, /--pack/);
  untouched(r);
});

test('pr con un flag mal escrito no arma ninguna rama', () => {
  const r = repo();
  const out = parche('pr', r.root, '--dryrun', '--author', AUTHOR);
  assert.equal(out.status, 1);
  assert.match(out.stderr, /`parche pr` no conoce --dryrun/);
  assert.match(out.stderr, /--dry-run/);
  untouched(r);
});

test('fix --pack sigue aplicando el arreglo', () => {
  const { root } = repo();
  const out = parche('fix', root, '--pack', ARCA);
  assert.equal(out.status, 0, out.stderr);
  assert.notEqual(fs.readFileSync(path.join(root, 'src', 'f.js'), 'utf8'), VOUCHER);
});

test('pr acepta lo que le pasa la Action (--pack, --verify y --dry-run) y --author', () => {
  const { root } = repo();
  const out = parche('pr', root, '--pack', ARCA, '--verify', '--dry-run', '--author', AUTHOR);
  assert.doesNotMatch(out.stderr, /no conoce/);
  assert.equal(out.status, 0, out.stderr);
});

test('el flag de pr para pushear a un fork no se toma como desconocido', () => {
  const { root } = repo();
  const out = parche('pr', root, '--pack', ARCA, '--dry-run', '--push-remote', 'fork', '--author', AUTHOR);
  assert.doesNotMatch(out.stderr, /no conoce/);
});

test('scan sigue sin fijarse en los flags que no usa', () => {
  const { root } = repo();
  const out = parche('scan', root, '--dry-run');
  assert.equal(out.status, 0, out.stderr);
});
