// Arreglo parcial "en tiempo de ejecución" de ARCA (punto 7 del frente B): si DocTipo es una variable,
// 99 → 5 se aplica al ejecutarse y con otro DocTipo el pedido sale igual que hoy. El PR sale borrador y dice
// qué casos no cubre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import arca from '../src/codemods/arca-wsfe-condicion-iva.js';
import arcaPhp from '../src/codemods/arca-wsfe-condicion-iva-php.js';
import { loadPacks } from '../src/packs.js';
import { parseCheck } from '../src/ast.js';
import { prBody, scanReport } from '../src/report.js';
import { run } from '../src/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'parche.js');
const pack = loadPacks().find((p) => p.id === 'arca.wsfe.condicion-iva-receptor');
const js = (source, file = 'x.js') => arca({ source, file, pack });
const php = (source, file = 'x.php') => arcaPhp({ source, file, pack });

const EMITIR = 'const emitir = (afip, docTipo) => afip.ElectronicBilling.createVoucher({\n  CbteTipo: 6,\n  DocTipo: docTipo,\n  DocNro: 0,\n  ImpTotal: 121,\n});\n';

test('JS: DocTipo en una variable → 99 → 5 al ejecutarse, debajo de DocNro, y el PR dice qué no cubre', () => {
  const r = js(EMITIR);
  const lines = r.output.split('\n');
  assert.equal(lines[4], '  // parche: 5 = Consumidor Final solo si DocTipo es 99; con otro DocTipo falta la condición frente al IVA del cliente');
  assert.equal(lines[5], '  ...(Number(docTipo) === 99 ? { CondicionIVAReceptorId: 5 } : {}),');
  assert.equal(lines.length - EMITIR.split('\n').length, 2, 'solo dos líneas nuevas');
  const [f] = r.findings;
  assert.equal(f.status, 'needs-review', 'se aplica, pero el PR sale borrador');
  assert.match(f.message, /^Arreglo parcial \(consumidor final\): CondicionIVAReceptorId: 5 solo cuando `docTipo` vale 99/);
  assert.equal(f.partial.covers, 'consumidor final');
  assert.match(f.partial.message, /No cubre los comprobantes con DocTipo distinto de 99 \(CUIT, DNI y otros\).*desde el 1\/12\/2026 ARCA los va a rechazar.*clase B/);
  assert.match(f.partial.suggestion, /valores válidos: 4 \(IVA Sujeto Exento\), 5 \(Consumidor Final\)/);
  // Lo que hace el código generado: con 99 (número o texto) agrega el campo; con otro DocTipo el objeto queda igual que hoy.
  const fake = { ElectronicBilling: { createVoucher: (d) => d } };
  const emitir = new Function(`${r.output}\nreturn emitir;`)();
  assert.equal(emitir(fake, 99).CondicionIVAReceptorId, 5);
  assert.equal(emitir(fake, '99').CondicionIVAReceptorId, 5);
  assert.deepEqual(Object.keys(emitir(fake, 80)), ['CbteTipo', 'DocTipo', 'DocNro', 'ImpTotal'], 'sin la clave, ni siquiera undefined');
  // Idempotente: la segunda vez no cambia nada, pero lo que falta se sigue reportando.
  const again = js(r.output);
  assert.equal(again.output, null);
  assert.equal(again.findings[0].status, 'needs-input');
  assert.match(again.findings[0].message, /^Tiene el arreglo parcial de Parche \(solo DocTipo 99 → 5\)\. No cubre/);
});

