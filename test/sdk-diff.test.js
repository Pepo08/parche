// Diff de SDKs de npm (hito C): tarballs, registry con caché, superficie con TypeScript, comparación,
// cruce con el inventario y CLI. Todo con fixtures y un registry falso: sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { extractTypes } from '../src/sdk-diff/tar.js';
import { createRegistry, typesEntry, typesInExports, compareVersions } from '../src/sdk-diff/registry.js';
import { extractSurface } from '../src/sdk-diff/surface.js';
import { diffSurfaces, affectedOperations, unverifiedOperations } from '../src/sdk-diff/compare.js';
import { installedVersion, checkUpgrades, upgradeFindings, resolveSpec } from '../src/sdk-diff/upgrades.js';
import { run } from '../src/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'sdk-diff', 'demo-sdk');
const BIN = path.join(HERE, '..', 'bin', 'parche.js');

// --- Escritor mínimo de tar (ustar + pax), para armar tarballs como los de npm. ---
function tarHeader(name, size, type = '0') {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0);
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}
const pad = (buf) => Buffer.concat([buf, Buffer.alloc((512 - (buf.length % 512)) % 512)]);
function makeTgz(entries) {
  const parts = [];
  for (const [name, content] of entries) {
    const data = Buffer.from(content);
    if (name.length > 100) {
      let rec = ` path=${name}\n`;
      let len = rec.length;
      while (`${len}${rec}`.length !== len) len = `${len}${rec}`.length;
      const pax = Buffer.from(`${len}${rec}`);
      parts.push(tarHeader('PaxHeader', pax.length, 'x'), pad(pax));
    }
    parts.push(tarHeader(name.slice(0, 100), data.length), pad(data));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts));
}
const dirEntries = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? dirEntries(path.join(dir, e.name), base)
  : [[`package/${path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')}`, fs.readFileSync(path.join(dir, e.name), 'utf8')]]));

// Registry falso: sirve metadata y tarballs del demo-sdk, con integridad sha512 como npm.
function fakeRegistry({ tamper = false } = {}) {
  const tgz = { '1.0.0': makeTgz(dirEntries(path.join(FIX, '1.0.0'))), '2.0.0': makeTgz(dirEntries(path.join(FIX, '2.0.0'))) };
  const integrity = (b) => `sha512-${crypto.createHash('sha512').update(b).digest('base64')}`;
  const meta = { name: 'demo-sdk', 'dist-tags': { latest: '2.0.0' }, versions: {} };
  for (const v of Object.keys(tgz)) meta.versions[v] = { dist: { tarball: `https://registry.example/demo-sdk-${v}.tgz`, integrity: integrity(tgz[v]) } };
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url.endsWith('/demo-sdk')) return json(meta);
    const m = url.match(/demo-sdk-(.+)\.tgz$/);
    if (m) {
      const buf = tamper ? Buffer.concat([tgz[m[1]], Buffer.from('x')]) : tgz[m[1]];
      return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
    }
    return { ok: false, status: 404 };
  };
  return { fetch, calls, tgz, meta };
}
const tmpDir = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('tar: extrae solo tipos y package.json, con nombres largos (pax) y sin el "package/"', () => {
  const long = `package/${'muy/'.repeat(30)}largo.d.ts`;
  const files = extractTypes(makeTgz([['package/package.json', '{}'], ['package/index.d.ts', 'x'], ['package/index.js', 'no'], [long, 'y']]));
  assert.deepEqual([...files.keys()].sort(), ['index.d.ts', 'package.json', long.replace('package/', '')].sort());
});

test('registry: dónde están los tipos (types, exports anidados como stripe 23, index.d.ts) y versiones', () => {
  const files = (pkg, extra = []) => new Map([['package.json', JSON.stringify(pkg)], ...extra.map((f) => [f, ''])]);
  assert.equal(typesEntry(files({ types: './lib/a.d.ts' }, ['lib/a.d.ts'])), 'lib/a.d.ts');
  assert.equal(typesEntry(files({ typings: 'lib/b' }, ['lib/b.d.ts'])), 'lib/b.d.ts');
  assert.equal(typesInExports({ '.': { require: { types: './cjs/x.d.ts' } } }), './cjs/x.d.ts');
  assert.equal(typesInExports({ browser: { import: './w.js' }, default: { import: { types: './esm/n.d.ts' }, require: { types: './cjs/n.d.ts' } } }), './cjs/n.d.ts');
  assert.equal(typesInExports({ './sub': { types: './s.d.ts' } }), null);
  assert.equal(typesEntry(files({}, ['index.d.ts'])), 'index.d.ts');
  assert.equal(typesEntry(files({ main: 'x.js' })), null);
  assert.deepEqual(['10.0.0', '2.1.0', '2.0.0-beta.1', '2.0.0'].sort(compareVersions), ['2.0.0-beta.1', '2.0.0', '2.1.0', '10.0.0']);
  const meta = { 'dist-tags': { latest: '4.2.0' }, versions: { '3.3.0': {}, '4.0.0': {}, '4.2.0': {}, '5.0.0-rc.1': {} } };
  assert.equal(resolveSpec(meta, 'latest'), '4.2.0');
  assert.equal(resolveSpec(meta, '4'), '4.2.0');
  assert.equal(resolveSpec(meta, '5'), null, 'las prereleases no cuentan');
});

