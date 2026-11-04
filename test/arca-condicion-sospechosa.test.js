// 0.8.2: la condición frente al IVA sospechosa (punto 29 del feedback). Solo detección: nunca toca código ni sugiere un valor.
// Fixtures inventados, sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import arca from '../src/codemods/arca-wsfe-condicion-iva.js';
import arcaPhp from '../src/codemods/arca-wsfe-condicion-iva-php.js';
import { conditionNamed, isConditionName, safely } from '../src/codemods/arca-condition-rules.js';
import { emptyContext } from '../src/context.js';
import { run } from '../src/engine.js';
import { loadPacks } from '../src/packs.js';
import { prBody, scanReport } from '../src/report.js';
import { weeklyData } from '../src/summary/weekly.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'parche.js');
const packs = loadPacks();
const pack = packs.find((p) => p.id === 'arca.wsfe.condicion-iva-receptor');
const ctx = { ...emptyContext(), arcaRepo: true, usesField: true, mentions: () => true };
const js = (source, file = 'src/x.ts', context = ctx) => arca({ source, file, pack, context });
const php = (source, file = 'src/x.php', context = ctx) => arcaPhp({ source, file, pack, context });
const notices = (r) => r.findings.filter((f) => f.status === 'detect-only');
const rules = (r) => notices(r).map((f) => f.rule);

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-cond-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

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
  return { root, env, g, cleanup: () => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(cfg, { force: true }); } };
}

// Un comprobante con el valor que se pruebe; DocTipo variable, salvo que se pase otro.
const det = (value, doc = 'd.doc') => `x.electronicBillingService.createVoucher({ CbteTipo: d.tipo, DocTipo: ${doc}, DocNro: d.nro, CondicionIVAReceptorId: ${value} });\n`;

test('la tabla del pack es la del anexo de los dos manuales de ARCA (leídos el 4/11/2026)', () => {
  assert.deepEqual(Object.keys(pack.codes).map(Number), [1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16]);
  assert.equal(pack.codes['1'], 'IVA Responsable Inscripto');
  assert.equal(pack.codes['4'], 'IVA Sujeto Exento');
  assert.equal(pack.codes['5'], 'Consumidor Final');
  assert.equal(pack.codes['6'], 'Responsable Monotributo');
  assert.equal(pack.codes['13'], 'Monotributista Social');
  assert.equal(pack.codes['16'], 'Monotributo Trabajador Independiente Promovido');
  assert.deepEqual(pack.codes_by_class, { A: [1, 6, 13, 16], B: [4, 5, 7, 8, 9, 10, 15], C: [1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16] });
  assert.match(pack.codes_source_es, /v4\.7.*v4\.8/);
  assert.equal(pack.last_verified, '2026-11-04');
});

test('ternario con un solo código para "tiene CUIT": se avisa con los códigos, sin decir cuál es el correcto', () => {
  const r = js(`const c = d.cuit ? 1 : 5;\n${det('c')}`);
  assert.equal(r.output, null);
  const [f] = notices(r);
  assert.equal(f.rule, 'regla-fija');
  assert.equal(f.status, 'detect-only');
  assert.equal(f.due, null, 'no vence el 1/12: el error ya existe hoy');
  assert.equal(f.line, 2);
  assert.match(f.message, /`d\.cuit \? 1 : 5`: solo puede valer 1 \(IVA Responsable Inscripto\) o 5 \(Consumidor Final\)/);
  assert.doesNotMatch(f.message, /agreg|cambialo|usá|debería|tiene que ser/i);
  assert.equal(f.suggestion, undefined, 'nunca se inventa un valor');
  // Otras formas de la misma regla.
  assert.deepEqual(rules(js(det('d.tipo === 6 ? 5 : 1'))), ['regla-fija']);
  assert.deepEqual(rules(js(det('(d.doc === 99 ? 5 : 1) as number'))), ['regla-fija']);
  assert.deepEqual(rules(js(det('d.esMonotributo ? 6 : 1'))), ['regla-fija']);
});

test('literal fuera de la tabla, también como string', () => {
  for (const v of ['2', '3', '11', '14', '99', '0', "'2'"]) assert.deepEqual(rules(js(det(v))), ['fuera-de-tabla'], v);
  const [f] = notices(js(det('2')));
  assert.match(f.message, /puede valer `2`, que no está en la tabla de ARCA.*error 10242.*1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16/);
  assert.deepEqual(rules(js(det("'Consumidor Final'"))), ['fuera-de-tabla']);
  assert.deepEqual(rules(js(det('`11`'))), ['fuera-de-tabla']);
  // Una constante del archivo es lo mismo que un literal; en un ternario, se avisa el que no existe.
  assert.deepEqual(rules(js(`const C = 2;\n${det('C')}`)), ['fuera-de-tabla']);
  assert.deepEqual(rules(js(det('d.cuit ? 2 : 5'))), ['fuera-de-tabla']);
});

