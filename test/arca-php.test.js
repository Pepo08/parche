// Pack ARCA para PHP (afipsdk/afip.php y forks): codemod, motor y verificación.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import arcaPhp from '../src/codemods/arca-wsfe-condicion-iva-php.js';
import { loadPacks } from '../src/packs.js';
import { run } from '../src/engine.js';
import { parseCheck } from '../src/ast.js';
import { testCommands } from '../src/verify.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EX = path.join(HERE, '..', 'examples', 'tienda-php');
const pack = loadPacks().find((p) => p.id === 'arca.wsfe.condicion-iva-receptor');
const src = (f) => fs.readFileSync(path.join(EX, f), 'utf8').replace(/\r\n/g, '\n');
const php = (source, file = 'x.php') => arcaPhp({ source, file, pack });
// Envuelve un array de datos en una llamada real de afip.php.
const call = (arr, method = 'CreateNextVoucher') => `<?php\n$afip->ElectronicBilling->${method}(${arr});\n`;
const addedLines = (before, after) => after.split('\n').filter((l) => !before.split('\n').includes(l));

test('PHP: consumidor final se arregla solo, DNI queda para revisar, Factura A y datos de afuera piden el dato', () => {
  const source = src('src/Facturacion.php');
  const r = php(source, 'src/Facturacion.php');
  parseCheck(r.output, 'src/Facturacion.php');
  assert.deepEqual(r.findings.map((f) => f.status), ['auto', 'needs-review', 'needs-input', 'needs-input']);
  assert.match(r.findings[2].suggestion, /'CondicionIVAReceptorId' => <condición del cliente>, .*1 \(IVA Responsable Inscripto\), 6 .*13 .*16/);
  assert.match(r.findings[3].message, /\$comprobante no se define en esta función/);
  assert.deepEqual(r.usages.map((u) => u.op), ['ElectronicBilling->CreateNextVoucher', 'ElectronicBilling->CreateVoucher',
    'ElectronicBilling->CreateNextVoucher', 'ElectronicBilling->CreateNextVoucher']);
  // Diff mínimo: 2 inserciones de 2 líneas, nada más cambia, y cada una va justo debajo de DocNro.
  const before = source.split('\n');
  const after = r.output.split('\n');
  assert.equal(after.length - before.length, 4);
  assert.ok(before.every((l) => after.includes(l)), 'solo se agregan líneas');
  assert.equal(after[after.indexOf("            'DocNro'     => 0,") + 1], '            // parche: 5 = Consumidor Final (DocTipo 99, sin identificar)');
  assert.equal(after[after.indexOf("            'DocNro' => $dni,") + 2], "            'CondicionIVAReceptorId' => 5,");
  assert.match(r.output, /DNI \+ comprobante B\) — REVISAR/);
  assert.equal(php(r.output, 'src/Facturacion.php').output, null, 'idempotente');
});

test('PHP: array() en una sola línea y método en minúsculas (PHP no distingue mayúsculas)', () => {
  const source = src('scripts/mostrador.php');
  const r = php(source, 'scripts/mostrador.php');
  parseCheck(r.output, 'scripts/mostrador.php');
  assert.equal(r.findings[0].status, 'auto');
  assert.equal(r.usages[0].op, 'ElectronicBilling->CreateNextVoucher', 'el inventario usa el nombre oficial');
  assert.match(r.output, /'DocNro' => 0, 'CondicionIVAReceptorId' => 5 \/\* parche: 5 = Consumidor Final .* \*\/, 'CbteFch'/);
  assert.equal(r.output.split('\n').length, source.split('\n').length);
  assert.equal(php(r.output).output, null, 'idempotente');
});