test('registry: baja, verifica integridad, cachea y funciona sin red con el caché', async () => {
  const cacheDir = tmpDir('parche-cache-');
  const fake = fakeRegistry();
  const reg = createRegistry({ cacheDir, fetch: fake.fetch, offline: false });
  const t = await reg.types('demo-sdk', '1.0.0');
  assert.equal(t.entry, 'index.d.ts');
  assert.ok(t.files.has('resources/pagos.d.ts'));
  assert.ok(fs.existsSync(path.join(cacheDir, 'demo-sdk', '1.0.0.tgz')));
  const n = fake.calls.length;
  await reg.types('demo-sdk', '1.0.0');
  assert.equal(fake.calls.length, n, 'la segunda vez sale del caché');
  const offline = createRegistry({ cacheDir, fetch: () => { throw new Error('no debería usar la red'); }, offline: true });
  assert.equal((await offline.types('demo-sdk', '1.0.0')).entry, 'index.d.ts');
  await assert.rejects(offline.types('demo-sdk', '2.0.0'), /Sin conexión/);
  const tampered = createRegistry({ cacheDir: tmpDir('parche-cache-'), fetch: fakeRegistry({ tamper: true }).fetch, offline: false });
  await assert.rejects(tampered.types('demo-sdk', '2.0.0'), /integridad/);
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

const surfaceOf = (v) => {
  const files = new Map(dirEntries(path.join(FIX, v)).map(([p, c]) => [p.replace('package/', ''), c]));
  return extractSurface({ files, entry: 'index.d.ts', pkgName: 'demo-sdk' });
};

test('superficie: instancia del export por defecto, exports con nombre, fábricas y sin privados', () => {
  const s = surfaceOf('1.0.0');
  for (const p of ['pagos.crear', 'pagos.reembolsar', 'pagos.listar', 'clientes.crear', 'clientes.borrar', 'ping']) assert.ok(s.default.has(p), p);
  assert.ok(!s.default.has('secreto'), 'lo privado no es superficie pública');
  for (const p of ['Cliente', 'Cliente.pagos.crear', 'Legado', 'Legado.enviar', 'crearCliente', 'crearCliente.pagos.crear']) assert.ok(s.exports.has(p), p);
  assert.ok(!s.exports.has('Opciones'), 'solo tipos: no se puede llamar');
  assert.deepEqual(s.default.get('pagos.crear').signatures[0].params.map((p) => `${p.name}${p.optional ? '?' : ''}:${p.type}`), ['monto:number', 'moneda?:string']);
});

test('comparación: borrados, parámetros obligatorios nuevos, tipos cambiados y deprecados', () => {
  const before = surfaceOf('1.0.0');
  const changes = diffSurfaces(before, surfaceOf('2.0.0'));
  const pick = (ns, p) => changes.filter((c) => c.ns === ns && c.path === p).map((c) => c.type);
  assert.deepEqual(pick('default', 'pagos.crear'), ['new-required']);
  assert.match(changes.find((c) => c.path === 'pagos.crear').message, /1 → 3: moneda, idempotencia/);
  assert.deepEqual(pick('default', 'pagos.reembolsar'), ['type-changed']);
  assert.deepEqual(pick('default', 'pagos.listar'), ['deprecated']);
  assert.match(changes.find((c) => c.path === 'pagos.listar').message, /Usá buscar\(\)/);
  assert.deepEqual(pick('default', 'clientes.borrar'), ['removed']);
  assert.deepEqual(pick('exports', 'Legado'), ['removed']);
  assert.ok(!changes.some((c) => c.path === 'Legado.enviar'), 'si se borra el padre, no se repiten los hijos');
  assert.ok(!changes.some((c) => c.path === 'ping'), 'un parámetro opcional nuevo no rompe');
  // Cruce con las operaciones del repo.
  const ops = ['pagos.crear', 'clientes.borrar', 'clientes.crear', 'Legado.enviar', 'ping', 'noExiste.algo'];
  assert.deepEqual(affectedOperations(changes, ops, before).map((a) => a.op), ['pagos.crear', 'clientes.borrar', 'Legado.enviar']);
  assert.deepEqual(unverifiedOperations(ops, before), ['noExiste.algo']);
});

test('versión instalada: node_modules, package-lock, base del rango o la más alta de la misma mayor', () => {
  const root = tmpDir('parche-ver-');
  const meta = { versions: { '1.0.0': {}, '1.4.2': {}, '2.0.0': {} } };
  assert.deepEqual(installedVersion(root, 'demo-sdk', '^1.0.0', meta), { version: '1.0.0', from: 'package.json' });
  assert.deepEqual(installedVersion(root, 'demo-sdk', '^1.3.0', meta), { version: '1.4.2', from: 'package.json' });
  assert.equal(installedVersion(root, 'demo-sdk', 'latest', meta), null);
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/demo-sdk': { version: '1.4.2' } } }));
  assert.equal(installedVersion(root, 'demo-sdk', '^1.0.0', meta).from, 'package-lock.json');
  fs.mkdirSync(path.join(root, 'node_modules', 'demo-sdk'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'demo-sdk', 'package.json'), JSON.stringify({ version: '1.0.0' }));
  assert.deepEqual(installedVersion(root, 'demo-sdk', '^1.0.0', meta), { version: '1.0.0', from: 'node_modules' });
  fs.rmSync(root, { recursive: true, force: true });
});

// Repo de ejemplo que usa demo-sdk 1.x.
function demoRepo() {
  const root = tmpDir('parche-up-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'app', dependencies: { 'demo-sdk': '^1.0.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.js'), [
    "import Cliente from 'demo-sdk';",
    "const c = new Cliente({ apiKey: 'k' });",
    'export const cobrar = (m) => c.pagos.crear(m);',
    "export const baja = () => c.clientes.borrar('x');",
    'export const vivo = () => c.ping();',
  ].join('\n'));
  return root;
}

test('scan --upgrades: qué operaciones del repo cambian o desaparecen en la versión nueva', async () => {
  const root = demoRepo();
  const reg = createRegistry({ cacheDir: tmpDir('parche-cache-'), fetch: fakeRegistry().fetch, offline: false });
  const [r] = await checkUpgrades(run(root).inventory, root, reg);
  assert.equal(r.status, 'afectado');
  assert.equal(`${r.installed} → ${r.latest}`, '1.0.0 → 2.0.0');
  assert.deepEqual(r.affected.map((a) => a.op).sort(), ['clientes.borrar', 'pagos.crear']);
  assert.deepEqual(r.affected.find((a) => a.op === 'pagos.crear').locations, [{ file: 'src/app.js', line: 3 }]);
  assert.equal(r.totalChanges, 5, 'sin repetir el mismo cambio por cada camino');
  const findings = upgradeFindings([r]);
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.status === 'detect-only'));
  assert.ok(findings.some((f) => /demo-sdk 1\.0\.0 → 2\.0\.0: `clientes\.borrar` ya no existe\./.test(f.message)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('CLI: diff y scan --upgrades sin red, desde el caché', async () => {
  const cacheDir = tmpDir('parche-cache-');
  const reg = createRegistry({ cacheDir, fetch: fakeRegistry().fetch, offline: false });
  await reg.types('demo-sdk', '1.0.0');
  await reg.types('demo-sdk', '2.0.0');
  const env = { ...process.env, PARCHE_CACHE: cacheDir, PARCHE_OFFLINE: '1' };
  const diff = execFileSync('node', [BIN, 'diff', 'demo-sdk', '--from', '1', '--to', 'latest'], { encoding: 'utf8', env });
  assert.match(diff, /demo-sdk 1\.0\.0 → 2\.0\.0/);
  assert.match(diff, /Desaparecen \(2\)/);
  assert.match(diff, /`pagos\.crear` pide más parámetros obligatorios/);
  const root = demoRepo();
  const out = execFileSync('node', [BIN, 'scan', root, '--upgrades'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(out, /demo-sdk +1\.0\.0 → 2\.0\.0 +⚠ 2 de tus operaciones cambian o desaparecen/);
  assert.match(fs.readFileSync(path.join(root, '.parche', 'report.md'), 'utf8'), /## Versiones nuevas de tus SDKs de npm/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.parche', 'inventory.json'), 'utf8')).upgrades[0].status, 'afectado');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(cacheDir, { recursive: true, force: true });
});