test('valor por defecto fijo: ||, ??, parámetros y desestructuración', () => {
  for (const v of ['d.iva || 5', 'd.iva ?? 5', 'd.iva || 1', 'Number(d.iva) || 5', 'parseInt(d.iva, 10) ?? 6', 'Number(d.iva ?? 5)', '(d.iva as number) ?? 5', 'MAPA[d.iva] ?? 5']) {
    assert.deepEqual(rules(js(det(v))), ['default-fijo'], v);
  }
  const [f] = notices(js(det('d.iva || 5')));
  assert.match(f.message, /`d\.iva \|\| 5`: si no hay dato, sale como 5 \(Consumidor Final\) sin avisar.*error 10243/);
  // Un valor por defecto que depende del documento: los dos códigos.
  assert.match(notices(js(det('d.iva ?? (d.doc === 80 ? 1 : 5)')))[0].message, /sale como 1 \(IVA Responsable Inscripto\) o 5 \(Consumidor Final\)/);
  assert.deepEqual(rules(js(`const emitir = (x, d, c = 5) => ${det('c')}`)), ['default-fijo']);
  assert.deepEqual(rules(js(`function e(x, d) {\n  const { iva = 5 } = d;\n  ${det('iva')}}\n`)), ['default-fijo']);
  assert.deepEqual(rules(js(`const c = d.iva || 5;\n${det('c')}`)), ['default-fijo']);
});

test('variable que se reasigna: regla fija, o valor por defecto si sale de un dato', () => {
  const byRule = `let c = 5;\nif (d.doc === 80) {\n  if (d.tipo === 1) c = 1;\n  else c = 6;\n}\n${det('c')}`;
  const [f] = notices(js(byRule));
  assert.equal(f.rule, 'regla-fija');
  assert.match(f.message, /`c` \(líneas 1, 3 y 4\): solo puede valer 5 \(Consumidor Final\), 1 \(IVA Responsable Inscripto\) o 6 \(Responsable Monotributo\)/);
  // Según la condición del cliente es una traducción, pero el 5 del principio es un valor por defecto.
  assert.deepEqual(rules(js(`let c = 5;\nif (d.condicion === 'ri') c = 1;\nelse if (d.condicion === 'mono') c = 6;\n${det('c')}`)), ['default-fijo']);
  assert.deepEqual(rules(js(`let c = 1;\nif (d.iva) c = d.iva;\n${det('c')}`)), ['default-fijo']);
  assert.deepEqual(rules(js(`let c = d.iva;\nif (!c) c = 5;\n${det('c')}`)), ['default-fijo']);
  assert.deepEqual(rules(js(`let c = d.iva;\nc ||= 5;\n${det('c')}`)), ['default-fijo']);
  assert.deepEqual(rules(js(`let c;\nif (d.iva) c = d.iva;\nelse c = 1;\n${det('c')}`)), ['default-fijo']);
  // El || adentro de una reasignación se dice una vez.
  assert.deepEqual(rules(js(`let c = 5;\nif (d.cuit) c = MAPA[d.iva] || 5;\n${det('c')}`)), ['default-fijo']);
});