test('PHP: tabs y CRLF (offsets exactos, sin mezclar fines de línea)', () => {
  const tabs = src('src/Facturacion.php').replace(/^(?: {4})+/gm, (s) => '\t'.repeat(s.length / 4));
  for (const source of [tabs, tabs.replace(/\n/g, '\r\n')]) {
    const crlf = source.includes('\r\n');
    const r = php(source, 'src/Facturacion.php');
    parseCheck(r.output, 'src/Facturacion.php');
    assert.equal((r.output.match(/\n\t\t\t'CondicionIVAReceptorId' => 5,\r?\n/g) || []).length, 2);
    assert.equal((r.output.match(/\n\t\t\t\/\/ parche: /g) || []).length, 2);
    const before = source.split('\n');
    const after = r.output.split('\n');
    assert.equal(after.length - before.length, 4);
    assert.ok(before.every((l) => after.includes(l)), 'solo se agregan líneas');
    assert.ok(after.slice(0, -1).every((l) => l.endsWith('\r') === crlf), 'no mezcla fines de línea');
  }
});

test('PHP: $data en el mismo scope sí; en otro scope, reasignada o completada en pasos, no', () => {
  const fn = (body) => `<?php\nfunction f($afip) {\n${body}\n}\n`;
  const arr = "array('CbteTipo' => 6, 'DocTipo' => 99, 'DocNro' => 0)";
  // Misma función: se arregla.
  assert.equal(php(fn(`    $data = ${arr};\n    return $afip->ElectronicBilling->CreateNextVoucher($data);`)).findings[0].status, 'auto');
  // Definida en otra función: no se adivina.
  const otra = `<?php\n$data = ${arr};\nfunction f($afip, $data) {\n    return $afip->ElectronicBilling->CreateNextVoucher($data);\n}\n`;
  assert.match(php(otra).findings[0].message, /\$data no se define en esta función/);
  // Closure: tampoco cruza el límite (necesitaría `use`).
  const closure = `<?php\n$data = ${arr};\n$emitir = function ($afip) use ($data) {\n    return $afip->ElectronicBilling->CreateNextVoucher($data);\n};\n`;
  assert.equal(php(closure).findings[0].status, 'needs-input');
  // Reasignada o con DocTipo cambiado después: needs-input.
  assert.match(php(fn(`    $data = ${arr};\n    if ($x) { $data = []; }\n    $afip->ElectronicBilling->CreateNextVoucher($data);`)).findings[0].message, /más de una vez/);
  assert.match(php(fn(`    $data = ${arr};\n    $data['DocTipo'] = 96;\n    $afip->ElectronicBilling->CreateNextVoucher($data);`)).findings[0].message, /varios pasos/);
  // Otras claves agregadas después no cambian la decisión.
  assert.equal(php(fn(`    $data = ${arr};\n    $data['Iva'] = array();\n    $afip->ElectronicBilling->CreateNextVoucher($data);`)).findings[0].status, 'auto');
  // Ya migrado (en el literal o agregado después): no se toca.
  for (const body of [
    `    $data = array('DocTipo' => 99, 'DocNro' => 0, 'CondicionIVAReceptorId' => 5);\n    $afip->ElectronicBilling->CreateNextVoucher($data);`,
    `    $data = ${arr};\n    $data['CondicionIVAReceptorId'] = 5;\n    $afip->ElectronicBilling->CreateNextVoucher($data);`,
  ]) {
    const r = php(fn(body));
    assert.equal(r.output, null);
    assert.equal(r.findings.length, 0);
  }
});

