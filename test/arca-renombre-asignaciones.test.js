// 0.7.2: lo que pidió el re-escaneo con la 0.7.0 (frente B, 24/10). La clave casi bien escrita en una asignación
// aparte (punto 25: frenaba el PR de un repo real), el renombre que rompía el tipado (punto 23) y los archivos con
// \r sueltos, donde la edición caía en otra línea (punto 22).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import arca from '../src/codemods/arca-wsfe-condicion-iva.js';
import arcaPhp from '../src/codemods/arca-wsfe-condicion-iva-php.js';
import { loadPacks } from '../src/packs.js';
import { emptyContext, nearMissTypes } from '../src/context.js';
import { fileLine } from '../src/ast.js';

const pack = loadPacks().find((p) => p.id === 'arca.wsfe.condicion-iva-receptor');
const js = (source, file = 'lib/afip/caea.ts', context) => arca({ source, file, pack, context });
const php = (source, file = 'src/Caea.php') => arcaPhp({ source, file, pack });
const count = (s, sub) => s.split(sub).length - 1;

// Como en el informe de CAEA de un repo real: el detalle es un objeto literal y la condición se asigna aparte.
const CAEA_TS = [
  'export async function informar(client, cbte, caea) {',
  '  const det: Record<string, unknown> = {',
  '    Concepto: 1,',
  '    DocTipo: cbte.docTipo,',
  '    DocNro: cbte.docNro,',
  '    CbteDesde: cbte.numero,',
  '    CAEA: caea,',
  '  }',
  '  if (cbte.condicionIvaReceptor != null) {',
  '    det.CondicionIVAReceptor = cbte.condicionIvaReceptor',
  '  }',
  '  return client.FECAEARegInformativoAsync({ FeCAEARegInfReq: { FeDetReq: { FECAEADetRequest: det } } })',
  '}',
  '',
].join('\n');

test('punto 25: la clave sin Id en una asignación aparte se renombra, sin tocar el valor', () => {
  const r = js(CAEA_TS);
  assert.match(r.output, /^ {4}det\.CondicionIVAReceptorId = cbte\.condicionIvaReceptor$/m);
  assert.equal(r.output, CAEA_TS.replace('det.CondicionIVAReceptor =', 'det.CondicionIVAReceptorId ='));
  assert.equal(r.findings.length, 1); // sin el aviso genérico de SOAP
  assert.equal(r.findings[0].status, 'needs-review');
  assert.equal(r.findings[0].line, 10);
  assert.match(r.findings[0].message, /`CondicionIVAReceptor` no es un campo de WSFEv1/);
  // Idempotente: la segunda pasada no cambia nada ni vuelve a avisar.
  const again = js(r.output);
  assert.equal(again.output, null);
  assert.equal(again.findings.length, 0);
});

test('punto 25: corchetes con las mismas comillas, CRLF, y nunca en tests', () => {
  const src = CAEA_TS.replace("det.CondicionIVAReceptor = ", 'det["CondicionIvaReceptorId"] = ').replace(/\n/g, '\r\n');
  const r = js(src);
  assert.equal(r.output, src.replace('det["CondicionIvaReceptorId"]', 'det["CondicionIVAReceptorId"]'));
  assert.equal(js(CAEA_TS, 'lib/afip/__tests__/caea.test.ts').output, null);
});

test('punto 25: con ElectronicBilling, el renombre no suma un segundo CondicionIVAReceptorId', () => {
  const src = [
    'export async function emitir(afip, cuit, cond) {',
    '  const data = { CbteTipo: 1, DocTipo: 80, DocNro: cuit, CbteDesde: 1 };',
    '  data.CondicionIVAReceptor = cond;',
    '  return afip.ElectronicBilling.createVoucher(data);',
    '}',
    '',
  ].join('\n');
  const r = js(src, 'src/factura.js');
  assert.equal(count(r.output, 'CondicionIVAReceptorId'), 1);
  assert.match(r.output, /^ {2}data\.CondicionIVAReceptorId = cond;$/m);
  assert.deepEqual(r.findings.map((f) => f.status), ['needs-review']);
});

test('punto 25: si no se puede confirmar que sea el comprobante, avisa sin tocar; un campo propio no se avisa', () => {
  const param = 'export function completar(det, c) {\n  det.CondicionIVAReceptor = c;\n  return det;\n}\n// FECAESolicitar\n';
  const r = js(param, 'src/wsfe.ts');
  assert.equal(r.output, null);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].status, 'needs-review');
  assert.match(r.findings[0].message, /`det\.CondicionIVAReceptor`: si es el detalle del comprobante/);
  assert.match(r.findings[0].message, /no pude confirmar/);
  // Con minúscula es un campo de la app (cliente.condicionIvaReceptor), y sin nada de ARCA en el archivo no hay aviso.
  assert.equal(js('// FECAESolicitar\nexport const f = (cliente) => { cliente.condicionIvaReceptor = 5; };\n', 'src/wsfe.ts').findings.length, 0);
  assert.equal(js('export const f = (fila) => { fila.CondicionIVAReceptor = 5; };\n', 'src/tabla.ts').findings.length, 0);
});

test('punto 25: si el comprobante ya tiene el campo bien escrito, no edita y pide revisar', () => {
  const src = CAEA_TS.replace('    CAEA: caea,', '    CAEA: caea,\n    CondicionIVAReceptorId: 5,');
  const r = js(src);
  assert.equal(r.output, null);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].message, /se puede borrar/);
});

