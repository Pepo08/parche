// Pack de IA: alias de Anthropic de antes de la generación 4.6. `claude-sonnet-4-5` apunta a `claude-sonnet-4-5-20250929`,
// que se retira el 30/11/2026 (páginas "Model IDs and versioning", "Claude Sonnet 4.5" y de deprecaciones, verificadas el
// 22/10/2026); `claude-opus-4-5` y `claude-haiku-4-5`, a snapshots con fecha mínima de retiro. Sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ai from '../src/detectors/ai-model-retirements.js';
import { loadPacks } from '../src/packs.js';

const AI = loadPacks().find((p) => p.id === 'ai.model-retirements');
const TODAY = '2026-10-22';
const scan = (source, file = 'src/chat.js', today = TODAY) => ai({ source, file, pack: AI, today });
const messages = (source, ...rest) => scan(source, ...rest).findings.map((f) => [f.line, f.message]);

const SONNET = 'El modelo `claude-sonnet-4-5` (alias de `claude-sonnet-4-5-20250929`) se retira el 2026-11-30. Reemplazo recomendado: `claude-sonnet-5-5`. Corré tus pruebas de prompts antes de cambiarlo.';

test('alias claude-sonnet-4-5 en una llamada: se avisa con la fecha y el reemplazo de su snapshot', () => {
  const source = [
    "import Anthropic from '@anthropic-ai/sdk';",
    'const client = new Anthropic();',
    "export const r = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 100, messages: [] });",
  ].join('\n');
  const { findings, usages } = scan(source);
  assert.deepEqual(findings.map((f) => [f.line, f.message]), [[3, SONNET]]);
  assert.deepEqual(usages.filter((u) => u.op.startsWith('modelo')).map((u) => u.op), ['modelo claude-sonnet-4-5']);
});

test('alias claude-sonnet-4-5 después del 30/11: ya falla', () => {
  assert.deepEqual(messages("const MODEL = 'claude-sonnet-4-5';\nclient.messages.create({ model: MODEL });", 'src/chat.js', '2026-12-01'), [
    [1, 'El modelo `claude-sonnet-4-5` (alias de `claude-sonnet-4-5-20250929`) fue retirado el 2026-11-30: las llamadas ya fallan. Reemplazo recomendado: `claude-sonnet-5-5`. Corré tus pruebas de prompts antes de cambiarlo.'],
  ]);
});

test('alias fuera de una llamada (lista de modelos): se avisa como mención', () => {
  assert.deepEqual(messages("export const OPCIONES = ['claude-sonnet-4-5', 'claude-sonnet-5-5'];"), [
    [1, 'Aparece `claude-sonnet-4-5` (alias de `claude-sonnet-4-5-20250929`, se retira el 2026-11-30) fuera de una llamada: si es una lista o un catálogo de modelos, actualizalo. Reemplazo recomendado: `claude-sonnet-5-5`.'],
  ]);
});

test('el ID fechado se avisa una sola vez y sin "alias de"', () => {
  const found = messages("client.messages.create({ model: 'claude-sonnet-4-5-20250929' });");
  assert.equal(found.length, 1);
  assert.equal(found[0][1], 'El modelo `claude-sonnet-4-5-20250929` se retira el 2026-11-30. Reemplazo recomendado: `claude-sonnet-5-5`. Corré tus pruebas de prompts antes de cambiarlo.');
});

test('no se marcan los IDs de Bedrock ni de Google Cloud (tienen su calendario), ni modelos parecidos', () => {
  const source = [
    "bedrock.invoke({ modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0' });",
    "bedrock.invoke({ modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' });",
    "vertex.messages.create({ model: 'claude-sonnet-4-5@20250929' });",
    "client.messages.create({ model: 'claude-sonnet-4-6' });",
    "client.messages.create({ model: 'claude-sonnet-4-5-latest' });",
    '// claude-sonnet-4-5 sin comillas, en un comentario',
  ].join('\n');
  assert.deepEqual(messages(source), []);
});

test('alias de Opus 4.5 y Haiku 4.5: fecha mínima de retiro de su snapshot, una vez por línea', () => {
  const source = [
    "client.messages.create({ model: 'claude-opus-4-5' });",
    "client.messages.create({ model: 'claude-haiku-4-5' });",
    "client.messages.create({ model: 'claude-haiku-4-5-20251001' });",
  ].join('\n');
  assert.deepEqual(messages(source), [
    [1, 'El modelo `claude-opus-4-5` (alias de `claude-opus-4-5-20251101`) puede retirarse a partir del 2026-11-24 (fecha mínima publicada; hay 60 días de aviso). Planificá el reemplazo.'],
    [2, 'El modelo `claude-haiku-4-5` (alias de `claude-haiku-4-5-20251001`) puede retirarse a partir del 2026-10-15 (fecha mínima publicada; hay 60 días de aviso). Planificá el reemplazo.'],
    [3, 'El modelo `claude-haiku-4-5-20251001` puede retirarse a partir del 2026-10-15 (fecha mínima publicada; hay 60 días de aviso). Planificá el reemplazo.'],
  ]);
});

test('Python con comillas dobles y archivo con CRLF', () => {
  const source = 'import anthropic\r\nclient = anthropic.Anthropic()\r\nr = client.messages.create(model="claude-sonnet-4-5", max_tokens=100, messages=[])\r\n';
  assert.deepEqual(messages(source, 'resumen.py'), [[3, SONNET]]);
});