test('PHP: copia el estilo del array (comillas dobles, => alineados, coma final)', () => {
  // Comillas dobles.
  const dq = php(call('[\n    "DocTipo" => 99,\n    "DocNro" => 0,\n]'));
  assert.match(dq.output, /\n {4}"CondicionIVAReceptorId" => 5,\n/);
  // => alineados con espacios: la línea nueva se alinea si entra.
  const pad = ' '.repeat(10);
  const aligned = php(call(`array(\n    'DocTipo'${pad}${' '.repeat(18)}=> 99,\n    'DocNro'${pad}${' '.repeat(19)}=> 0,\n)`));
  const arrowCol = (line) => line.indexOf('=>');
  const lines = aligned.output.split('\n');
  assert.equal(arrowCol(lines.find((l) => l.includes('CondicionIVAReceptorId'))), arrowCol(lines.find((l) => l.includes("'DocNro'"))));
  // Último elemento sin coma final: el ancla gana la coma y la línea nueva queda sin coma.
  const noTrailing = php(call("array(\n    'DocTipo' => 99,\n    'DocNro' => 0\n)"));
  parseCheck(noTrailing.output, 'x.php');
  assert.match(noTrailing.output, /'DocNro' => 0,\n {4}\/\/ parche: .*\n {4}'CondicionIVAReceptorId' => 5\n\)/);
  // Con coma final: la nueva también la lleva.
  assert.match(php(call("array(\n    'DocTipo' => 99,\n    'DocNro' => 0,\n)")).output, /'CondicionIVAReceptorId' => 5,\n\)/);
  // Comentario al final de la línea del ancla: se inserta abajo, no en medio.
  const comment = php(call("array(\n    'DocTipo' => 99,\n    'DocNro' => 0, // sin identificar\n    'ImpTotal' => 100,\n)"));
  assert.match(comment.output, /'DocNro' => 0, \/\/ sin identificar\n {4}\/\/ parche: .*\n {4}'CondicionIVAReceptorId' => 5,\n {4}'ImpTotal'/);
});

test('PHP: lo que no se puede leer se reporta y no se toca', () => {
  // Spread y valores no literales.
  assert.equal(php(call("[...$base, 'DocNro' => 0]")).findings[0].status, 'needs-input');
  const constante = php(call("['DocTipo' => self::DOC_TIPO, 'CbteTipo' => 6, 'DocNro' => 0]"));
  assert.equal(constante.output, null);
  assert.equal(constante.findings[0].status, 'needs-input');
  // Un archivo que php-parser no puede leer y tiene llamadas de ARCA: aviso, sin romper.
  const roto = php("<?php\n$afip->ElectronicBilling->CreateVoucher(array('DocTipo' => 99\n");
  assert.equal(roto.output, null);
  assert.match(roto.findings[0].message, /No pude analizar este archivo PHP/);
  // Integración SOAP propia: solo detección.
  const soap = php("<?php\n$client->__soapCall('FECAESolicitar', $params);\n");
  assert.match(soap.findings[0].message, /Integración SOAP propia/);
  assert.throws(() => parseCheck('<?php function (', 'x.php'));
});

test('motor: escanea PHP, lee composer.json y saltea vendor/', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-php-'));
  fs.cpSync(EX, tmp, { recursive: true });
  // La propia librería instalada por composer no se toca.
  const lib = path.join(tmp, 'vendor', 'afipsdk', 'afip.php', 'src');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'Ejemplo.php'), call("array('DocTipo' => 99, 'DocNro' => 0)"));
  const first = run(tmp, { write: true });
  assert.deepEqual(first.changed.map((c) => c.file), ['scripts/mostrador.php', 'src/Facturacion.php']);
  assert.equal(first.inventory.packages['afipsdk/afip.php'], '^1.2');
  assert.ok(first.findings.every((f) => !f.file.startsWith('vendor/')));
  for (const c of first.changed) parseCheck(fs.readFileSync(path.join(tmp, c.file), 'utf8'), c.file);
  assert.equal(run(tmp, { write: true }).changed.length, 0, 'la segunda corrida no cambia nada');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('verify: elige los tests según el lenguaje de lo que cambió', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-verify-'));
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), text); };
  const labels = (files) => testCommands(tmp, files).map((c) => c.label);
  assert.deepEqual(labels(['src/a.php']), [], 'sin tests: queda el chequeo de sintaxis');
  write('vendor/bin/phpunit', '#!/usr/bin/env php\n');
  assert.deepEqual(labels(['src/a.php']), ['vendor/bin/phpunit']);
  write('composer.json', JSON.stringify({ scripts: { test: 'phpunit' } }));
  assert.deepEqual(labels(['src/a.php']), ['composer test'], 'composer test tiene prioridad');
  write('package.json', JSON.stringify({ scripts: { test: 'node --test' } }));
  assert.deepEqual(labels(['src/a.php']), ['composer test'], 'un cambio en PHP no corre npm test');
  assert.deepEqual(labels(['src/a.js', 'src/a.php']), ['npm test', 'composer test']);
  fs.rmSync(tmp, { recursive: true, force: true });
});