test('enum u objeto con valores fuera de la tabla, aunque el campo no salga de ahí todavía', () => {
  const only = 'export enum AfipCondicionIva {\n  RESPONSABLE_INSCRIPTO = 1,\n  EXENTO = 2,\n  CONSUMIDOR_FINAL = 5,\n  RESPONSABLE_NO_INSCRIPTO = 6,\n  MONOTRIBUTO = 11,\n}\n';
  const [f] = notices(js(only, 'src/types.ts'));
  assert.equal(f.rule, 'tabla');
  assert.equal(f.line, 1);
  assert.match(f.message, /`AfipCondicionIva`.*`EXENTO = 2`, `MONOTRIBUTO = 11` no están en la tabla de ARCA/);
  assert.match(f.message, /`RESPONSABLE_NO_INSCRIPTO = 6`: en la tabla, 6 es Responsable Monotributo/);
  assert.match(f.message, /Si esos valores llegan a `CondicionIVAReceptorId` tal cual/);
  // En un repo que no factura con ARCA no se dice nada.
  assert.deepEqual(notices(js(only, 'src/types.ts', emptyContext())), []);
  // El nombre dice que es de ARCA: alcanza con que se use, aunque el repo todavía no mande el campo.
  const noField = { ...ctx, usesField: false };
  assert.deepEqual(rules(js(only, 'src/types.ts', noField)), ['tabla']);
  // Un catálogo que no se usa en ningún lado, o con otro nombre en un repo que todavía no manda el campo: nada.
  assert.deepEqual(notices(js(only, 'src/types.ts', { ...ctx, mentions: () => false })), []);
  const catalog = 'export enum CondicionIva { RI = 1, NO_RESPONSABLE = 3 }\n';
  assert.deepEqual(notices(js(catalog, 'src/types.ts', noField)), []);
  assert.deepEqual(rules(js(catalog, 'src/types.ts')), ['tabla']);
  // Usado en el mismo archivo también cuenta.
  assert.deepEqual(rules(js(`${catalog}export const n = CondicionIva.RI;\n`, 'src/types.ts', { ...ctx, mentions: () => false })), ['tabla']);
  // Lo que el autor ya marcó como @deprecated no se repite.
  const dep = 'enum VatCondition {\n  RI = 1,\n  /** @deprecated ARCA lo rechaza. */\n  NO_RESPONSABLE = 3,\n}\n';
  assert.deepEqual(notices(js(dep)), []);
  assert.deepEqual(notices(js('const COND_IVA = {\n  RI: 1,\n  // @deprecated: ARCA lo rechaza\n  NR: 3,\n};\n')), []);
  // Objetos, con cualquier grafía del nombre y con as const o Object.freeze.
  for (const src of [
    'export const CONDICIONES_IVA = { RI: 1, EXENTO: 3 };\n',
    "const CONDICION_IVA_MAP = { 'Responsable Inscripto': 1, Exento: 3 } as const;\n",
    'const taxCondition = Object.freeze({ RI: 1, EXENTO: 2 });\n',
    'enum condFiscalIva { "IVA Responsable Inscripto" = 1, "IVA no Responsable" = 3 }\n',
    'enum IvaCondition { RI = 1, MONO, EXENTO }\n', // valores implícitos: 1, 2, 3
  ]) assert.deepEqual(rules(js(src)), ['tabla'], src);
  // Una clave que dice otra cosa que el código, con todos los valores en la tabla.
  assert.match(notices(js('const CONDICION_IVA = { MONOTRIBUTO: 4, EXENTO: 6 };\n'))[0].message, /`MONOTRIBUTO = 4`: en la tabla, 4 es IVA Sujeto Exento/);
});

test('la tabla de la que sale el campo se avisa una vez, donde se declara, aunque no se llame como una condición', () => {
  const src = `const MAPA = { RI: 1, EXENTO: 2 };\n${det('MAPA[d.tipoCliente]')}`;
  const found = notices(js(src));
  assert.deepEqual(found.map((f) => f.rule), ['tabla']);
  assert.equal(found[0].line, 1);
  assert.match(found[0].message, /`CondicionIVAReceptorId` sale de acá \(línea 2\)/);
  // Por un miembro: también una sola vez.
  assert.deepEqual(rules(js(`enum Cond { RI = 1, EX = 2 }\n${det('Cond.EX')}`)), ['tabla']);
  // Y si no hay ningún valor raro, nada.
  assert.deepEqual(notices(js(`const MAPA = { RI: 1, MONO: 6, EX: 4, CF: 5 };\n${det('MAPA[d.tipoCliente]')}`)), []);
});

test('función del mismo archivo que devuelve un código que no existe', () => {
  const fn = (code) => `function cond(c) {\n  switch (c) {\n    case 'ri': return 1;\n    case 'ex': return ${code};\n    default: return 5;\n  }\n}\n${det('cond(d.c)')}`;
  assert.deepEqual(rules(js(fn(2))), ['fuera-de-tabla']);
  assert.deepEqual(notices(js(fn(4))), [], 'una traducción con códigos válidos no se avisa');
  const method = (code) => `class S {\n  cond(c) { if (c) return ${code}; return 5; }\n  e(x, d) { ${det('this.cond(d.c)').trim()} }\n}\n`;
  assert.deepEqual(rules(js(method(3))), ['fuera-de-tabla']);
  assert.deepEqual(notices(js(method(4))), []);
});

