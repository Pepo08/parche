// 0.7.0: clave casi bien escrita (frente B, punto 13), ts-afip-ws en los avisos de librería (punto 14) y los textos
// del cuerpo que no aplicaban a un issue o a un PR sin pendientes (punto 12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import arca from '../src/codemods/arca-wsfe-condicion-iva.js';
import arcaPhp from '../src/codemods/arca-wsfe-condicion-iva-php.js';
import { loadPacks } from '../src/packs.js';
import { arcaLibraries, emptyContext } from '../src/context.js';
import { prBody } from '../src/report.js';

const pack = loadPacks().find((p) => p.id === 'arca.wsfe.condicion-iva-receptor');
const js = (source, file = 'lib/afip/cae.ts', context) => arca({ source, file, pack, context });
const php = (source, file = 'src/Factura.php') => arcaPhp({ source, file, pack });
const count = (s, sub) => s.split(sub).length - 1;

// Como en pablocla/erpia: el detalle se arma a mano y se manda por SOAP con la clave sin "Id".
const SOAP_TS = [
  'export async function solicitarCae(client, cuit, n, condIvaCodigo) {',
  '  const detalle = {',
  '    Concepto: 1,',
  '    DocTipo: 80,',
  '    DocNro: cuit,',
  '    CbteDesde: n,',
  '    CbteHasta: n,',
  '    CondicionIVAReceptor: condIvaCodigo,',
  '  };',
  '  return client.FECAESolicitarAsync({ FeCAEReq: { FeDetReq: { FECAEDetRequest: [detalle] } } });',
  '}',
  '',
].join('\n');

test('punto 13: la clave sin Id se renombra en el detalle del comprobante, sin tocar el valor', () => {
  const r = js(SOAP_TS);
  assert.match(r.output, /^ {4}CondicionIVAReceptorId: condIvaCodigo,$/m);
  assert.doesNotMatch(r.output, /CondicionIVAReceptor:/);
  assert.equal(r.findings.length, 1); // sin el aviso genérico de "SOAP sin CondicionIVAReceptorId"
  assert.equal(r.findings[0].status, 'needs-review');
  assert.equal(r.findings[0].line, 8);
  assert.match(r.findings[0].message, /`CondicionIVAReceptor` no es un campo de WSFEv1/);
  assert.match(r.findings[0].message, /desde el 1\/12\/2026/);
  // Idempotente: la segunda pasada no cambia nada ni vuelve a avisar.
  const again = js(r.output);
  assert.equal(again.output, null);
  assert.equal(again.findings.length, 0);
});

test('punto 13: otras grafías, comillas y la forma abreviada', () => {
  const cases = [
    ["{ DocTipo: 80, DocNro: n, 'CondicionIvaReceptorId': c }", "'CondicionIVAReceptorId': c"],
    ['{ DocTipo: 80, DocNro: n, "condicionIVAReceptorId": c }', '"CondicionIVAReceptorId": c'],
    ['{ CbteDesde: 1, CbteHasta: 1, CondicionIVAReceptorID: c }', 'CondicionIVAReceptorId: c'],
    ['{ DocTipo: 80, ImpTotal: t, CondicionIVAReceptor }', 'CondicionIVAReceptorId: CondicionIVAReceptor'],
  ];
  for (const [obj, expected] of cases) {
    const r = js(`// FECAEDetRequest\nexport const d = (n, c, t, CondicionIVAReceptor) => (${obj});\n`);
    assert.ok(r.output?.includes(expected), `${obj} → ${r.output}`);
  }
});

test('punto 13: no toca modelos ni DTOs propios que se llaman parecido', () => {
  const dto = 'export const cliente = { nombre: "x", condicionIvaReceptorId: 5, cuit: "20-1" };\nexport const fila = { CondicionIVAReceptor: 5 };\n';
  const r = js(dto, 'src/clientes.ts');
  assert.equal(r.output, null);
  assert.equal(r.findings.length, 0);
});

test('punto 13: si el comprobante ya tiene las dos claves, no edita y pide revisar', () => {
  const r = js('// FECAEDetRequest\nexport const d = { DocTipo: 80, DocNro: 1, CondicionIVAReceptor: 1, CondicionIVAReceptorId: 1 };\n');
  assert.equal(r.output, null);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].status, 'needs-review');
  assert.match(r.findings[0].message, /se puede borrar/);
});

test('punto 13: con ElectronicBilling, el renombre no suma un segundo CondicionIVAReceptorId', () => {
  const src = 'export const f = (afip) => afip.ElectronicBilling.createVoucher({\n  CbteTipo: 6,\n  DocTipo: 99,\n  DocNro: 0,\n  CondicionIVAReceptor: 5,\n});\n';
  const r = js(src, 'src/factura.js');
  assert.equal(count(r.output, 'CondicionIVAReceptorId'), 1);
  assert.match(r.output, /^ {2}CondicionIVAReceptorId: 5,$/m);
  assert.deepEqual(r.findings.map((f) => f.status), ['needs-review']);
});

