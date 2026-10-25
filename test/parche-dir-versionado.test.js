// 0.7.4: un repo con `.parche/` commiteado. Pasó copiando una carpeta ya escaneada a un repo nuevo (lo vieron los chats
// de YC y de ventas el 24/10): `scan` modificaba `.parche/` y después `pr` frenaba con "Hay cambios sin commitear", y
// si hubiera seguido, `git add -A` metía `.parche/` en el PR. Ahora `.parche/` no cuenta y nunca entra en un PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { isClean, tracksParcheDir } from '../src/git.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'parche.js');
const ARCA = 'arca.wsfe.condicion-iva-receptor';
const VOUCHER = "export const emitir = (afip) => afip.ElectronicBilling.createVoucher({\n  CbteTipo: 6,\n  DocTipo: 99,\n  DocNro: 0,\n});\n";

// Un repo con `.parche/` commiteado; `dir` es la carpeta que se revisa (puede ser una subcarpeta del repo).
function repo(files, dir = '') {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-dir-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(top, dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(top, dir, rel), text);
  }
  const g = (...a) => execFileSync('git', a, { cwd: top, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  return { top, root: path.join(top, dir), g };
}
const PARCHE = { '.parche/ledger.jsonl': '{"type":"scan"}\n', '.parche/report.md': '# viejo\n' };

for (const dir of ['', 'apps/facturacion']) {
  test(`.parche/ commiteado${dir ? ' en una subcarpeta' : ''}: scan y después pr andan, y el PR no lo incluye`, () => {
    const { top, root, g } = repo({ 'src/f.js': VOUCHER, ...PARCHE }, dir);
    assert.ok(tracksParcheDir(root));
    execFileSync('node', [BIN, 'scan', root], { encoding: 'utf8' }); // modifica .parche/report.md y el registro
    assert.notEqual(g('status', '--porcelain').trim(), '', 'git ve .parche/ modificado');
    assert.ok(isClean(root), 'para Parche, el repo está limpio');
    const r = spawnSync('node', [BIN, 'pr', root, '--pack', ARCA, '--dry-run', '--author', 't <t@users.noreply.github.com>'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /`\.parche\/` está commiteado en el repo/);
    // El commit del PR tiene el arreglo y nada de .parche/.
    const files = g('show', '--name-only', '--format=', `parche/${ARCA}`).trim().split('\n');
    assert.deepEqual(files, [`${dir ? `${dir}/` : ''}src/f.js`]);
    // Fuera de .parche/, el repo quedó como estaba, en main.
    assert.equal(g('status', '--porcelain', '--', ':/', `:(exclude)${dir ? `${dir}/` : ''}.parche`).trim(), '');
    assert.equal(g('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
    fs.rmSync(top, { recursive: true, force: true });
  });
}

test('.parche/ commiteado: si la verificación falla, se descarta el arreglo pero no el registro de la corrida', () => {
  const { root, g } = repo({ 'src/f.js': VOUCHER, 'package.json': JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }), ...PARCHE });
  const r = spawnSync('node', [BIN, 'pr', root, '--pack', ARCA, '--dry-run', '--verify', '--author', 't <t@t>'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /La verificación falló/);
  assert.equal(g('status', '--porcelain', '--', 'src/f.js').trim(), '', 'el arreglo se descartó'); // git, no los bytes: con autocrlf vuelve en CRLF
  assert.match(fs.readFileSync(path.join(root, '.parche', 'ledger.jsonl'), 'utf8'), /^\{"type":"scan"\}\r?\n/, 'el registro commiteado sigue ahí');
  assert.equal(g('branch', '--list', 'parche/*').trim(), '');
  assert.equal(g('status', '--porcelain', '--', ':/', ':(exclude).parche').trim(), '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('sin .parche/ commiteado no hay aviso, y otros cambios siguen frenando a pr', () => {
  const { root, g } = repo({ 'src/f.js': VOUCHER });
  assert.ok(!tracksParcheDir(root));
  fs.appendFileSync(path.join(root, 'src', 'f.js'), '// a medio hacer\n');
  const r = spawnSync('node', [BIN, 'pr', root, '--pack', ARCA, '--dry-run', '--author', 't <t@t>'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Hay cambios sin commitear/);
  assert.doesNotMatch(r.stderr, /está commiteado/);
  g('checkout', '--', '.');
  const ok = spawnSync('node', [BIN, 'pr', root, '--pack', ARCA, '--dry-run', '--author', 't <t@t>'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.doesNotMatch(ok.stderr, /está commiteado/);
  fs.rmSync(root, { recursive: true, force: true });
});