test('clase del comprobante, comentario y valor fijo con un DocTipo que puede ser un CUIT', () => {
  const lit = (extra) => `x.ElectronicBilling.createVoucher({ ${extra} });\n`;
  const [clase] = notices(js(lit('CbteTipo: 1, DocTipo: 80, CondicionIVAReceptorId: 5')));
  assert.equal(clase.rule, 'clase');
  assert.match(clase.message, /5 \(Consumidor Final\), que no es válido para un comprobante clase A.*error 10243.*1, 6, 13, 16/);
  assert.deepEqual(rules(js(lit('CbteTipo: 6, DocTipo: 80, CondicionIVAReceptorId: 1'))), ['clase']);
  assert.deepEqual(notices(js(lit('CbteTipo: 1, DocTipo: 80, CondicionIVAReceptorId: 6'))), [], 'un monotributista recibe A');
  const comment = 'x.ElectronicBilling.createVoucher({\n  DocTipo: 96,\n  CondicionIVAReceptorId: 4, // Consumidor Final\n});\n';
  const [said] = notices(js(comment));
  assert.equal(said.rule, 'comentario');
  assert.match(said.message, /vale 4 \(IVA Sujeto Exento\), pero el comentario de esa línea dice "Consumidor Final"/);
  assert.deepEqual(notices(js(comment.replace('Consumidor Final', 'IVA Exento'))), []);
  assert.deepEqual(notices(js(comment.replace(': 4,', ': 5,'))), []);
  assert.deepEqual(notices(js(comment.replace(': 4, // Consumidor Final', ': 5, // Consumidor Final (el receptor, no el emisor monotributista)'))), []);
  assert.deepEqual(rules(js(det('5'))), ['siempre-igual']);
  assert.deepEqual(rules(js(det('1'))), ['siempre-igual']);
  assert.deepEqual(rules(js(det('5', 'd.cuit ? 80 : 99'))), ['siempre-igual']);
});

test('dónde se lee el campo: asignación, XML, armador y clave casi bien escrita', () => {
  assert.deepEqual(rules(js('det.CondicionIVAReceptorId = d.iva || 5;\n')), ['default-fijo']);
  assert.deepEqual(rules(js("det['CondicionIVAReceptorId'] = d.cuit ? 1 : 5;\n")), ['regla-fija']);
  assert.deepEqual(rules(js('(det as any).CondicionIVAReceptorId = 2;\n')), ['fuera-de-tabla']);
  assert.deepEqual(rules(js('const xml = `<ar:DocTipo>80</ar:DocTipo>\n<ar:CondicionIVAReceptorId>${d.iva || 5}</ar:CondicionIVAReceptorId>`;\n')), ['default-fijo']);
  assert.deepEqual(rules(js("const a = tag('ar:CondicionIVAReceptorId', d.iva ?? 1);\n")), ['default-fijo']);
  const near = 'x.ElectronicBilling.createVoucher({ DocTipo: d.doc, DocNro: 1, CondicionIVAReceptor: d.cuit ? 1 : 5 });\n';
  assert.deepEqual(rules(js(near)), ['regla-fija']);
});

test('no avisa cuando sale de un dato, o cuando el 5 es correcto', () => {
  const clean = [
    det('d.iva'),
    det('cliente.condicion.codigo'),
    det('Number(d.iva)'),
    det('await cond(d)'),
    det('mapa(d.iva)'),
    det('d.doc === 99 ? 5 : d.iva'),
    det('d.cuit ? d.iva : 5'),
    det('d.doc === 99 ? 5 : MAPA[d.iva]'),
    det("d.c === 'ri' ? 1 : d.c === 'mono' ? 6 : d.c === 'ex' ? 4 : d.iva"),
    det('5', '99'),
    det('d.iva || 5', '99'),
    det('5', 'd.dni ? 96 : 99'),
    `const D = 96;\n${det('5', 'D')}`,
    'x.ElectronicBilling.createVoucher({ DocTipo: 99, DocNro: 0, CondicionIVAReceptorId: 5 });\n',
    "x.ElectronicBilling.createVoucher({ DocTipo: 80, DocNro: n, CondicionIVAReceptorId: 1 });\n",
    'const c = 5;\nx.ElectronicBilling.createVoucher({ DocTipo: 99, DocNro: 0, CondicionIVAReceptorId: c });\n',
    // Lo que deja Parche: el arreglo parcial.
    'x.ElectronicBilling.createVoucher({ CbteTipo: 6, DocTipo: d.doc, DocNro: 0, ...(Number(d.doc) === 99 ? { CondicionIVAReceptorId: 5 } : {}) });\n',
    // Reasignaciones por el documento.
    `let c = 5;\nif (d.cuit) c = d.iva;\n${det('c')}`,
    `let c = d.iva;\nif (d.doc === 99) c = 5;\n${det('c')}`,
    `let c;\nif (d.doc === 99) c = 5;\nelse c = d.iva;\n${det('c')}`,
    // Dentro de un if: el 5 es de ese caso.
    'if (d.iva) det.CondicionIVAReceptorId = d.iva;\nelse if (d.doc === 99) det.CondicionIVAReceptorId = 5;\n',
    // Lecturas y tipos: acá no se arma el pedido.
    'const c = det.CondicionIVAReceptorId ?? 5;\nconst r = { condicion: det.CondicionIVAReceptorId || 5 };\n',
    'export interface Det { CondicionIVAReceptorId: number }\n',
    'if (det.CondicionIVAReceptorId === 2) throw new Error("x");\n',
    // Tablas: bien numeradas, con textos, o que no son de esto.
    'export enum CondicionIva { RI = 1, EX = 4, CF = 5, MONO = 6 }\n',
    'export enum TaxCondition { RI = "Responsable Inscripto", EX = "Exento" }\n',
    'export const TIPOS_COMPROBANTE = { A: 1, B: 6, C: 11 };\n',
    'const comprobante = { impNeto: 0, moneda: "PES" };\nconst a = comprobante.condicionIvaReceptorId;\n',
    'export const CONDICION_IVA_LABELS = { 1: "Responsable Inscripto", 2: "Otro" };\n',
  ];
  for (const src of clean) assert.deepEqual(notices(js(src)), [], src);
});

