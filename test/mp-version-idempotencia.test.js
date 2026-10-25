// 0.7.5: dos hallazgos del chat de Accesos en el SDK oficial de Mercado Pago (verificados el 24/10/2026 en
// github.com/mercadopago/sdk-nodejs). `Order` existe desde la 2.4.0, así que con una versión anterior la migración deja
// `Order` undefined. Y la idempotencyKey que agregaba Parche quedaba en el client por el bug abierto #481: salía también
// en los reembolsos y las capturas siguientes, y no aportaba nada, porque el SDK ya genera una en cada escritura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mp from '../src/codemods/mercadopago-payments-to-orders.js';
import { loadPacks } from '../src/packs.js';
import { emptyContext } from '../src/context.js';
import { parseCheck } from '../src/ast.js';

const pack = loadPacks().find((p) => p.id === 'mercadopago.payments-to-orders');
const SOURCE = [
  "import { MercadoPagoConfig, Payment } from 'mercadopago';",
  "const client = new MercadoPagoConfig({ accessToken: process.env.MP_TOKEN });",
  'const payment = new Payment(client);',
  'export async function pagar(token) {',
  "  const r = await payment.create({ body: { transaction_amount: 100, token, installments: 1, payment_method_id: 'visa', external_reference: 'p1', payer: { email: 'a@b.c' } } });",
  "  return r.status === 'approved';",
  '}',
  '',
].join('\n');
const withSdk = (sdk) => ({ ...emptyContext(), versions: { npm: { mercadopago: sdk }, composer: {}, pypi: {} } });
const run = (context, source = SOURCE) => mp({ source, file: 'src/pago.js', pack, context });

test('con mercadopago < 2.4.0 instalado (lockfile o node_modules), la migración queda bloqueada', () => {
  for (const from of ['package-lock.json', 'node_modules']) {
    const r = run(withSdk({ version: '2.3.0', source: from }));
    assert.equal(r.output, null, from);
    const blocked = r.findings.filter((f) => f.status === 'blocked');
    assert.equal(blocked.length, 1);
    assert.match(blocked[0].message, /Tenés mercadopago 2\.3\.0 .*`Order` existe desde la 2\.4\.0 .*Subí el SDK a 2\.4\.0 o posterior/);
  }
});

test('con un rango declarado que permite una versión sin Order, migra pero pide fijar ^2.4.0', () => {
  const r = run(withSdk({ version: '2.1.0', source: 'declarada', range: '^2.1.0' }));
  parseCheck(r.output, 'src/pago.js');
  assert.match(r.output, /new Order\(client\)/);
  const note = r.findings.find((f) => /permite instalar una versión sin `Order`/.test(f.message));
  assert.equal(note.status, 'needs-review');
  assert.match(note.message, /`\^2\.1\.0`.*"mercadopago": "\^2\.4\.0"/);
  assert.equal(note.line, 1, 'en el import de mercadopago');
});

test('con 2.4.0 o posterior no hay aviso de versión; sin versión a la vista, se pide confirmarla', () => {
  for (const sdk of [{ version: '2.4.0', source: 'package-lock.json' }, { version: '2.13.0', source: 'node_modules' }, { version: '3.6.1', source: 'declarada', range: '^3.6.1' }]) {
    const r = run(withSdk(sdk));
    assert.ok(r.output, sdk.version);
    assert.ok(!r.findings.some((f) => /2\.4\.0/.test(f.message)), sdk.version);
  }
  const unknown = run(emptyContext());
  assert.ok(unknown.findings.some((f) => f.status === 'needs-review' && /No pude leer qué versión de mercadopago/.test(f.message)));
});

test('no agrega idempotencyKey; si el código ya traía una, la deja y avisa del #481', () => {
  const r = run(withSdk({ version: '2.13.0', source: 'package-lock.json' }));
  assert.doesNotMatch(r.output, /requestOptions|idempotencyKey|randomUUID|node:crypto/);
  assert.ok(!r.findings.some((f) => /idempotencyKey/.test(f.message)));
  const own = SOURCE.replace("payer: { email: 'a@b.c' } } });", "payer: { email: 'a@b.c' } }, requestOptions: { idempotencyKey: pedido.id } });");
  const kept = run(withSdk({ version: '2.13.0', source: 'package-lock.json' }), own);
  assert.match(kept.output, /requestOptions: \{ idempotencyKey: pedido\.id \}/);
  const leak = kept.findings.find((f) => /sdk-nodejs#481/.test(f.message));
  assert.equal(leak.status, 'needs-review');
  assert.match(leak.message, /escrituras siguientes de ese `client`/);
  // Idempotente: una segunda pasada sobre lo migrado no cambia nada.
  assert.equal(run(withSdk({ version: '2.13.0', source: 'package-lock.json' }), r.output).output, null);
});
