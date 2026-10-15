import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import arca from '../src/codemods/arca-wsfe-condicion-iva.js';
import mp from '../src/codemods/mercadopago-payments-to-orders.js';
import ai from '../src/detectors/ai-model-retirements.js';
import { loadPacks, validatePack } from '../src/packs.js';
import { run } from '../src/engine.js';
import { parseCheck } from '../src/ast.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EX = path.join(HERE, '..', 'examples', 'tienda-demo', 'src');
const packs = Object.fromEntries(loadPacks().map((p) => [p.id, p]));
const src = (f) => fs.readFileSync(path.join(EX, f), 'utf8');
const runMp = (f) => mp({ source: src(f), file: f, pack: packs['mercadopago.payments-to-orders'] });

test('packs: todos tienen los campos obligatorios y fuentes', () => {
  for (const p of Object.values(packs)) assert.ok(validatePack(p));
  assert.equal(Object.keys(packs).length, 3);
  assert.throws(() => validatePack({ id: 'x' }), /faltan campos/);
});

test('ARCA: consumidor final se arregla solo, DNI queda para revisar, Factura A pide el dato', () => {
  const r = arca({ source: src('facturacion.js'), file: 'facturacion.js', pack: packs['arca.wsfe.condicion-iva-receptor'] });
  assert.ok(r.output);
  parseCheck(r.output, 'facturacion.js');
  assert.equal((r.output.match(/'CondicionIVAReceptorId': 5,/g) || []).length, 2, 'dos inserciones, con comillas como sus vecinos');
  assert.match(r.output, /parche: 5 = Consumidor Final \(DocTipo 99/);
  assert.match(r.output, /DNI \+ comprobante B\) — REVISAR/);
  const statuses = r.findings.map((f) => f.status);
  assert.deepEqual(statuses, ['auto', 'needs-review', 'needs-input']);
  assert.match(r.findings[2].suggestion, /1 \(IVA Responsable Inscripto\), 6 \(Responsable Monotributo\), 13 .*16/);
  // El diff es mínimo: solo se agregan líneas.
  const before = src('facturacion.js').split('\n');
  const after = r.output.split('\n');
  assert.equal(after.length - before.length, 4);
  assert.ok(before.every((l) => after.includes(l)));
});

test('ARCA: objeto en una sola línea y sin comillas', () => {
  const source = "afip.ElectronicBilling.createVoucher({ CbteTipo: 11, DocTipo: 99, DocNro: 0, ImpTotal: 100 });\n";
  const r = arca({ source, file: 'x.js', pack: packs['arca.wsfe.condicion-iva-receptor'] });
  parseCheck(r.output, 'x.js');
  assert.match(r.output, /DocNro: 0, CondicionIVAReceptorId: 5 \/\*/);
});

test('ARCA: indentación con tabs y CRLF (recast parsea otra copia del texto)', () => {
  const tabs = src('facturacion.js').replace(/\r\n/g, '\n').replace(/^(?: {2})+/gm, (s) => '\t'.repeat(s.length / 2));
  for (const source of [tabs, tabs.replace(/\n/g, '\r\n')]) {
    const crlf = source.includes('\r\n');
    const r = arca({ source, file: 'facturacion.js', pack: packs['arca.wsfe.condicion-iva-receptor'] });
    parseCheck(r.output, 'facturacion.js');
    assert.equal((r.output.match(/\n\t+'CondicionIVAReceptorId': 5,\r?\n/g) || []).length, 2);
    const before = source.split('\n');
    const after = r.output.split('\n');
    assert.equal(after.length - before.length, 4);
    assert.ok(before.every((l) => after.includes(l)), 'solo se agregan líneas');
    assert.ok(after.slice(0, -1).every((l) => l.endsWith('\r') === crlf), 'no mezcla fines de línea');
  }
});