test('en tests y mocks no se avisa', () => {
  for (const file of ['test/x.ts', 'src/x.test.ts', 'src/__mocks__/x.ts', 'examples/x.js']) {
    assert.deepEqual(notices(js(det('2'), file)), [], file);
    assert.deepEqual(notices(js('export enum AfipCondicionIva { RI = 1, EX = 2 }\n', file)), [], file);
  }
  for (const file of ['test/x.php', 'tests/Foo.php', 'src/FooTest.php']) {
    assert.deepEqual(notices(php("<?php\n$d['CondicionIVAReceptorId'] = 2;\n", file)), [], file);
  }
});

test('el mismo valor en varios lugares del archivo es un aviso, con sus líneas', () => {
  const src = `export const a = (x, d) => ${det('d.iva || 5')}export const b = (x, d) => ${det('d.iva || 5')}export const c = (x, d) => ${det('d.otro || 5')}`;
  const found = notices(js(src));
  assert.equal(found.length, 2);
  assert.equal(found[0].line, 1);
  assert.match(found[0].message, /También en la línea 2\.$/);
});

test('idempotencia: no cambia nada, y al lado de un arreglo el archivo solo cambia por el arreglo', () => {
  const src = `export const a = (x, d) => ${det('d.iva || 5')}export const b = (x) => x.ElectronicBilling.createVoucher({ CbteTipo: 6, DocTipo: 99, DocNro: 0 });\n`;
  const first = js(src);
  assert.ok(first.output);
  assert.equal(first.output.match(/CondicionIVAReceptorId/g).length, 2, 'una ya estaba y el arreglo agrega otra');
  assert.ok(first.output.includes('d.iva || 5'), 'el valor sospechoso no se toca');
  const second = js(first.output);
  assert.equal(second.output, null);
  assert.deepEqual(rules(second), rules(first));
  assert.equal(js(det('d.cuit ? 1 : 5')).output, null);
});

test('CRLF y tabs: la línea es la del archivo y no se escribe nada', () => {
  const src = "\texport const f = (x, d) => {\r\n\t\tconst c = d.cuit ? 1 : 5;\r\n\t\treturn x.ElectronicBilling.createVoucher({\r\n\t\t\tDocTipo: d.doc,\r\n\t\t\tCondicionIVAReceptorId: c,\r\n\t\t});\r\n\t};\r\n";
  const r = js(src);
  assert.equal(r.output, null);
  assert.equal(notices(r)[0].line, 5);
  assert.match(notices(r)[0].message, /`d\.cuit \? 1 : 5`/, 'el texto citado sale bien con tabs y CRLF');
  // Con un \r suelto, la línea es la de git y tampoco se edita.
  const loose = 'const c = d.iva || 5;\r\r\n\r\r\nx.ElectronicBilling.createVoucher({ DocTipo: d.doc, CondicionIVAReceptorId: c });\r\r\n';
  const l = js(loose);
  assert.equal(l.output, null);
  assert.equal(notices(l)[0].line, 3);
  const phpSrc = "<?php\r\n\t$c = $cuit ? 1 : 5;\r\n\t$d = ['DocTipo' => $t,\r\n\t\t'CondicionIVAReceptorId' => $c,\r\n\t];\r\n";
  const p = php(phpSrc);
  assert.equal(p.output, null);
  assert.equal(notices(p)[0].line, 4);
  assert.match(notices(p)[0].message, /`\$cuit \? 1 : 5`/);
});

