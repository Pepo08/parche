// 0.8.1: puntos 26, 27, 28 y 30 del feedback del frente B. Fixtures inventados, sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import arca from '../src/codemods/arca-wsfe-condicion-iva.js';
import arcaPhp from '../src/codemods/arca-wsfe-condicion-iva-php.js';
import { soapOnly, stripComments } from '../src/codemods/arca-rules.js';
import { arcaLibraries, buildContext, emptyContext } from '../src/context.js';
import { loadPacks } from '../src/packs.js';
import { isTestFile } from '../src/paths.js';
import { prBody } from '../src/report.js';
import { run } from '../src/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'parche.js');
const packs = loadPacks();
const pack = packs.find((p) => p.id === 'arca.wsfe.condicion-iva-receptor');
const js = (source, file = 'src/x.ts', context = emptyContext()) => arca({ source, file, pack, context });
const php = (source, file = 'src/x.php', context = emptyContext()) => arcaPhp({ source, file, pack, context });
const migrated = { ...emptyContext(), fieldFiles: ['src/otro.js'] };
const lib = (name, version, extra = {}) => ({ ...emptyContext(), versions: { npm: { [name]: { version, source: 'package-lock.json', ...extra } }, composer: {}, pypi: {} } });

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-soap-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

// Repo git con identidad propia, para `pr --dry-run`.
function gitRepo(files) {
  const root = tree(files);
  const cfg = path.join(root, '..', `${path.basename(root)}.gitconfig`);
  fs.writeFileSync(cfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of ['GITHUB_ACTIONS', 'GITHUB_TOKEN', 'GITHUB_STEP_SUMMARY', 'PARCHE_GIT_NAME', 'PARCHE_GIT_EMAIL', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete env[k];
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', env });
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'T');
  g('config', 'user.email', 't@example.com');
  g('add', '-A');
  g('commit', '-q', '-m', 'init');
  return { root, env, cleanup: () => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(cfg, { force: true }); } };
}

const SOAP_JS = `const xml = \`<ar:FECAESolicitar><ar:FeCAEReq><ar:FECAEDetRequest>
  <ar:DocTipo>\${d}</ar:DocTipo><ar:ImpTotal>\${t}</ar:ImpTotal>
</ar:FECAEDetRequest></ar:FeCAEReq></ar:FECAESolicitar>\`;
`;

test('punto 26: una mención en un comentario no cuenta (JS, PHP y Python)', () => {
  // El caso de la tabla de comprobantes: nombra FECAESolicitar en la documentación y DocTipo en otro lado.
  assert.deepEqual(js('/**\n * código usado en FECAESolicitar → CbteTipo\n */\nexport const tabla = { DocTipo: 80 };\n').findings, []);
  assert.deepEqual(js('// ver FECAEDetRequest\nexport const a = { ImpTotal: 1 };\n').findings, []);
  assert.deepEqual(php('<?php\n# ver FECAESolicitar\n// y FECAEDetRequest\n$a = [\'DocTipo\' => 80];\n').findings, []);
  assert.deepEqual(soapOnly({ source: '# ver FECAESolicitar\ndet = {"DocTipo": 80}\n', file: 'x.py', context: emptyContext() }).findings, []);
});

test('punto 26: un archivo que solo lee la respuesta no se marca', () => {
  const phpReader = `<?php
if (isset($cae->FECAESolicitarResult->FeCabResp->Resultado)) {
  $r['n'] = $cae->FECAESolicitarResult->FeDetResp->FECAEDetResponse->CbteDesde;
}
`;
  assert.deepEqual(php(phpReader).findings, []);
  const jsReader = 'const n = r.FECAESolicitarResult.FeDetResp.FECAEDetResponse[0].CbteDesde;\nexport const doc = r.FECAESolicitarResult.FeDetResp.FECAEDetResponse[0].DocTipo;\n';
  assert.deepEqual(js(jsReader).findings, []);
});

