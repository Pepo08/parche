// Pack de IA: la API version `2026-10-21` de Anthropic elimina `temperature`, `top_p` y `top_k` para cualquier modelo
// (platform.claude.com/docs/en/api/migration-2026-10-21 y la página de deprecaciones, verificadas el 21/10/2026). La
// mandan el header `anthropic-version` y los SDK desde su versión mayor nueva (TypeScript 1.0.0 y Python 2.0.0, del
// 21/10/2026); el SDK de Python 1.0 ya tira `TypeError` con el parámetro directo (su MIGRATION.md). Fixtures, sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ai from '../src/detectors/ai-model-retirements.js';
import { loadPacks } from '../src/packs.js';
import { run } from '../src/engine.js';
import { openRange, readVersions } from '../src/context.js';
import { readManifests } from '../src/inventory/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'ia-api-2026-10-21');
const AI = loadPacks().find((p) => p.id === 'ai.model-retirements');
const TODAY = '2026-10-21';

// Solo los avisos de este cambio: empiezan por el parámetro y no son los de Claude 4.7 ("con el modelo … da un error 400:").
const apiVersion = (findings) => findings.filter((f) => /^`(?:temperature|top_p|top_k)\b/.test(f.message) && !/ dan? un error 400: /.test(f.message));
const scanRepo = (repo) => run(path.join(FIX, repo), { packIds: [AI.id], today: TODAY });
const lines = (r, file) => apiVersion(r.findings.filter((f) => f.file === file)).map((f) => [f.line, f.message.match(/^`([^`]+)`/)[1]]);
const lineOf = (repo, file, needle) => fs.readFileSync(path.join(FIX, repo, file), 'utf8').split('\n').findIndex((l) => l.includes(needle)) + 1;
const ctx = (eco, pkg, version, source = 'package-lock.json', range) => ({ versions: { npm: {}, composer: {}, pypi: {}, [eco]: { [pkg]: { version, source, ...(range ? { range } : {}) } } } });
const scan = (source, file, context) => apiVersion(ai({ source, file, pack: AI, today: TODAY, context }).findings);

const OLDER = (m) => `Con \`${m}\`, que todavía acepta otros valores, sacarlo cambia cómo responde y ningún otro ajuste lo reemplaza: si dependés de ese valor, ese pedido tiene que quedarse en la API version \`2023-06-01\`.`;
const REMOVED = 'esa versión de la API eliminó `temperature`, `top_p` y `top_k`: con cualquier modelo devuelven un error 400, aunque tengan su valor por defecto.';

test('API 2026-10-21: con @anthropic-ai/sdk 1.0.0 instalado, cada parámetro falla con cualquier modelo (también con su valor por defecto)', () => {
  const r = scanRepo('ts-1');
  assert.deepEqual(lines(r, 'src/chat.ts'), [
    [lineOf('ts-1', 'src/chat.ts', 'temperature: 0.2'), 'temperature: 0.2'],
    [lineOf('ts-1', 'src/chat.ts', 'temperature: 1,'), 'temperature: 1'],
  ]);
  const [sonnet, porDefecto] = apiVersion(r.findings.filter((f) => f.file === 'src/chat.ts'));
  assert.equal(sonnet.message, `\`temperature: 0.2\` ya no funciona con \`@anthropic-ai/sdk\` 1.0.0 (según package-lock.json): desde la 1.0.0, el SDK usa la API version \`2026-10-21\`, y ${REMOVED} Sacá \`temperature\` del pedido y guiá el comportamiento del modelo con el prompt. En TypeScript, además, el SDK 1.0 ya no tiene el parámetro en sus tipos. ${OLDER('claude-sonnet-4-6')}`);
  assert.ok(!porDefecto.message.includes('todavía acepta'), 'Claude 4.7 ya muestreaba con el valor por defecto: sacarlo no cambia nada');
  assert.ok(r.findings.every((f) => f.status === 'detect-only' && f.pack === AI.id));
  assert.equal(r.changed.length, 0, 'solo detección');
  assert.ok(r.inventory.usages.some((u) => u.op === 'Anthropic temperature (API version 2026-10-21)' && u.file === 'src/chat.ts'));
});

test('API 2026-10-21: lo que ya avisó la regla de Claude 4.7 no se repite; undefined, null y None no cuentan', () => {
  const r = scanRepo('ts-1');
  const topK = r.findings.filter((f) => f.file === 'src/chat.ts' && f.line === lineOf('ts-1', 'src/chat.ts', 'top_k: 5'));
  assert.equal(topK.length, 1);
  assert.match(topK[0].message, /^`top_k: 5` con el modelo `claude-opus-4-7` da un error 400: /);
  assert.equal(r.findings.filter((f) => f.file === 'src/chat.ts' && f.line === lineOf('ts-1', 'src/chat.ts', 'temperature: undefined')).length, 0);
  const py = (v) => scan(`import anthropic\nclient.messages.create(model="claude-sonnet-4-6", max_tokens=9, temperature=${v}, messages=[])\n`, 'x.py', ctx('pypi', 'anthropic', '2.0.0'));
  assert.deepEqual(py('None'), []);
  assert.equal(py('0.2').length, 1);
});