test('PHP: los mismos casos', () => {
  const call = (value, doc = '$d') => `<?php\n$afip->ElectronicBilling->CreateVoucher(['CbteTipo' => $t, 'DocTipo' => ${doc}, 'CondicionIVAReceptorId' => ${value}]);\n`;
  assert.deepEqual(rules(php(`<?php\n$c = $cuit ? 1 : 5;\n${call('$c').slice(6)}`)), ['regla-fija']);
  for (const v of ["$cli['iva'] ?? 5", "$cli['iva'] ?: 5", '(int) $i ?: 1', 'intval($i ?? 5)']) assert.deepEqual(rules(php(call(v))), ['default-fijo'], v);
  for (const v of ['2', "'3'", "'Consumidor Final'"]) assert.deepEqual(rules(php(call(v))), ['fuera-de-tabla'], v);
  assert.deepEqual(rules(php("<?php\n$det['CondicionIVAReceptorId'] = 11;\n")), ['fuera-de-tabla']);
  assert.deepEqual(rules(php('<?php\n$det->CondicionIVAReceptorId = $i ?? 5;\n')), ['default-fijo']);
  assert.deepEqual(rules(php(`<?php\nfunction e($afip, $d, $c = 5) {\n  $afip->ElectronicBilling->CreateVoucher(['DocTipo' => $d, 'CondicionIVAReceptorId' => $c]);\n}\n`)), ['default-fijo']);
  const reassign = `<?php\n$c = 5;\nif ($doc == 80) {\n  if ($t == 1) { $c = 1; } else { $c = 6; }\n}\n$a = ['DocTipo' => $doc, 'CondicionIVAReceptorId' => $c];\n`;
  const [f] = notices(php(reassign));
  assert.equal(f.rule, 'regla-fija');
  assert.match(f.message, /`\$c` \(líneas 2 y 4\).*solo puede valer 5 \(Consumidor Final\), 1 \(IVA Responsable Inscripto\) o 6 \(Responsable Monotributo\)/);
  assert.deepEqual(rules(php("<?php\n$c = $cli['iva'];\nif (!$c) { $c = 5; }\n$a = ['CondicionIVAReceptorId' => $c];\n")), ['default-fijo']);
  // Clase y comentario.
  assert.deepEqual(rules(php("<?php\n$a = ['CbteTipo' => 1, 'DocTipo' => 80, 'CondicionIVAReceptorId' => 5];\n")), ['clase']);
  assert.deepEqual(rules(php("<?php\n$a = [\n  'DocTipo' => 96,\n  'CondicionIVAReceptorId' => 4, // Consumidor Final\n];\n")), ['comentario']);
  assert.deepEqual(rules(php("<?php\n$a = [\n  'DocTipo' => $d,\n  'CondicionIVAReceptorId' => 5, # Consumidor Final\n];\n")), ['siempre-igual']);
  // Tablas: clases, enums, constantes y arrays.
  for (const src of [
    '<?php\nclass CondicionIvaAfip { const RI = 1; const EXENTO = 2; }\n',
    '<?php\nenum CondicionIva: int { case RI = 1; case EXENTO = 2; }\n',
    "<?php\nconst CONDICIONES_IVA = ['RI' => 1, 'EXENTO' => 3];\n",
    "<?php\n$condicion_iva = ['RI' => 1, 'EXENTO' => 3];\n",
  ]) assert.deepEqual(rules(php(src)), ['tabla'], src);
  assert.deepEqual(rules(php("<?php\n$mapa = ['RI' => 1, 'EX' => 2];\n$a = ['DocTipo' => $d, 'CondicionIVAReceptorId' => $mapa[$x]];\n")), ['tabla']);
  assert.deepEqual(rules(php('<?php\nclass C { const RI = 1; const EX = 2; }\n$a = ["CondicionIVAReceptorId" => C::EX];\n')), ['tabla']);
  // Lo que no se avisa.
  for (const src of [
    call("$cli['iva']"),
    call('$d == 99 ? 5 : $i'),
    call('$c ? $i : 5'),
    call('5', '99'),
    call('$i ?? 5', '99'),
    "<?php\n$a = ['DocTipo' => 99, 'DocNro' => 0, 'CondicionIVAReceptorId' => 5];\n",
    "<?php\n$c = $i;\nif ($doc == 99) { $c = 5; }\n$a = ['CondicionIVAReceptorId' => $c];\n",
    "<?php\nif ($doc == 99) { $det['CondicionIVAReceptorId'] = 5; }\n",
    "<?php\n$x = $det['CondicionIVAReceptorId'] ?? 5;\n",
    "<?php\nclass CondicionIva { const RI = 1; const EX = 4; }\n",
    "<?php\n$tipos = ['A' => 1, 'B' => 6, 'C' => 11];\n",
  ]) assert.deepEqual(notices(php(src)), [], src);
  assert.deepEqual(notices(php('<?php\nclass CondicionIvaAfip { const RI = 1; const EX = 2; }\n', 'src/x.php', emptyContext())), []);
});