test('punto 13: respeta CRLF y tabs, y no edita tests', () => {
  const src = '// FECAEDetRequest\r\nexport const d = {\r\n\tDocTipo: 80,\r\n\tDocNro: 1,\r\n\tCondicionIVAReceptor: c,\r\n};\r\n';
  const r = js(src);
  assert.equal(r.output, src.replace('CondicionIVAReceptor:', 'CondicionIVAReceptorId:'));
  assert.equal(js(src, 'test/cae.test.ts').output, null);
});

test('punto 13 en PHP: renombra la clave entre las mismas comillas y la llamada no recibe otro campo', () => {
  const src = "<?php\n$det = [\n    'Concepto' => 1,\n    'DocTipo' => 80,\n    'DocNro' => $cuit,\n    'CondicionIVAReceptor' => $cond,\n];\n$afip->ElectronicBilling->CreateVoucher($det);\n";
  const r = php(src);
  assert.equal(r.output, src.replace("'CondicionIVAReceptor'", "'CondicionIVAReceptorId'"));
  assert.deepEqual(r.findings.map((f) => f.status), ['needs-review']);
  assert.equal(r.findings[0].line, 6);
  assert.equal(php(r.output).output, null); // idempotente

  const doubles = '<?php\n$d = ["DocTipo" => 80, "CbteDesde" => 1, "CondicionIvaReceptorId" => $c];\n';
  assert.equal(php(doubles).output, doubles.replace('"CondicionIvaReceptorId"', '"CondicionIVAReceptorId"'));

  const dto = "<?php\n$cliente = ['nombre' => 'x', 'condicion_iva_receptor' => 5];\n";
  assert.equal(php(dto).output, null);
  assert.equal(php(dto).findings.length, 0);
});

test('@arcasdk/core: arca.electronicBillingService recibe el mismo arreglo que afip.js', () => {
  const src = 'export const f = (arca) => arca.electronicBillingService.createNextVoucher({\n  PtoVta: 1,\n  CbteTipo: 6,\n  DocTipo: 99,\n  DocNro: 0,\n});\n';
  const r = js(src, 'src/arca.ts');
  assert.match(r.output, /^ {2}CondicionIVAReceptorId: 5,$/m);
  assert.equal(r.findings[0].status, 'auto');
  assert.deepEqual(r.usages.map((u) => u.op), ['electronicBillingService.createNextVoucher']);
  assert.equal(js(r.output, 'src/arca.ts').output, null); // idempotente
});

test('punto 14: con ts-afip-ws el aviso de librería también llega a lo que pide un dato', () => {
  const context = { ...emptyContext(), arcaLibs: arcaLibraries({ npm: { 'ts-afip-ws': { version: '1.2.0', source: 'package-lock.json' } }, composer: {}, pypi: {} }) };
  assert.equal(context.arcaLibs[0].travels, 'sin-confirmar');
  const src = 'export const f = (afip, docTipo) => afip.ElectronicBilling.createVoucher({ CbteTipo: 1, DocTipo: 80, DocNro: 1 });\n';
  const r = js(src, 'src/factura.js', context);
  assert.equal(r.findings[0].status, 'needs-input');
  assert.match(r.findings[0].message, /con ts-afip-ws 1\.2\.0 el pedido se arma con un WSDL de 2021/);
  assert.match(r.findings[0].message, /pasar a @afipsdk\/afip\.js 1\.x o actualizar el WSDL/);
  // Como en los repos de jretondo: los datos llegan de afuera y el aviso de librería tiene que estar igual.
  const outside = js('export const f = (afip, data) => afip.ElectronicBilling.createVoucher(data);\n', 'src/AfipClass.ts', context);
  assert.match(outside.findings[0].message, /desde afuera de esta función.*con ts-afip-ws 1\.2\.0/s);
});

test('punto 12: el pie de un issue no habla de "este PR" y el checklist de CUIT va solo si queda algo pendiente', () => {
  const issue = prBody({ pack, findings: [{ pack: pack.id, file: 'a.js', line: 1, status: 'needs-input', message: 'falta' }], changed: [] });
  assert.match(issue, /¿Te sirvió este aviso\?/);
  assert.doesNotMatch(issue, /¿Este PR te sirvió\?/);
  assert.match(issue, /cada cliente con CUIT/);

  const allFixed = prBody({ pack, findings: [{ pack: pack.id, file: 'a.js', line: 1, status: 'auto', message: 'ok' }], changed: [{ file: 'a.js', packs: [pack.id] }] });
  assert.match(allFixed, /¿Este PR te sirvió\?/);
  assert.doesNotMatch(allFixed, /cada cliente con CUIT/);
});