test('API 2026-10-21: en JavaScript el modelo no hace falta y no se habla de tipos; un archivo que fija 2023-06-01 se respeta', () => {
  const r = scanRepo('ts-1');
  const [cola] = apiVersion(r.findings.filter((f) => f.file === 'src/cola.js'));
  assert.equal(cola.line, lineOf('ts-1', 'src/cola.js', 'top_p: 0.9'));
  assert.ok(!cola.message.includes('TypeScript'), 'en un .js no hay tipos');
  assert.ok(!cola.message.includes('todavía acepta'), 'sin el modelo no se sabe si cambia el comportamiento');
  assert.deepEqual(lines(r, 'src/fijado.ts'), [], '`anthropic-version: 2023-06-01` en el cliente: el repo eligió quedarse');
});

test('API 2026-10-21: con el SDK 0.x, avisa que la suba a la 1.0.0 lo rompe; con un rango sin tope, que ya falla en una instalación nueva', () => {
  const [f] = apiVersion(scanRepo('ts-0').findings);
  assert.match(f.message, /^`temperature: 0` funciona con `@anthropic-ai\/sdk` 0\.137\.0 \(según package-lock\.json\), pero va a fallar cuando lo subas a la 1\.0\.0 \(del 21\/10\/2026\): /);
  assert.match(f.message, /Antes de aceptar esa suba, sacá `temperature` del pedido/);
  assert.ok(f.message.includes('nunca garantizó respuestas idénticas'), 'con temperature 0 se aclara que nunca fue determinístico');
  const [open] = apiVersion(scanRepo('npm-abierto').findings);
  assert.match(open.message, /^`temperature: 0\.4` falla en una instalación nueva: `@anthropic-ai\/sdk` está declarado como `>=0\.30\.0`, que ya deja instalar la 1\.0\.0 \(del 21\/10\/2026\)\. /);
  assert.match(open.message, /o fijá el SDK debajo de la 1\.0\.0\./);
  assert.ok(open.message.endsWith(OLDER('claude-haiku-4-5')));
});

test('API 2026-10-21: sin la versión del SDK no dice que hoy funciona', () => {
  const [f] = scan("import Anthropic from '@anthropic-ai/sdk';\nclient.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 9, top_k: 5, messages: [] });", 'x.ts');
  assert.match(f.message, /^`top_k: 5` falla con `@anthropic-ai\/sdk` 1\.0\.0 o posterior: /);
  assert.ok(f.message.includes('Parche no encontró qué versión del SDK usa este repo: si ya es la 1.0.0 o una posterior, el pedido ya falla.'));
  assert.ok(!f.message.includes('hoy funciona'));
});

test('API 2026-10-21: Python, TypeError desde la 1.0 con el parámetro directo y error 400 desde la 2.0.0 por extra_body', () => {
  const r = scanRepo('py');
  assert.equal(r.context.versions.pypi.anthropic.version, '1.4.0', 'la versión sale de requirements.txt');
  const [directo, extra] = apiVersion(r.findings);
  assert.equal(directo.line, lineOf('py', 'src/resumen.py', 'temperature=0.2'));
  assert.match(directo.message, /^`temperature=0\.2` ya no funciona con `anthropic` 1\.4\.0 \(declarado como `==1\.4\.0`\): desde la 1\.0\.0, el SDK de Python ya no tiene `temperature`, `top_p` ni `top_k` y pasarlos tira `TypeError` con cualquier modelo\. Tampoco sirve pasarlo por `extra_body`: con la 2\.0\.0 \(del 21\/10\/2026\) devuelve un error 400\./);
  assert.equal(extra.line, lineOf('py', 'src/resumen.py', 'extra_body={'));
  assert.match(extra.message, /^`temperature: 0\.2` \(en `extra_body`\) funciona con `anthropic` 1\.4\.0 \(declarado como `==1\.4\.0`\), pero va a fallar cuando lo subas a la 2\.0\.0 \(del 21\/10\/2026\): /);
  const [open] = apiVersion(scanRepo('py-abierto').findings);
  assert.match(open.message, /^`top_k=20` falla en una instalación nueva: `anthropic` está declarado como `>=0\.40`, que ya deja instalar la 2\.0\.0 \(del 21\/10\/2026\)\. Desde la 1\.0\.0, el SDK de Python ya no tiene /);
  assert.match(open.message, /o fijá el SDK debajo de la 1\.0\.0\./);
  const [v2] = scan('import anthropic\nclient.messages.create(model="claude-sonnet-4-6", max_tokens=9, messages=[], extra_body={"top_p": 0.5})\n', 'x.py', ctx('pypi', 'anthropic', '2.0.0', 'declarada', '==2.0.0'));
  assert.match(v2.message, /^`top_p: 0\.5` \(en `extra_body`\) ya no funciona con `anthropic` 2\.0\.0 \(declarado como `==2\.0\.0`\): desde la 2\.0\.0, el SDK usa la API version `2026-10-21`/);
});

