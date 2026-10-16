// Inventario de cualquier API (hito B, nivel 1): clasificación, SDKs, HTTP, modelos de IA, manifiestos y esquema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { classifyPackage, packageOf, providerForHost, isInternalHost } from '../src/inventory/known.js';
import { scanJs } from '../src/inventory/js-scan.js';
import { parseRequirements, SCHEMA_VERSION } from '../src/inventory/index.js';
import { run } from '../src/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES = path.join(HERE, '..', 'examples');
const ops = (scan) => scan.sdk.map((u) => `${u.pkg}:${u.op}`);
const http = (scan) => scan.http.map((h) => `${h.client} ${h.method} ${h.host}${h.path}`);

test('clasificación: lista curada, prefijos, clientes HTTP, heurística y lo que no es una API', () => {
  assert.deepEqual(classifyPackage('npm', 'stripe'), { kind: 'sdk', provider: 'Stripe', category: 'pagos', confidence: 'alta', source: 'curated' });
  assert.equal(classifyPackage('npm', '@aws-sdk/client-s3').provider, 'AWS');
  assert.deepEqual(classifyPackage('npm', 'axios'), { kind: 'http-client' });
  for (const name of ['eslint', '@types/node', 'react', 'express', 'lodash', 'typescript']) assert.equal(classifyPackage('npm', name), null, name);
  assert.equal(classifyPackage('npm', 'clima-api-client').confidence, 'baja');
  assert.equal(classifyPackage('npm', '@apollo/client'), null, 'cliente de GraphQL, no la API de un tercero');
  assert.equal(classifyPackage('composer', 'afipsdk/afip.php').category, 'facturación');
  assert.equal(classifyPackage('pypi', 'boto3').provider, 'AWS');
  assert.equal(packageOf('openai/resources/chat'), 'openai');
  assert.equal(packageOf('@aws-sdk/client-s3/dist-cjs'), '@aws-sdk/client-s3');
  for (const spec of ['./db.js', '/abs', 'node:fs']) assert.equal(packageOf(spec), null);
  assert.equal(providerForHost('sheets.googleapis.com').provider, 'Google APIs');
  assert.equal(providerForHost('evilgoogleapis.com'), null, 'el sufijo tiene que ser un subdominio');
  for (const h of ['localhost', '127.0.0.1', '192.168.1.5', 'api.local']) assert.ok(isInternalHost(h), h);
  assert.ok(!isInternalHost('api.github.com'));
});

test('SDKs: imports, require, instancias y la cadena de miembros usada', () => {
  const scan = scanJs([
    "import Stripe from 'stripe';",
    "import { Payment } from 'mercadopago';",
    "import type { Customer } from 'stripe';",
    "const { sendMail } = require('@sendgrid/mail');",
    "const client = require('twilio')(sid, token);",
    'const stripe = new Stripe(key);',
    'const payment = new Payment(mp);',
    'await stripe.paymentIntents.create({});',
    'stripe?.customers?.list();',
    'payment.create({ body });',
    'sendMail({ to });',
    'client.messages.create({});',
  ].join('\n'), 'x.ts');
  assert.deepEqual(ops(scan), ['stripe:paymentIntents.create', 'stripe:customers.list', 'mercadopago:Payment.create', '@sendgrid/mail:sendMail', 'twilio:messages.create']);
  assert.ok(scan.imports.has('stripe') && scan.imports.has('twilio'));
});

test('HTTP: fetch, axios, got, undici y node-fetch con método, host y ruta', () => {
  const scan = scanJs([
    "import axios from 'axios';",
    "import got from 'got';",
    "import { request } from 'undici';",
    "import nodeFetch from 'node-fetch';",
    "const BASE = 'https://api.github.com';",
    "const meli = axios.create({ baseURL: 'https://api.mercadolibre.com/' });",
    'fetch(`${BASE}/repos/${o}/${r}/pulls?state=open`);',
    "fetch('https://api.stripe.com/v1/charges', { method: 'post' });",
    "axios.get('https://api.twilio.com/2010-04-01/Accounts.json');",
    "axios({ url: 'https://slack.com/api/chat.postMessage', method: 'POST' });",
    "meli.put('/items/' + id, body);",
    "got('https://api.bluelytics.com.ar/v2/latest');",
    "got.post('https://hooks.slack.com/services/x');",
    "request('https://api.openai.com/v1/models', { method: 'GET' });",
    "nodeFetch('https://api.telegram.org/bot/sendMessage', { method: 'POST' });",
    "fetch('/api/propia');",
    "fetch('http://localhost:3000/salud');",
    'fetch(urlDeAfuera);',
    'axios.post(config.url, body);',
  ].join('\n'), 'x.js');
  assert.deepEqual(http(scan), [
    'fetch GET api.github.com/repos/{}/{}/pulls',
    'fetch POST api.stripe.com/v1/charges',
    'axios GET api.twilio.com/2010-04-01/Accounts.json',
    'axios POST slack.com/api/chat.postMessage',
    'axios PUT api.mercadolibre.com/items/{}',
    'got GET api.bluelytics.com.ar/v2/latest',
    'got POST hooks.slack.com/services/x',
    'undici GET api.openai.com/v1/models',
    'node-fetch POST api.telegram.org/bot/sendMessage',
  ]);
  assert.equal(scan.unresolved.length, 2, 'las URLs que llegan de afuera se reportan aparte');
});