test('un error del detector no frena el arreglo: se dice y sigue', () => {
  const boom = () => { throw new Error('algo raro'); };
  const [f] = safely('a.js', 'const x = { CondicionIVAReceptorId: 1 };', boom);
  assert.equal(f.status, 'detect-only');
  assert.match(f.message, /No pude revisar de dónde sale `CondicionIVAReceptorId`.*algo raro/);
  assert.deepEqual(safely('a.js', 'enum X {}', boom), [], 'sin el campo no hay nada que revisar');
  assert.deepEqual(safely('a.js', '', () => [1]), [1]);
});

test('nombres de tabla y condiciones que nombra un texto', () => {
  for (const n of ['AfipCondicionIva', 'CONDICIONES_IVA', 'condFiscalIva', 'CondicionIVA', 'IvaCondition', 'CLIENT_IVA_CONDITIONS', 'TaxCondition', 'vat_condition', 'condIvaReceptor', 'CONDICION_IVA_MAP']) assert.ok(isConditionName(n), n);
  for (const n of ['TIPOS_COMPROBANTE', 'ivaRates', 'ALICUOTAS_IVA', 'Conditional', 'condition']) assert.ok(!isConditionName(n), n);
  assert.equal(conditionNamed('Consumidor Final'), 5);
  assert.equal(conditionNamed('RESPONSABLE_INSCRIPTO'), 1);
  assert.equal(conditionNamed('RESPONSABLE_NO_INSCRIPTO'), 0);
  assert.equal(conditionNamed('MONOTRIBUTO_SOCIAL'), 13);
  assert.equal(conditionNamed('Monotributo'), 6);
  assert.equal(conditionNamed('RG 5616 - obligatorio'), null);
});

const SERVICE = `export const f = (x, d) => {
  const c = d.cuit ? 1 : 5;
  return x.electronicBillingService.createVoucher({ CbteTipo: 6, DocTipo: d.doc, DocNro: d.nro, CondicionIVAReceptorId: c });
};
`;
const SCRIPT = 'export const g = (x) => x.electronicBillingService.createVoucher({ CbteTipo: 6, DocTipo: 99, DocNro: 0 });\n';