test('API 2026-10-21: HTTP directo, solo con el header nuevo (la versión la elige el archivo)', () => {
  const r = scanRepo('http');
  assert.deepEqual(lines(r, 'src/llamar.js'), [[lineOf('http', 'src/llamar.js', 'temperature: 0.7'), 'temperature: 0.7']]);
  assert.match(apiVersion(r.findings.filter((f) => f.file === 'src/llamar.js'))[0].message,
    /^`temperature: 0\.7` ya no funciona: el archivo manda `anthropic-version: 2026-10-21`, y esa versión de la API eliminó /);
  assert.deepEqual(lines(r, 'src/llamar.py'), [[lineOf('http', 'src/llamar.py', '"top_p": 0.5'), 'top_p: 0.5']]);
  assert.ok(apiVersion(r.findings.filter((f) => f.file === 'src/llamar.py'))[0].message.endsWith(OLDER('claude-opus-4-6')));
  assert.deepEqual(lines(r, 'src/viejo.js'), [], 'con 2023-06-01 y Sonnet 4.6, el parámetro se acepta');
});

test('API 2026-10-21: sin nada de Anthropic en el archivo no avisa; CRLF y tabs no corren las líneas', () => {
  const v1 = ctx('npm', '@anthropic-ai/sdk', '1.0.0');
  assert.deepEqual(scan("client.messages.create({ model: 'mistral-large-latest', max_tokens: 9, temperature: 0.2, messages: [] });", 'x.js', v1), []);
  assert.deepEqual(scan("import OpenAI from 'openai';\nopenai.chat.completions.create({ model: 'claude-sonnet-4-6', temperature: 0.2, messages: [] });", 'x.js', v1), [],
    'la capa compatible con OpenAI no es la API de Messages');
  const src = ["import Anthropic from '@anthropic-ai/sdk';", 'const c = new Anthropic();', 'export const f = () =>', '\tc.messages.create({', "\t\tmodel: 'claude-sonnet-4-6',", '\t\tmax_tokens: 9,', '\t\ttop_p: 0.8,', '\t\tmessages: [],', '\t});'];
  for (const eol of ['\n', '\r\n']) assert.deepEqual(scan(src.join(eol), 'x.ts', v1).map((f) => f.line), [7], JSON.stringify(eol));
});

test('API 2026-10-21: rangos con y sin tope, y versiones de Python desde requirements.txt', () => {
  for (const r of ['>=0.40', '>0.3', '*', 'x', 'latest', '>= 1.2']) assert.ok(openRange(r), r);
  for (const r of ['^0.137.0', '~1.2', '==1.4.0', '~=1.2', '>=0.30 <1', '>=1.2,<2', '1.0.0', '', undefined]) assert.ok(!openRange(r), String(r));
  const root = path.join(FIX, 'py');
  const v = readVersions(root, readManifests(root));
  assert.deepEqual(v.pypi.anthropic, { version: '1.4.0', source: 'declarada', range: '==1.4.0' });
  assert.equal(v.pypi.requests.version, '2.31.0');
});

test('API 2026-10-21: los datos del pack salen de las páginas oficiales', () => {
  const api = AI.detect.sampling_params.api_version;
  assert.equal(api.version, '2026-10-21');
  assert.equal(api.last_verified, '2026-10-21');
  assert.deepEqual(api.sdks.npm, { package: '@anthropic-ai/sdk', first: '1.0.0' });
  assert.deepEqual(api.sdks.pypi, { package: 'anthropic', first: '2.0.0', typeerror_from: '1.0.0' });
  for (const m of ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5']) assert.ok(api.older_models.some((p) => m.startsWith(p)), m);
  for (const m of AI.detect.sampling_params.models) assert.ok(!api.older_models.some((p) => m.startsWith(p)), `${m} solo acepta los valores por defecto`);
  for (const url of ['https://platform.claude.com/docs/en/api/migration-2026-10-21', 'https://platform.claude.com/docs/en/api/versioning',
    'https://github.com/anthropics/anthropic-sdk-python/blob/v1.0.0/MIGRATION.md']) assert.ok(AI.sources.some((s) => s.url === url), url);
});