test('modelos de IA: prefijos inequívocos; la serie o1/o3 solo si el archivo usa OpenAI', () => {
  const ids = (src) => scanJs(src, 'x.js').models.map((m) => `${m.provider}:${m.id}`);
  assert.deepEqual(ids("const a = 'gpt-4o-mini'; const b = 'claude-sonnet-5-5'; const c = 'gemini-2.5-pro'; const d = 'mistral-large-latest'; const e = 'o3';"),
    ['OpenAI:gpt-4o-mini', 'Anthropic:claude-sonnet-5-5', 'Google (Gemini):gemini-2.5-pro', 'Mistral:mistral-large-latest']);
  assert.deepEqual(ids("import OpenAI from 'openai'; const m = 'o3';"), ['OpenAI:o3']);
  assert.deepEqual(ids("const x = 'gpt'; const y = 'claude'; const z = 'command';"), []);
});

test('motor: saas-demo lista todas sus APIs (no solo las financieras) y nada que no lo sea', () => {
  const inv = run(path.join(EXAMPLES, 'saas-demo')).inventory;
  assert.equal(inv.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(inv.apis.map((a) => a.id), [
    'npm:clima-api-client', 'npm:openai', 'npm:stripe', 'npm:twilio',
    'http:api.bluelytics.com.ar', 'http:api.github.com', 'http:api.mercadolibre.com', 'ai:OpenAI',
  ]);
  const byId = Object.fromEntries(inv.apis.map((a) => [a.id, a]));
  assert.deepEqual(byId['npm:stripe'].operations.map((o) => o.op).sort(), ['customers.create', 'paymentIntents.create', 'refunds.create']);
  assert.deepEqual(byId['npm:stripe'].operations[0].locations[0].file.split('/'), ['src', 'cobros.js'], 'rutas con /');
  assert.equal(byId['npm:clima-api-client'].confidence, 'media', 'heurística confirmada por el uso');
  assert.equal(byId['http:api.bluelytics.com.ar'].confidence, 'media', 'host fuera de la lista curada');
  assert.equal(byId['http:api.github.com'].provider, 'GitHub');
  assert.deepEqual(byId['ai:OpenAI'].operations.map((o) => o.op).sort(), ['gpt-4o-mini', 'text-embedding-3-small']);
  assert.equal(inv.unresolved.length, 1);
  // Compatibilidad con el inventario anterior.
  for (const k of ['generated_at', 'repo', 'packages', 'providers', 'usages', 'dependencies']) assert.ok(k in inv, k);
});

test('motor: tienda-demo suma Anthropic, OpenAI y los modelos a lo que ya cubrían los packs', () => {
  const inv = run(path.join(EXAMPLES, 'tienda-demo')).inventory;
  const ids = inv.apis.map((a) => a.id);
  for (const id of ['npm:@afipsdk/afip.js', 'npm:mercadopago', 'npm:openai', 'npm:@anthropic-ai/sdk', 'ai:OpenAI', 'ai:Anthropic']) assert.ok(ids.includes(id), id);
  assert.ok(inv.apis.find((a) => a.id === 'npm:mercadopago').packs.includes('mercadopago.payments-to-orders'));
});

test('manifiestos: composer.json y requirements.txt se listan (sin analizar el código)', () => {
  assert.deepEqual(parseRequirements('stripe==7.0\n# comentario\nrequests>=2\n-r otros.txt\nboto3[crt]\nhttps://x/y.whl\n'), { stripe: '==7.0', requests: '>=2', boto3: '*' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-inv-'));
  fs.writeFileSync(path.join(tmp, 'composer.json'), JSON.stringify({ require: { php: '>=8.1', 'ext-json': '*', 'afipsdk/afip.php': '^1.2', 'guzzlehttp/guzzle': '^7' } }));
  fs.writeFileSync(path.join(tmp, 'requirements.txt'), 'openai==1.50\nrequests\n');
  const inv = run(tmp).inventory;
  assert.deepEqual(inv.apis.map((a) => a.id), ['composer:afipsdk/afip.php', 'pypi:openai']);
  assert.deepEqual(Object.keys(inv.dependencies.composer), ['afipsdk/afip.php', 'guzzlehttp/guzzle']);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('CLI: scan escribe inventory.json con schemaVersion y el reporte con la tabla de APIs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-scan-'));
  fs.cpSync(path.join(EXAMPLES, 'saas-demo'), tmp, { recursive: true });
  const out = execFileSync('node', [path.join(HERE, '..', 'bin', 'parche.js'), 'scan', tmp], { encoding: 'utf8' });
  assert.match(out, /APIs del repo \(8\)/);
  assert.match(out, /HTTP {2}GitHub · api\.github\.com/);
  const inv = JSON.parse(fs.readFileSync(path.join(tmp, '.parche', 'inventory.json'), 'utf8'));
  assert.equal(inv.schemaVersion, 1);
  const report = fs.readFileSync(path.join(tmp, '.parche', 'report.md'), 'utf8');
  assert.match(report, /\| SDK \| Stripe · stripe \| pagos \| alta \|/);
  assert.match(report, /Llamadas HTTP con URL dinámica/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