test('en el JSON y en el reporte: con fingerprint, sin fecha y aunque el campo ya esté', () => {
  const root = tree({ 'src/s.js': SERVICE });
  const out = JSON.parse(execFileSync('node', [BIN, 'scan', root, '--json', '--pack', pack.id], { encoding: 'utf8' }));
  assert.equal(out.findings.length, 1);
  const [f] = out.findings;
  assert.equal(f.status, 'detect-only');
  assert.equal(f.rule, 'regla-fija');
  assert.equal(f.file, 'src/s.js');
  assert.equal(f.line, 3);
  assert.equal(f.due, null);
  assert.match(f.fingerprint, /^[0-9a-f]{16}$/);
  // El fingerprint no depende de la línea: se reconoce el aviso aunque se muevan las líneas.
  fs.writeFileSync(path.join(root, 'src/s.js'), `// arriba\n${SERVICE}`);
  const moved = run(root, { write: false, packIds: [pack.id] }).findings[0];
  assert.equal(moved.fingerprint, f.fingerprint);
  assert.equal(moved.line, 4);
  const report = scanReport({ ...run(root, { write: false, packIds: [pack.id] }), changed: [] });
  assert.match(report, /🔎 detectado `src\/s\.js:4`/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('sin nada para arreglar no se abre un PR: queda como issue, y la Action lo muestra', () => {
  const { root, env, g, cleanup } = gitRepo({ 'src/s.js': SERVICE });
  const summaryFile = path.join(root, '..', `${path.basename(root)}.md`);
  const out = execFileSync('node', [BIN, 'pr', root, '--dry-run', '--pack', pack.id], { encoding: 'utf8', env: { ...env, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryFile } });
  assert.match(out, /Sin cambios de código; queda como issue o reporte/);
  assert.match(out, /::warning file=src\/s\.js,line=3/);
  assert.equal(g('branch', '--list', 'parche/*').trim(), '', 'no queda ninguna rama');
  assert.equal(g('status', '--porcelain').trim(), '');
  const body = fs.readFileSync(path.join(root, '.parche', `pr-${pack.id}.md`), 'utf8');
  assert.match(body, /Parche no encontró comprobantes sin el campo/);
  assert.match(body, /### Condición frente al IVA para revisar \(Parche no la cambia\)/);
  assert.match(body, /🔎 detectado `src\/s\.js:3`/);
  assert.doesNotMatch(body, /No hay un arreglo automático seguro/);
  assert.match(fs.readFileSync(summaryFile, 'utf8'), /🔎 detectado · `src\/s\.js:3`/);
  fs.rmSync(summaryFile, { force: true });
  cleanup();
});

test('al lado de un arreglo: el PR lo cuenta aparte, no pasa a borrador y no lo marca como cubierto', () => {
  const { root, env, cleanup } = gitRepo({ 'src/s.js': SERVICE, 'probar.js': SCRIPT });
  const summaryFile = path.join(root, '..', `${path.basename(root)}.md`);
  const out = execFileSync('node', [BIN, 'pr', root, '--dry-run', '--pack', pack.id], { encoding: 'utf8', env: { ...env, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryFile } });
  assert.doesNotMatch(out, /iría como borrador/);
  const body = fs.readFileSync(path.join(root, '.parche', `pr-${pack.id}.md`), 'utf8');
  assert.match(body, /Modifica 1 archivo\(s\): `probar\.js`/);
  assert.match(body, /El repo ya usa `CondicionIVAReceptorId` en `src\/s\.js`/);
  assert.match(body, /### Condición frente al IVA para revisar/);
  assert.match(body, /🔎 detectado `src\/s\.js:3`/);
  assert.match(body, /🔎 detectado 1/, 'en el pie');
  const events = fs.readFileSync(path.join(root, '.parche', 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const pr = events.find((e) => e.type === 'pr');
  const { findings } = run(root, { write: false, packIds: [pack.id] });
  const notice = findings.find((f) => f.status === 'detect-only');
  assert.ok(notice);
  assert.ok(!pr.fingerprints.includes(notice.fingerprint));
  assert.equal(pr.fingerprints.length, 1);
  assert.match(fs.readFileSync(summaryFile, 'utf8'), /### Sin PR[\s\S]*🔎 detectado · `src\/s\.js:3`/);
  fs.rmSync(summaryFile, { force: true });
  cleanup();
});

test('el resumen de la semana: fila propia, sin fecha, sin "en curso" y sin cortar el código', () => {
  const notice = { pack: pack.id, file: 'src/s.js', line: 3, status: 'detect-only', rule: 'regla-fija', change: 'Condición frente al IVA sospechosa', due: null,
    message: '`CondicionIVAReceptorId` sale de `d.cuit ? 1 : 5`: solo puede valer 1 o 5. Es un dato de cada cliente.', fingerprint: 'aaaa' };
  const auto = { pack: pack.id, file: 'probar.js', line: 1, status: 'auto', message: 'Agregado.', due: '2026-12-01', fingerprint: 'bbbb' };
  const scan = { run: { repository: 'o/r' }, inventory: { repo: 'r', apis: [] }, findings: [auto, notice] };
  const ledger = [{ type: 'pr', pack: pack.id, url: 'https://github.com/o/r/pull/1', draft: false, fingerprints: ['bbbb'] }];
  const previous = { scan: { findings: [] } };
  const data = weeklyData({ scan, ledger, previous, packs, today: '2026-11-04' });
  const rows = data.clientes[0].para_hacer;
  assert.equal(rows.length, 2);
  const row = rows.find((r) => r.cambio === 'Condición frente al IVA sospechosa');
  assert.ok(row);
  assert.equal(row.vence, null);
  assert.equal(row.seguimiento, 'nuevo');
  assert.equal(row.que_hacer, notice.message);
  assert.deepEqual(row.donde, ['src/s.js:3']);
  const main = rows.find((r) => r !== row);
  assert.deepEqual(main.donde, ['probar.js:1'], 'la fila del PR no lo incluye');
  assert.equal(main.seguimiento, 'en curso');
  const nuevo = data.clientes[0].nuevos.find((n) => n.cambio === row.cambio);
  assert.match(nuevo.consecuencia, /solo puede valer 1 o 5\.$/);
  // Cuando desaparece, se cuenta aparte de los lugares del pack.
  const later = weeklyData({ scan: { ...scan, findings: [auto] }, ledger, previous: { scan }, packs, today: '2026-11-11' });
  const gone = later.clientes[0].resueltos;
  assert.equal(gone.length, 1);
  assert.match(gone[0].cambio, /Condición frente al IVA sospechosa/);
});

test('prBody: la sección se puede usar en cualquier pack con avisos de solo detección', () => {
  const mp = packs.find((p) => p.id === 'mercadopago.payments-to-orders');
  const f = { pack: mp.id, file: 'a.js', line: 1, status: 'detect-only', message: 'Mirá esto.' };
  assert.match(prBody({ pack: mp, findings: [f], changed: [], verification: null }), /### Para revisar aparte \(Parche no lo cambia\)[\s\S]*🔎 detectado `a\.js:1`/);
});