test('JS: miembros, casts de TS, objetos en una línea, CRLF, tabs y claves con comillas', () => {
  const ts = js('afip.ElectronicBilling.createVoucher({ CbteTipo: 11, DocTipo: cliente.doc?.tipo as number, DocNro: n });\n', 'x.ts');
  assert.match(ts.output, /DocNro: n, \.\.\.\(Number\(cliente\.doc\?\.tipo as number\) === 99 \? \{ CondicionIVAReceptorId: 5 \} : \{\}\) \/\* parche: .* \*\/ \}\);/);
  parseCheck(ts.output, 'x.ts');
  assert.match(js('afip.ElectronicBilling.createVoucher({ DocTipo: this.datos[\'DocTipo\'], DocNro: 0 });\n').output, /Number\(this\.datos\['DocTipo'\]\) === 99/);
  const crlf = js(EMITIR.replace(/\n {2}/g, '\n\t').replace(/\n/g, '\r\n'));
  assert.ok(crlf.output.includes('\tDocNro: 0,\r\n\t// parche: 5 = Consumidor Final solo si DocTipo es 99'), 'tab y CRLF del archivo');
  assert.ok(crlf.output.includes("\r\n\t...(Number(docTipo) === 99 ? { CondicionIVAReceptorId: 5 } : {}),\r\n"));
  assert.ok(!crlf.output.replace(/\r\n/g, '').includes('\n'), 'ningún LF suelto');
  const quoted = js('afip.ElectronicBilling.createVoucher({\n  "DocTipo": tipo,\n  "DocNro": 0\n});\n');
  assert.match(quoted.output, /"DocNro": 0,\n {2}\/\/ parche: .*\n {2}\.\.\.\(Number\(tipo\) === 99 \? \{ "CondicionIVAReceptorId": 5 \} : \{\}\)\n\}\);/);
  // Las comillas de la clave nueva son las de las claves del objeto, no las del resto del archivo
  // (El-Linaje-Kiosco: claves con ' en un archivo con " en todos lados). Vale también para el arreglo automático.
  const mixed = 'const a = "x";\nconst b = "y";\nconst c = "z";\nafip.ElectronicBilling.createVoucher({\n  \'DocTipo\': DOC,\n  \'DocNro\': 0,\n});\n';
  assert.match(js(mixed).output, /\{ 'CondicionIVAReceptorId': 5 \}/);
  assert.match(js(mixed.replace('DOC', '99')).output, /\n {2}'CondicionIVAReceptorId': 5,\n/);
});

test('JS: lo que el arreglo parcial no toca', () => {
  const untouched = (src, why) => {
    const r = js(src);
    assert.equal(r.output, null, why);
    return r.findings;
  };
  // La expresión no se puede repetir sin efectos.
  untouched('afip.ElectronicBilling.createVoucher({ CbteTipo: 6, DocTipo: tipoDe(cliente), DocNro: 0 });\n', 'una llamada');
  untouched('afip.ElectronicBilling.createVoucher({ CbteTipo: 6, DocTipo: await tipo(), DocNro: 0 });\n', 'un await');
  // Factura A (o una clase conocida que no es B ni C): 99 no aplica, sigue pidiendo el dato.
  const a = untouched('afip.ElectronicBilling.createVoucher({ CbteTipo: 1, DocTipo: docTipo, DocNro: 0 });\n', 'clase A');
  assert.equal(a[0].status, 'needs-input');
  assert.match(a[0].suggestion, /1 \(IVA Responsable Inscripto\)/);
  untouched('afip.ElectronicBilling.createVoucher({ CbteTipo: 51, DocTipo: docTipo, DocNro: 0 });\n', 'clase M');
  // Literal que no es 99 ni DNI: igual que antes.
  assert.equal(untouched('afip.ElectronicBilling.createVoucher({ CbteTipo: 6, DocTipo: 80, DocNro: cuit });\n', 'CUIT')[0].status, 'needs-input');
  // Un condicional completo escrito a mano: está migrado, no hay nada que decir.
  assert.equal(untouched('afip.ElectronicBilling.createVoucher({ DocTipo: d, DocNro: 0, ...(d === 99 ? { CondicionIVAReceptorId: 5 } : { CondicionIVAReceptorId: cond }) });\n', 'completo').length, 0);
  // Otro spread: sigue sin poder leerse.
  assert.match(untouched('afip.ElectronicBilling.createVoucher({ ...base, DocTipo: d, DocNro: 0 });\n', 'spread')[0].message, /usa \.\.\.spread/);
});

const PHP_DATA = "<?php\nclass Ventas {\n    public function emitir($cliente) {\n        $data = array(\n            'CbteTipo' => 6,\n            'DocTipo'  => $cliente->docTipo(),\n            'DocNro'   => $cliente->doc,\n        );\n        return $this->afip->ElectronicBilling->CreateNextVoucher($data);\n    }\n}\n";