test('punto 25 en PHP: $det[...] = ... se renombra entre las mismas comillas, e idempotente', () => {
  const src = [
    '<?php',
    'function informar($client, $cbte, $caea) {',
    '    $det = [',
    "        'Concepto' => 1,",
    "        'DocTipo' => $cbte->docTipo,",
    "        'DocNro' => $cbte->docNro,",
    "        'CbteDesde' => $cbte->numero,",
    '    ];',
    '    if ($cbte->condicion !== null) {',
    '        $det["CondicionIVAReceptor"] = $cbte->condicion;',
    '    }',
    "    return $client->FECAEARegInformativo(['FeCAEARegInfReq' => ['FeDetReq' => ['FECAEADetRequest' => $det]]]);",
    '}',
    '',
  ].join('\n');
  const r = php(src);
  assert.equal(r.output, src.replace('$det["CondicionIVAReceptor"]', '$det["CondicionIVAReceptorId"]'));
  assert.deepEqual(r.findings.map((f) => [f.status, f.line]), [['needs-review', 10]]);
  assert.equal(php(r.output).output, null);
  assert.equal(php(r.output).findings.length, 0);
  // Un parámetro: no se puede confirmar que sea el comprobante.
  const param = php("<?php\nfunction completar($det, $c) {\n    $det['CondicionIVAReceptor'] = $c;\n    return $det; // FECAESolicitar\n}\n");
  assert.equal(param.output, null);
  assert.match(param.findings[0].message, /no pude confirmar/);
});

test('punto 23: si un tipo del repo declara la clave mal escrita, no renombra y dice dónde está el tipo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-tipos-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'tipos.ts'), [
    'export interface FECAEDetalleRequest {',
    '  DocTipo: number;',
    '  CondicionIvaReceptorId?: number;',
    '}',
    "export type Otro = { 'CondicionIVAReceptor': string };",
    'export const ejemplo = { CondicionIVAReceptorID: 1 };',
    '',
  ].join('\n'));
  const types = nearMissTypes(root, ['src/tipos.ts']);
  assert.deepEqual(types, [
    { file: 'src/tipos.ts', line: 3, key: 'CondicionIvaReceptorId' },
    { file: 'src/tipos.ts', line: 5, key: 'CondicionIVAReceptor' },
  ]); // el objeto de la línea 6 no es un tipo
  const context = { ...emptyContext(), nearMissTypes: types };
  const obj = '// FECAEDetRequest\nexport const req: FECAEDetalleRequest = { DocTipo: 80, DocNro: 1, CondicionIvaReceptorId: c };\n';
  const r = js(obj, 'src/mapeo.ts', context);
  assert.equal(r.output, null);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].status, 'needs-review');
  assert.match(r.findings[0].message, /el tipo de `src\/tipos\.ts:3` declara `CondicionIvaReceptorId`/);
  // La asignación aparte, igual.
  assert.match(js(CAEA_TS, 'lib/afip/caea.ts', context).findings[0].message, /`src\/tipos\.ts:5`/);
  // En JS no hay tipos que se rompan: renombra. Y con otra grafía que ningún tipo declara, también.
  assert.ok(js(obj.replace(': FECAEDetalleRequest', ''), 'src/mapeo.js', context).output.includes('CondicionIVAReceptorId: c'));
  assert.ok(js(obj.replace(/CondicionIvaReceptorId/, 'condicionIVAReceptorId'), 'src/mapeo.ts', context).output.includes('CondicionIVAReceptorId: c'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('punto 22: con \\r sueltos (\\r\\r\\n) no edita; avisa qué hacer a mano, con la línea de git', () => {
  const lines = [
    '// 1. Armar el comprobante',
    'export async function emitir(afip) {',
    '  const data = { CbteTipo: 6, DocTipo: 99, DocNro: 0 };',
    '  return afip.ElectronicBilling.createVoucher(data);',
    '}',
    '',
  ];
  for (const eol of ['\r\r\n', '\r']) {
    const r = js(lines.join(eol), 'src/facturar.js');
    assert.equal(r.output, null, JSON.stringify(eol));
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].status, 'needs-review');
    assert.match(r.findings[0].message, /^No edité este archivo: tiene saltos de línea `\\r` sueltos/);
    assert.match(r.findings[0].message, /Hacelo a mano: agregá `CondicionIVAReceptorId: 5` al comprobante\.$/);
    assert.equal(r.findings[0].line, eol === '\r' ? 1 : 4); // con \r solos, git ve una sola línea
  }
  // El arreglo parcial y el renombre, lo mismo (con DocTipo en una variable puede quedar en "falta un dato": sin editar).
  const partial = js(lines.join('\r\r\n').replace('DocTipo: 99', 'DocTipo: tipo').replace('emitir(afip)', 'emitir(afip, tipo)'), 'src/facturar.js');
  assert.equal(partial.output, null);
  assert.equal(partial.findings[0].partial, undefined);
  const renamed = js(CAEA_TS.replace(/\n/g, '\r\r\n'));
  assert.equal(renamed.output, null);
  assert.match(renamed.findings[0].message, /renombrá `det\.CondicionIVAReceptor` a `det\.CondicionIVAReceptorId`/);
  // Con CRLF normal sigue editando.
  assert.ok(js(lines.join('\r\n'), 'src/facturar.js').output.includes('CondicionIVAReceptorId: 5'));
});

test('fileLine: la línea del parser (que cuenta cada \\r) pasa a la de git', () => {
  assert.equal(fileLine('a\r\r\nb\r\r\nc', 5), 3);
  assert.equal(fileLine('a\nb\nc', 3), 3);
  assert.equal(fileLine('a\r\nb', 2), 2);
});
