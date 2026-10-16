// Casos reales que encontró el frente de tracción al correr Parche sobre 175 repos públicos (16/10/2026).
// Cada test corresponde a un punto de startup/traccion/feedback-producto.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import arca from '../src/codemods/arca-wsfe-condicion-iva.js';
import arcaPhp from '../src/codemods/arca-wsfe-condicion-iva-php.js';
import ai from '../src/detectors/ai-model-retirements.js';
import { loadPacks } from '../src/packs.js';
import { run } from '../src/engine.js';
import { isTestFile } from '../src/paths.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'parche.js');
const packs = Object.fromEntries(loadPacks().map((p) => [p.id, p]));
const ARCA = packs['arca.wsfe.condicion-iva-receptor'];
const AI = packs['ai.model-retirements'];
const js = (source, file = 'x.js', context) => arca({ source, file, pack: ARCA, context });

function repo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-fb-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  return { root, g };
}
const VOUCHER = "export const emitir = (afip) => afip.ElectronicBilling.createVoucher({\n  CbteTipo: 6,\n  DocTipo: 99,\n  DocNro: 0,\n});\n";

test('punto 3: si la verificación falla, el repo queda limpio y sin la rama de Parche', () => {
  const { root, g } = repo({ 'src/f.js': VOUCHER, 'package.json': JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }) });
  const r = spawnSync('node', [BIN, 'pr', root, '--pack', ARCA.id, '--dry-run', '--verify'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /La verificación falló/);
  assert.equal(g('status', '--porcelain').trim(), '', 'sin archivos modificados');
  assert.equal(g('branch', '--list', 'parche/*').trim(), '', 'sin rama de Parche');
  assert.equal(g('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
  fs.rmSync(root, { recursive: true, force: true });
});

test('punto 11: si solo cambiarían tests o mocks, no se abre PR ni queda rama', () => {
  const { root, g } = repo({ 'test/mock-afip.test.js': VOUCHER });
  const out = execFileSync('node', [BIN, 'pr', root, '--pack', ARCA.id, '--dry-run'], { encoding: 'utf8' });
  assert.match(out, /Solo cambiaría tests o mocks: no se abre un PR/);
  assert.equal(g('branch', '--list', 'parche/*').trim(), '');
  assert.equal(g('status', '--porcelain').trim(), '');
  for (const f of ['test/x.js', 'src/__mocks__/afip.js', 'a.spec.ts', 'lib/mock-client.test.ts', 'tests/FacturaTest.php', 'examples/demo.js']) assert.ok(isTestFile(f), f);
  for (const f of ['src/testimonios.js', 'src/afip.service.ts']) assert.ok(!isTestFile(f), f);
  fs.rmSync(root, { recursive: true, force: true });
});

test('punto 4: con afip.js/afip.php 0.x o un WSDL viejo, el arreglo deja de ser automático y lo dice', () => {
  // afip.php 0.x en composer.lock: el WSDL de 2021 no tiene el campo.
  const php = repo({
    'composer.json': JSON.stringify({ require: { 'afipsdk/afip.php': '^0.7' } }),
    'composer.lock': JSON.stringify({ packages: [{ name: 'afipsdk/afip.php', version: 'v0.7.4' }] }),
    'src/f.php': "<?php\n$afip->ElectronicBilling->CreateVoucher(array(\n    'CbteTipo' => 6,\n    'DocTipo' => 99,\n    'DocNro' => 0,\n));\n",
  });
  const fp = run(php.root).findings.find((f) => f.file === 'src/f.php');
  assert.equal(fp.status, 'needs-review');
  assert.match(fp.message, /afipsdk\/afip\.php 0\.7\.4 el pedido se arma con un WSDL de 2021/);
  // afip.js 0.x en package-lock: lo mismo, "falta confirmarlo" en JS.
  const jsRepo = repo({
    'package.json': JSON.stringify({ dependencies: { '@afipsdk/afip.js': '^0.7.0' } }),
    'package-lock.json': JSON.stringify({ packages: { 'node_modules/@afipsdk/afip.js': { version: '0.7.4' } } }),
    'src/f.js': VOUCHER,
  });
  const fj = run(jsRepo.root).findings.find((f) => f.file === 'src/f.js');
  assert.equal(fj.status, 'needs-review');
  assert.match(fj.message, /en JS falta confirmarlo/);
  // 1.x o el fork fertandil87 (WSDL actualizado): sigue automático.
  const ok = repo({ 'package.json': JSON.stringify({ dependencies: { '@afipsdk/afip.js': '^1.2.2' } }), 'src/f.js': VOUCHER });
  assert.equal(run(ok.root).findings.find((f) => f.file === 'src/f.js').status, 'auto');
  // Un WSDL de WSFEv1 sin el campo en el repo: se avisa y el arreglo pasa a revisar.
  const wsdl = repo({ 'wsdl/wsfe.wsdl': '<definitions><element name="FECAEDetRequest"><DocTipo/></element></definitions>', 'src/f.js': VOUCHER });
  const fw = run(wsdl.root).findings;
  assert.match(fw.find((f) => f.file === 'wsdl/wsfe.wsdl').message, /WSDL de WSFEv1 sin CondicionIVAReceptorId/);
  assert.equal(fw.find((f) => f.file === 'src/f.js').status, 'needs-review');
  for (const r of [php, jsRepo, ok, wsdl]) fs.rmSync(r.root, { recursive: true, force: true });
});

test('punto 5: casts de TS, alias y archivos que no parsean', () => {
  const base = "  CbteTipo: 6,\n  DocTipo: 99,\n  DocNro: 0,\n";
  assert.equal(js(`(afip.ElectronicBilling as any).createNextVoucher({\n${base}});\n`, 'x.ts').findings[0].status, 'auto');
  assert.equal(js(`afip.ElectronicBilling!.createVoucher({\n${base}});\n`, 'x.ts').findings[0].status, 'auto');
  assert.equal(js(`const eb = afip.ElectronicBilling;\neb.createVoucher({\n${base}});\n`).findings[0].status, 'auto');
  assert.equal(js('const otra = afip.Otra;\notra.createVoucher({ DocTipo: 99, DocNro: 0 });\n').findings.length, 0, 'un alias de otra cosa no cuenta');
  const roto = js('afip.ElectronicBilling.createVoucher({ DocTipo: 99,, }\n');
  assert.match(roto.findings[0].message, /No pude analizar este archivo/);
  assert.equal(js('const x = 1 +;\n').findings.length, 0, 'sin ARCA, ni se parsea (prefiltro)');
});

test('punto 6: menos ruido en SOAP y en lo que no se puede leer cuando el repo ya migró', () => {
  const soapFile = "const det = { DocTipo: 80, DocNro: cuit };\nclient.FECAESolicitar({ FeCAEReq: { FeDetReq: det } });\n";
  assert.equal(js(soapFile, 'src/wsfe.js').findings[0].status, 'needs-input');
  assert.equal(js(soapFile, 'test/wsfe.test.js').findings.length, 0, 'tests');
  assert.equal(js(soapFile, 'src/types.d.ts').findings.length, 0, 'tipos');
  assert.equal(js("export const METODO = 'FECAESolicitar';\n", 'src/const.js').findings.length, 0, 'solo nombra el método');
  assert.equal(js(`class ElectronicBilling extends AfipWebService {}\n${soapFile}`, 'lib/afip/ElectronicBilling.js').findings.length, 0, 'copia de la librería');
  // Repo que ya usa el campo en otro archivo: "revisar" en vez de "falta un dato".
  const context = { versions: { npm: {}, composer: {} }, fieldFiles: ['src/builder.js'], staleWsdl: [], arcaLibs: [] };
  const f = js('const p = armar(x);\nafip.ElectronicBilling.createVoucher(p);\n', 'src/f.js', context).findings[0];
  assert.equal(f.status, 'needs-review');
  assert.match(f.message, /^El repo ya usa CondicionIVAReceptorId \(en `src\/builder\.js`\)/);
  // Otros lenguajes: cliente SOAP generado en C#.
  const cs = repo({ 'Service References/Wsfe/Reference.cs': 'public partial class FECAEDetRequest { public int DocTipo; }\n// FECAESolicitar\n' });
  assert.match(run(cs.root).findings[0].message, /Cliente SOAP de WSFEv1 generado/);
  fs.rmSync(cs.root, { recursive: true, force: true });
});

test('punto 9: pack de IA con fechas oficiales, reemplazos, menciones y Azure', () => {
  const find = (src, file = 'x.js') => ai({ source: src, file, pack: AI, today: '2026-10-16' }).findings;
  const call = find("const r = await client.messages.create({ model: 'claude-sonnet-4-5-20250929' });");
  assert.match(call[0].message, /se retira el 2026-11-30\. Reemplazo recomendado: `claude-sonnet-5-5`/);
  assert.match(find("openai.chat.completions.create({ model: 'gpt-3.5-turbo' })")[0].message, /se retira el 2026-10-23/);
  assert.match(find("model: 'dall-e-3',")[0].message, /fue retirado el 2026-05-12: las llamadas ya fallan/);
  const mention = find("const PRECIOS = { 'gpt-4': 30, 'gpt-4o': 5 };");
  assert.equal(mention.length, 1, 'gpt-4o no está retirado; gpt-4 sí');
  assert.match(mention[0].message, /fuera de una llamada: si es una lista o un catálogo/);
  assert.match(find("const c = new AzureOpenAI({}); await c.beta.assistants.create({});")[0].message, /En Azure OpenAI sigue su propio calendario/);
  assert.match(find('await openai.beta.assistants.create({});')[0].message, /cerrada el 2026-08-26/);
});