test('MP: checkout.js migra la creación al formato Orders', () => {
  const r = runMp('checkout.js');
  const out = r.output;
  parseCheck(out, 'checkout.js');
  assert.match(out, /import \{ MercadoPagoConfig, Order \} from 'mercadopago'/);
  assert.match(out, /import \{ randomUUID \} from 'node:crypto'/);
  assert.match(out, /const order = new Order\(client\)/);
  assert.doesNotMatch(out, /new Payment|notification_url|issuer_id:|issuer_id,\n\s+payer|three_d_secure_mode|transaction_amount/);
  for (const s of ["type: 'online'", "processing_mode: 'automatic'", 'total_amount: Number(amount).toFixed(2)',
    'amount: Number(amount).toFixed(2)', 'id: payment_method_id', 'token,', 'installments: Number(installments)',
    "statement_descriptor: 'TIENDADEMO'", "validation: 'on_fraud_risk'", "liability_shift: 'required'",
    'idempotencyKey: randomUUID()', "result.status === 'processed'", "result.status === 'failed'",
    "result.status_detail === 'insufficient_amount'", 'result.created_date']) {
    assert.ok(out.includes(s), `falta: ${s}`);
  }
  assert.ok(r.findings.some((f) => f.status === 'needs-review' && /Number\(result\.id\)/.test(f.message)));
  assert.ok(r.findings.some((f) => /notification_url/.test(f.message)));
  assert.ok(!/\n\s*\n\s*\n/.test(out), 'sin líneas en blanco agregadas por el printer');
});

test('MP: TypeScript con tarjeta guardada, captura manual e items', () => {
  const r = runMp('checkout-tarjeta-guardada.ts');
  const out = r.output;
  parseCheck(out, 'checkout-tarjeta-guardada.ts');
  for (const s of ['customer_id: input.customerId', "capture_mode: 'manual'", 'external_code: input.sku',
    'type: input.paymentTypeId', "case 'action_required':", "case 'failed':", "case 'canceled':",
    'requestOptions: { idempotencyKey: uuid() }', 'process.env.MP_ACCESS_TOKEN as string']) {
    assert.ok(out.includes(s), `falta: ${s}`);
  }
  assert.doesNotMatch(out, /randomUUID/, 'si ya había idempotencyKey no se agrega otra');
  assert.ok(r.findings.some((f) => /authorized/.test(f.message)));
});

test('MP: marketplace con application_fee queda bloqueado y sin tocar', () => {
  const r = runMp('marketplace.cjs');
  assert.equal(r.output, null);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].status, 'blocked');
});

test('MP: webhooks y consultas de pagos existentes solo se reportan', () => {
  const r = runMp('webhooks.js');
  assert.equal(r.output, null);
  assert.ok(r.findings.some((f) => /payment\.get\(\)/.test(f.message)));
  assert.ok(r.findings.some((f) => /tópico `orders`/.test(f.message)));
});

test('MP: require (CommonJS) y create inline', () => {
  const source = "const { MercadoPagoConfig, Payment } = require('mercadopago');\n" +
    "async function f(c, t) {\n  const r = await new Payment(c).create({ body: { transaction_amount: 50, token: t, installments: 1, payment_method_id: 'debvisa', external_reference: 'x', payer: { email: 'a@b.c' } } });\n  return r.status === 'approved';\n}\n";
  const r = mp({ source, file: 'f.cjs', pack: packs['mercadopago.payments-to-orders'] });
  parseCheck(r.output, 'f.cjs');
  assert.match(r.output, /new Order\(c\)\.create/);
  assert.match(r.output, /const \{ randomUUID \} = require\('node:crypto'\)/);
  assert.match(r.output, /total_amount: '50\.00'/);
  assert.match(r.output, /type: 'debit_card'/);
  assert.match(r.output, /r\.status === 'processed'/);
  assert.match(r.output, /\{ MercadoPagoConfig, Order \}/);
});