test('punto 26: se marca donde se arma el pedido, en la línea del código y no en la del comentario', () => {
  const src = `// Llama a FECAESolicitar\n// y arma el FECAEDetRequest\n\n${SOAP_JS}`;
  const { findings } = js(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 4);
  assert.equal(findings[0].status, 'needs-input');
  // Un archivo que no arma nada pero llama a un armador de otro lado, con el repo sin migrar: sale sin el campo.
  const caller = 'const r = await client.FECAESolicitarAsync(req);\nexport const n = r.FECAESolicitarResult.FeDetResp.FECAEDetResponse[0].CbteDesde;\n';
  assert.equal(js(caller).findings.length, 1, 'el repo no menciona el campo: esa llamada sale sin él');
  assert.deepEqual(js(caller, 'src/x.ts', migrated).findings, [], 'el repo ya usa el campo: lo arma otro archivo');
});

test('punto 26: un archivo con el campo solo en un comentario sigue sin el campo', () => {
  const src = `// TODO: agregar CondicionIVAReceptorId\n${SOAP_JS}`;
  assert.equal(js(src).findings.length, 1);
  assert.deepEqual(js(SOAP_JS.replace('<ar:DocTipo>', '<ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId><ar:DocTipo>')).findings, []);
});

test('punto 26: un tipo de TypeScript y una lectura no arman el pedido; un armado en PHP, C# o Java sí', () => {
  const types = 'export interface FECAEDetRequest {\n  DocTipo: number;\n  ImpTotal: number;\n}\nexport type Otro = { MonId: string };\n';
  assert.deepEqual(js(types, 'src/afip-types.ts', migrated).findings, []);
  assert.equal(js(`${types}export const det = { ImpTotal: 1 };\n`, 'src/afip-types.ts', migrated).findings.length, 1);
  assert.deepEqual(js('export const METODO = "FECAESolicitar";\nexport const esCF = (x) => x.DocTipo === 99;\n').findings, []);
  // Un reexport: nombra las claves y no arma nada.
  assert.deepEqual(js("export {\n  FECAEDetRequest,\n  DocTipo,\n  ImpTotal,\n} from './tipos';\nimport { FECAESolicitar, MonId } from './x';\n", 'src/index.ts', migrated).findings, []);
  assert.equal(php("<?php\n$det = array('DocTipo' => 80, 'ImpTotal' => $t);\n$client->FECAESolicitar($det);\n").findings.length, 1);
  assert.equal(soapOnly({ source: 'var d = new FECAEDetRequest { DocTipo = 80, ImpTotal = 1 };\n', file: 'Factura.cs', context: emptyContext() }).findings.length, 1);
  assert.equal(soapOnly({ source: 'FECAEDetRequest d = new FECAEDetRequest();\nd.setDocTipo(80);\nd.setImpTotal(1);\n', file: 'Factura.java', context: emptyContext() }).findings.length, 1);
});