test('PHP: $data en una variable → if después del array, sin null, e idempotente', () => {
  const r = php(PHP_DATA, 'src/Ventas.php');
  parseCheck(r.output, 'src/Ventas.php');
  const lines = r.output.split('\n');
  assert.deepEqual(lines.slice(8, 12), [
    '        // parche: 5 = Consumidor Final solo si DocTipo es 99; con otro DocTipo falta la condición frente al IVA del cliente',
    "        if ((int) $data['DocTipo'] === 99) {",
    "            $data['CondicionIVAReceptorId'] = 5;",
    '        }',
  ]);
  assert.equal(lines.length - PHP_DATA.split('\n').length, 4);
  assert.ok(!r.output.includes('null'), 'nunca null: antes del 1/12 podría generar un rechazo nuevo');
  assert.equal(r.findings[0].status, 'needs-review');
  assert.match(r.findings[0].message, /solo cuando `\$data\['DocTipo'\]` vale 99/);
  assert.match(r.findings[0].partial.message, /No cubre .*clase B/);
  const again = php(r.output, 'src/Ventas.php');
  assert.equal(again.output, null, 'idempotente');
  assert.match(again.findings[0].message, /^Tiene el arreglo parcial de Parche/);
  // Tabs y CRLF del archivo, comillas dobles.
  const tabs = php(PHP_DATA.replace(/ {4}/g, '\t').replace(/'/g, '"').replace(/\n/g, '\r\n'));
  assert.ok(tabs.output.includes('\t\t);\r\n\t\t// parche: 5 = Consumidor Final'));
  assert.ok(tabs.output.includes('\r\n\t\tif ((int) $data["DocTipo"] === 99) {\r\n\t\t\t$data["CondicionIVAReceptorId"] = 5;\r\n\t\t}\r\n'));
  // Un if igual escrito a mano también cuenta como parcial; uno con el campo fuera del if, como migrado.
  const hand = "<?php\n$data = ['CbteTipo' => 6, 'DocTipo' => $d, 'DocNro' => 0];\nif ($data['DocTipo'] == 99) { $data['CondicionIVAReceptorId'] = 5; }\n$afip->ElectronicBilling->CreateVoucher($data);\n";
  assert.match(php(hand).findings[0].message, /^Tiene el arreglo parcial/);
  assert.equal(php(hand.replace(/if .*\n/, "$data['CondicionIVAReceptorId'] = $cond;\n")).findings.length, 0);
});

test('PHP: lo que el arreglo parcial no toca', () => {
  const untouched = (src, why) => {
    const r = php(src);
    assert.equal(r.output, null, why);
    assert.equal(r.findings[0].status, 'needs-input', why);
  };
  untouched("<?php\n$afip->ElectronicBilling->CreateVoucher(['CbteTipo' => 6, 'DocTipo' => $d, 'DocNro' => 0]);\n", 'array dentro de la llamada: no hay dónde poner el if');
  untouched("<?php\n$data = ['CbteTipo' => 1, 'DocTipo' => $d, 'DocNro' => 0];\n$afip->ElectronicBilling->CreateVoucher($data);\n", 'factura A');
  untouched("<?php\n$data = ['CbteTipo' => 6, 'DocTipo' => $d, 'DocNro' => 0]; $afip->ElectronicBilling->CreateVoucher($data);\n", 'la asignación no termina la línea');
});

test('el PR parcial: título, borrador y "lo que este PR NO resuelve"', () => {
  const r = js(EMITIR, 'src/emitir.js');
  const body = prBody({ pack, findings: r.findings, changed: [{ file: 'src/emitir.js', packs: [pack.id] }], verification: null });
  assert.match(body, /> \*\*Este PR es parcial \(consumidor final\)\.\*\* Arregla solo esos casos, sin inventar datos/);
  const notSolved = body.slice(body.indexOf('### Lo que este PR NO resuelve'));
  assert.match(notSolved, /✋ falta un dato `src\/emitir\.js:1` — No cubre los comprobantes con DocTipo distinto de 99/);
  assert.match(notSolved, /Agregá: `'CondicionIVAReceptorId': <condición del cliente>/);
  const report = scanReport({ inventory: { repo: 'x', apis: [], unresolved: [] }, findings: r.findings, packs: [pack], changed: [] });
  assert.match(report, /👀 revisar `src\/emitir\.js:1` — Arreglo parcial.*\n {2}- ✋ falta un dato No cubre/);
  // De punta a punta: el título lo dice y el PR iría como borrador.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-parcial-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'emitir.js'), EMITIR);
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  assert.equal(run(root).findings[0].status, 'needs-review');
  const out = execFileSync('node', [BIN, 'pr', root, '--pack', pack.id, '--dry-run'], { encoding: 'utf8' });
  assert.match(out, /■ Parche: .* \(parcial: consumidor final\)/);
  assert.match(out, /iría como borrador/);
  const ledger = fs.readFileSync(path.join(root, '.parche', 'ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(ledger.find((e) => e.type === 'pr').partial, 1);
  fs.rmSync(root, { recursive: true, force: true });
});