test('MP: respeta el fin de línea del archivo y sus líneas en blanco', () => {
  // recast imprime con os.EOL por defecto: en Windows reescribía el archivo entero a CRLF.
  const blanks = (s, eol) => s.split(eol).filter((l) => l === '').length;
  for (const eol of ['\n', '\r\n']) {
    const source = src('checkout.js').replace(/\r\n/g, '\n').replace(/\n/g, eol);
    const r = mp({ source, file: 'checkout.js', pack: packs['mercadopago.payments-to-orders'] });
    parseCheck(r.output, 'checkout.js');
    assert.ok(r.output.split('\n').slice(0, -1).every((l) => l.endsWith('\r') === (eol === '\r\n')), `todo con ${JSON.stringify(eol)}`);
    assert.equal(blanks(r.output, eol), blanks(source, eol), 'diff mínimo: no agrega ni saca líneas en blanco');
  }
});

test('IA: detecta modelos retirados y la Assistants API', () => {
  const r = ai({ source: src('ia.js'), file: 'ia.js', pack: packs['ai.model-retirements'], today: '2026-10-15' });
  assert.equal(r.output, null);
  assert.ok(r.findings.some((f) => /claude-3-5-haiku-20241022/.test(f.message) && /ya fallan/.test(f.message)));
  assert.ok(r.findings.some((f) => /Assistants API/.test(f.message)));
});

test('motor: fix es idempotente y no rompe nada', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-'));
  fs.cpSync(path.join(EX, '..'), tmp, { recursive: true, filter: (s) => !s.includes('.parche') });
  const first = run(tmp, { write: true });
  assert.deepEqual(first.changed.map((c) => c.file).sort(), ['src/checkout-tarjeta-guardada.ts', 'src/checkout.js', 'src/facturacion.js']);
  for (const c of first.changed) parseCheck(fs.readFileSync(path.join(tmp, c.file), 'utf8'), c.file);
  const second = run(tmp, { write: true });
  assert.equal(second.changed.length, 0, 'la segunda corrida no cambia nada');
  assert.equal(fs.readFileSync(path.join(tmp, 'src/marketplace.cjs'), 'utf8'), src('marketplace.cjs'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('CLI: pr --dry-run crea la rama, el commit y el cuerpo del PR', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-pr-'));
  fs.cpSync(path.join(EX, '..'), tmp, { recursive: true, filter: (s) => !s.includes('.parche') });
  const g = (...a) => execFileSync('git', a, { cwd: tmp, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  const bin = path.join(HERE, '..', 'bin', 'parche.js');
  const out = execFileSync('node', [bin, 'pr', tmp, '--pack', 'arca.wsfe.condicion-iva-receptor', '--dry-run', '--verify'], { encoding: 'utf8' });
  assert.match(out, /Rama parche\/arca\.wsfe\.condicion-iva-receptor/);
  assert.match(out, /verificación OK/);
  assert.equal(g('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main', 'vuelve a la rama base');
  const diff = g('diff', '--stat', 'main..parche/arca.wsfe.condicion-iva-receptor');
  assert.match(diff, /src\/facturacion\.js \| 4 \+{4}/);
  const msg = g('log', '-1', '--format=%B', 'parche/arca.wsfe.condicion-iva-receptor');
  assert.match(msg, /Pack arca\.wsfe\.condicion-iva-receptor v\d/);
  const body = fs.readFileSync(path.join(tmp, '.parche', 'pr-arca.wsfe.condicion-iva-receptor.md'), 'utf8');
  assert.match(body, /Lo que este PR NO resuelve/);
  assert.match(body, /Tests del repo \(`npm test`\): ✅ pasan/);
  // Lo que Parche escribe en el repo del cliente no lleva atribuciones de las herramientas con las que se construyó Parche.
  for (const text of [msg, body]) assert.doesNotMatch(text, /Claude|claude\.ai|Co-Authored-By/);
  assert.equal(g('status', '--porcelain').trim(), '', '.parche/ no ensucia el repo del cliente');
  fs.rmSync(tmp, { recursive: true, force: true });
});