test('stripComments: mismas líneas y columnas, con CRLF y tabs, y sin tocar strings ni XML', () => {
  const src = "\tconst u = 'http://x/FECAESolicitar'; // FECAEDetRequest\r\n/* a\r\n b */ const t = `<a>//no</a>`;\r\n";
  const out = stripComments(src, 'x.js');
  assert.equal(out.length, src.length);
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.match(out, /http:\/\/x\/FECAESolicitar/);
  assert.doesNotMatch(out, /FECAEDetRequest/);
  assert.match(out, /<a>\/\/no<\/a>/);
  assert.match(out, /\r\n/);
  // Una comilla suelta no se come el resto del archivo.
  assert.match(stripComments("const a = <p>Don't</p>;\n// FECAESolicitar\nconst b = 1;\n", 'x.jsx'), /const b = 1/);
  assert.doesNotMatch(stripComments("const a = <p>Don't</p>;\n// FECAESolicitar\n", 'x.jsx'), /FECAESolicitar/);
  // Lenguajes: en Python y PHP, #; en VB.NET, la comilla simple; en Python // es una división.
  assert.equal(stripComments('a = 1 # FECAE\nb = 4 // 2\n', 'x.py').trim(), 'a = 1        \nb = 4 // 2');
  assert.doesNotMatch(stripComments("Dim a = 1 ' FECAE\n", 'x.vb'), /FECAE/);
  assert.match(stripComments('#[Attr]\n$a = 1;\n', 'x.php'), /#\[Attr\]/);
});

test('isTestFile: también en los lenguajes de solo detección y con helpers de tests', () => {
  for (const f of ['wsfev1/client_test.go', 'app/test_cae.py', 'app/cae_test.py', 'dc.Core.Tests/Foo.cs', 'src/FooTests.cs', 'src/FooTest.java', 'src/ToolExecution.test.helpers.ts', 'src/a.spec.helper.js']) {
    assert.ok(isTestFile(f), f);
  }
  for (const f of ['src/latest.cs', 'src/contest.py', 'src/attest_x.py', 'src/contests/a.js', 'src/test_data.js']) assert.ok(!isTestFile(f), f);
});

const NEEDS = { pack: pack.id, file: 'src/factura.js', line: 8, status: 'needs-input', message: 'Falta CondicionIVAReceptorId.' };
const AUTO_TEST = { pack: pack.id, file: 'src/lib/mock-client.test.ts', line: 60, status: 'auto', message: 'Agregado CondicionIVAReceptorId: 5 (Consumidor Final).' };

test('punto 27: un issue no lista como automático lo que caería en un test', () => {
  const body = prBody({ pack, findings: [NEEDS, AUTO_TEST], changed: [], verification: null });
  assert.match(body, /No hay un arreglo automático seguro/);
  assert.doesNotMatch(body, /✅ automático/, 'ni en la lista ni en el resumen del pie');
  assert.match(body, /En tests, mocks o scripts de prueba \(Parche no los toca\): `src\/lib\/mock-client\.test\.ts:60`\./);
  assert.match(body, /`src\/factura\.js:8`/);
});

test('punto 27: si solo aparece en un test, el issue lo dice y no pide nada', () => {
  const body = prBody({ pack, findings: [AUTO_TEST], changed: [], verification: null });
  assert.match(body, /Solo aparece en tests, mocks o scripts de prueba/);
  assert.doesNotMatch(body, /No hay un arreglo automático seguro/);
  assert.doesNotMatch(body, /✅ automático/);
});

test('punto 27: en un PR de verdad, un arreglo en un test se sigue listando', () => {
  const body = prBody({ pack, findings: [AUTO_TEST], changed: [{ file: AUTO_TEST.file }], verification: null });
  assert.match(body, /✅ automático `src\/lib\/mock-client\.test\.ts:60`/);
});

test('punto 27: con `pr`, el resumen del job tampoco lista lo que caería en un test', () => {
  const mock = 'export const f = (afip) => afip.ElectronicBilling.createVoucher({ CbteTipo: 6, DocTipo: 99, DocNro: 0 });\n';
  const { root, env, cleanup } = gitRepo({ 'test/mock-client.js': mock, 'src/factura.js': 'export const g = (afip, d) => afip.ElectronicBilling.createVoucher(d);\n' });
  const summary = path.join(root, '..', `${path.basename(root)}.md`);
  execFileSync('node', [BIN, 'pr', root, '--dry-run', '--pack', pack.id], { encoding: 'utf8', env: { ...env, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary } });
  const job = fs.readFileSync(summary, 'utf8');
  assert.match(job, /src\/factura\.js/);
  assert.doesNotMatch(job, /mock-client/);
  fs.rmSync(summary, { force: true });
  cleanup();
});

test('punto 28: un PR en un repo que ya usa el campo dice dónde y qué cubre', () => {
  const auto = { pack: pack.id, file: 'probar.js', line: 5, status: 'auto', message: 'Agregado.' };
  const changed = [{ file: 'probar.js' }];
  const body = prBody({ pack, findings: [auto], changed, verification: null, context: { fieldFiles: ['src/services/arca.js'] } });
  assert.match(body, /El repo ya usa `CondicionIVAReceptorId` en `src\/services\/arca\.js`.*este PR no toca esos archivos.*Cubre lo que todavía no lo lleva: `probar\.js`/);
  // Sin otro archivo, o si solo está en tests o en un WSDL, o en el archivo que toca este PR: no hay nada que aclarar.
  assert.doesNotMatch(prBody({ pack, findings: [auto], changed, verification: null, context: { fieldFiles: [] } }), /El repo ya usa/);
  assert.doesNotMatch(prBody({ pack, findings: [auto], changed, verification: null, context: { fieldFiles: ['test/a.test.js', 'x/wsfe.wsdl', 'probar.js'] } }), /El repo ya usa/);
  // Muchos archivos: tres y "N más".
  const many = prBody({ pack, findings: [auto], changed, verification: null, context: { fieldFiles: ['a.js', 'b.js', 'c.js', 'd.js', 'e.js'] } });
  assert.match(many, /`a\.js`, `b\.js`, `c\.js` y 2 más/);
  // Un pack sin campo (Mercado Pago) no dice nada.
  const mp = packs.find((p) => p.id === 'mercadopago.payments-to-orders');
  assert.doesNotMatch(prBody({ pack: mp, findings: [], changed, verification: null, context: { fieldFiles: ['a.js'] } }), /El repo ya usa/);
});

test('punto 28: de punta a punta, con `pr --dry-run`', () => {
  // El archivo sin el campo es código (src/caja.js). Si fuera un script de prueba (probar.js), no habría PR: punto 34,
  // en scripts-de-prueba.test.js.
  const { root, env, cleanup } = gitRepo({
    'src/services/arca.js': 'export const a = (x, n) => x.electronicBillingService.createVoucher({ DocTipo: 80, DocNro: n, CondicionIVAReceptorId: 1 });\n',
    'src/caja.js': 'export const b = (x) => x.electronicBillingService.createVoucher({ CbteTipo: 6, DocTipo: 99, DocNro: 0 });\n',
  });
  execFileSync('node', [BIN, 'pr', root, '--dry-run', '--pack', pack.id], { encoding: 'utf8', env });
  const body = fs.readFileSync(path.join(root, '.parche', `pr-${pack.id}.md`), 'utf8');
  assert.match(body, /El repo ya usa `CondicionIVAReceptorId` en `src\/services\/arca\.js`/);
  assert.match(body, /Cubre lo que todavía no lo lleva: `src\/caja\.js`/);
  cleanup();
});

test('fieldFiles: un comentario no cuenta como "ya usa el campo", y el código que corre va primero', () => {
  const files = {
    'src/a.test.js': 'const d = { CondicionIVAReceptorId: 5 };\n',
    'src/b.js': '// TODO: CondicionIVAReceptorId\nexport const b = 1;\n',
    'src/c.js': 'export const c = { CondicionIVAReceptorId: 1 };\n',
  };
  const root = tree(files);
  const { fieldFiles } = buildContext(root, Object.keys(files), { npm: {}, composer: {}, pypi: {} });
  assert.deepEqual(fieldFiles, ['src/c.js', 'src/a.test.js']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('punto 30: @arcasdk/core, según lo publicado en npm: de la 0.2.0 a la 0.3.2 no hay código', () => {
  const travels = (version, extra) => arcaLibraries({ npm: { '@arcasdk/core': { version, source: 'package-lock.json', ...extra } }, composer: {} })[0].travels;
  assert.equal(travels('0.1.0'), 'si', 'la 0.1.0 trae el campo');
  for (const v of ['0.2.0', '0.3.0', '0.3.1', '0.3.2']) assert.equal(travels(v), 'no', v);
  for (const v of ['0.3.3', '0.3.6', '1.3.1', '2.0.2']) assert.equal(travels(v), 'si', v);
  // Sin lockfile manda el rango: una instalación nueva trae la última que entra.
  assert.equal(travels('0.3.0', { source: 'declarada', range: '^0.3.0' }), 'si');
  assert.equal(travels('0.3.2', { source: 'declarada', range: '~0.3.2' }), 'si');
  assert.equal(travels('0.2.0', { source: 'declarada', range: '>=0.2' }), 'si');
  assert.equal(travels('0.2.0', { source: 'declarada', range: '^0.2.0' }), 'no');
  assert.equal(travels('0.3.2', { source: 'declarada', range: '0.3.2' }), 'no');
});

const NOTE = /@arcasdk\/core 0\.3\.2 se publicó en npm sin código.*actualizá a la 0\.3\.3/;
const withVersion = (version) => {
  const ctx = lib('@arcasdk/core', version);
  return { ...ctx, arcaLibs: arcaLibraries(ctx.versions) };
};

test('punto 30: con una versión vacía, el arreglo deja de ser automático y el aviso dice qué hacer', () => {
  const src = 'export const f = (x) => x.electronicBillingService.createVoucher({ CbteTipo: 6, DocTipo: 99, DocNro: 0 });\n';
  const { findings } = js(src, 'src/x.ts', withVersion('0.3.2'));
  assert.equal(findings[0].status, 'needs-review');
  assert.match(findings[0].message, NOTE);
  assert.equal(js(src, 'src/x.ts', withVersion('0.3.3')).findings[0].status, 'auto');
});

test('punto 30: si el comprobante ya lleva el campo y la librería no lo manda, también se avisa', () => {
  const src = 'export const f = (x, c) => x.electronicBillingService.createVoucher({ DocTipo: 80, DocNro: 1, CondicionIVAReceptorId: c });\n';
  const old = js(src, 'src/x.ts', withVersion('0.3.2')).findings;
  assert.equal(old.length, 1);
  assert.equal(old[0].status, 'needs-review');
  assert.match(old[0].message, /ya lleva CondicionIVAReceptorId, pero puede no llegar a ARCA/);
  assert.match(old[0].message, NOTE);
  assert.deepEqual(js(src, 'src/x.ts', withVersion('0.3.3')).findings, []);
  // Sin librería conocida: sin aviso.
  assert.deepEqual(js(src).findings, []);
  // El campo asignado después, también.
  const later = 'export const f = (x, c) => {\n  const d = { DocTipo: 80, DocNro: 1 };\n  d.CondicionIVAReceptorId = c;\n  return x.electronicBillingService.createVoucher(d);\n};\n';
  assert.equal(js(later, 'src/x.ts', withVersion('0.3.2')).findings.length, 1);
});

test('punto 30: la misma regla en PHP, con afip.php 0.x', () => {
  const ctx = { ...emptyContext(), arcaLibs: [{ ecosystem: 'composer', name: 'afipsdk/afip.php', version: '0.7.0', source: 'composer.lock', travels: 'no' }] };
  const lit = "<?php\n$afip->ElectronicBilling->CreateVoucher(['DocTipo' => 80, 'DocNro' => 1, 'CondicionIVAReceptorId' => 1]);\n";
  const later = "<?php\n$d = ['DocTipo' => 80, 'DocNro' => 1];\n$d['CondicionIVAReceptorId'] = $c;\n$afip->ElectronicBilling->CreateVoucher($d);\n";
  for (const src of [lit, later]) {
    const { findings } = php(src, 'src/x.php', ctx);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].status, 'needs-review');
    assert.match(findings[0].message, /ya lleva CondicionIVAReceptorId, pero puede no llegar a ARCA.*WSDL de 2021/);
    assert.deepEqual(php(src).findings, []);
  }
});

test('punto 30: de punta a punta, leyendo el package-lock', () => {
  const root = tree({
    'package.json': JSON.stringify({ dependencies: { '@arcasdk/core': '0.3.2' } }),
    'package-lock.json': JSON.stringify({ packages: { 'node_modules/@arcasdk/core': { version: '0.3.2' } } }),
    'src/a.js': 'export const a = (x, c) => x.electronicBillingService.createVoucher({ DocTipo: 80, DocNro: 1, CondicionIVAReceptorId: c });\n',
  });
  const { findings, context } = run(root, { write: false, packIds: [pack.id] });
  assert.equal(context.arcaLibs[0].travels, 'no');
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, NOTE);
  assert.ok(findings[0].fingerprint);
  fs.rmSync(root, { recursive: true, force: true });
});

test('idempotencia: detectar no cambia el archivo, también con CRLF y tabs', () => {
  const src = "// FECAESolicitar\r\n\texport const d = {\r\n\t\tDocTipo: 80,\r\n\t};\r\n";
  const { output, findings } = js(src);
  assert.equal(output, null);
  assert.deepEqual(findings, []);
  const crlf = `// FECAESolicitar\r\n${SOAP_JS.replaceAll('\n', '\r\n')}`;
  const res = js(crlf);
  assert.equal(res.output, null);
  assert.equal(res.findings[0].line, 2);
});
