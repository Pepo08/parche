// Pack de IA al día con las fuentes oficiales, leídas el 4/11/2026: developers.openai.com/api/docs/deprecations (y la página
// de cada modelo), platform.claude.com/docs/en/about-claude/model-deprecations, "Migrating to API version 2026-10-21",
// "Fast mode" y las release notes de Anthropic. Una fila por sección de la página. Código inventado, sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ai from '../src/detectors/ai-model-retirements.js';
import { loadPacks } from '../src/packs.js';

const AI = loadPacks().find((p) => p.id === 'ai.model-retirements');
const TODAY = '2026-11-04';
const scan = (source, file = 'x.js', { today = TODAY, context } = {}) => ai({ source, file, pack: AI, today, context }).findings;
const OPENAI = "import OpenAI from 'openai';\n";
const ctx = (eco, pkg, version, source = 'package-lock.json', range) => ({ versions: { npm: {}, composer: {}, pypi: {}, [eco]: { [pkg]: { version, source, ...(range ? { range } : {}) } } } });

test('pack: fuente y fecha de verificación al día, con el resumen también en inglés', () => {
  assert.equal(AI.last_verified, '2026-11-04');
  assert.equal(AI.detect.fast_mode.last_verified, '2026-11-04');
  assert.match(AI.summary_en, /no longer work/);
  for (const url of ['https://platform.claude.com/docs/en/build-with-claude/fast-mode', 'https://developers.openai.com/api/docs/models/gpt-4o-mini']) {
    assert.ok(AI.sources.some((s) => s.url === url), url);
  }
  // El resumen semanal toma la primera fuente de cada proveedor: tienen que seguir siendo las páginas de deprecaciones.
  assert.equal(AI.sources.find((s) => s.title.startsWith('Anthropic:')).url, 'https://platform.claude.com/docs/en/about-claude/model-deprecations');
  assert.equal(AI.sources.find((s) => s.title.startsWith('OpenAI:')).url, 'https://developers.openai.com/api/docs/deprecations');
});

// Los IDs que la página nombra y el pack no tenía. Los que se apagan en el futuro.
const FUTURE = [
  ['2027-04-01', '`gpt-6-sol`', ['gpt-5.1-2025-11-13']],
  ['2027-04-01', '`gpt-6-luna`', ['gpt-5.4-nano-2026-03-17']],
  ['2027-02-26', '`gpt-live-transcribe o gpt-transcribe`', ['gpt-4o-mini-transcribe-2025-12-15']],
  ['2027-01-20', '`gpt-audio-1.5`', ['gpt-4o-audio', 'gpt-4o-mini-audio']],
  ['2027-01-20', '`gpt-realtime-2.1`', ['gpt-4o-realtime']],
  ['2027-01-20', '`gpt-realtime-2.1-mini`', ['gpt-4o-mini-realtime']],
  ['2027-01-06', '`gpt-realtime-2.1-mini`', ['gpt-4o-mini-tts']],
  ['2026-12-11', '`gpt-5.6-sol`', ['gpt-5']],
  ['2026-12-11', '`gpt-5.6-terra`', ['gpt-5-mini']],
  ['2026-12-11', '`gpt-5.6-luna`', ['gpt-5-nano']],
  ['2026-12-11', '`gpt-5.6-sol (reasoning.mode: pro)`', ['gpt-5-pro', 'o3-pro']],
  ['2026-12-01', '`gpt-image-2.5-sunburst o gpt-image-2.5-flare`', ['gpt-image-1.5-2025-12-16']],
];
for (const [date, repl, ids] of FUTURE) {
  for (const id of ids) {
    test(`OpenAI: ${id} se retira el ${date}, con el reemplazo de la página`, () => {
      const [f, ...rest] = scan(`await openai.responses.create({ model: '${id}' });`);
      assert.equal(rest.length, 0, 'un solo aviso: el snapshot y el alias no se pisan');
      assert.equal(f.status, 'detect-only');
      assert.ok(f.message.startsWith(`El modelo \`${id}\` se retira el ${date}. Reemplazo recomendado: ${repl}.`), f.message);
      assert.deepEqual([f.due, f.dueKind, f.provider], [date, 'retirement', 'OpenAI']);
    });
  }
}

// Lo que OpenAI apagó antes de 2026. Sin las palabras comunes (`ada`, `babbage`, `curie`, `davinci`).
const PAST = {
  '2025-10-27': { 'o1-mini': 'o4-mini', 'text-moderation-007': 'omni-moderation', 'text-moderation-stable': 'omni-moderation', 'text-moderation-latest': 'omni-moderation' },
  '2025-10-10': { 'gpt-4o-realtime-preview-2024-10-01': 'gpt-realtime-1.5', 'gpt-4o-audio-preview-2024-10-01': 'gpt-audio-1.5' },
  '2025-07-28': { 'o1-preview': 'o3' },
  '2025-07-14': { 'gpt-4.5-preview': 'gpt-4.1' },
  '2025-06-06': { 'gpt-4-32k': 'gpt-4o', 'gpt-4-32k-0613': 'gpt-4o', 'gpt-4-32k-0314': 'gpt-4o' },
  '2024-12-06': { 'gpt-4-vision-preview': 'gpt-4o', 'gpt-4-1106-vision-preview': 'gpt-4o' },
  '2024-09-13': { 'gpt-3.5-turbo-0301': 'gpt-3.5-turbo', 'gpt-3.5-turbo-0613': 'gpt-3.5-turbo', 'gpt-3.5-turbo-16k-0613': 'gpt-3.5-turbo' },
  '2024-01-04': { 'text-davinci-003': 'gpt-3.5-turbo-instruct', 'text-ada-001': 'gpt-3.5-turbo-instruct', 'code-davinci-002': 'gpt-3.5-turbo-instruct', 'text-davinci-edit-001': 'gpt-4o', 'text-similarity-ada-001': 'text-embedding-3-small', 'code-search-babbage-text-001': 'text-embedding-3-small' },
  '2023-03-23': { 'code-davinci-001': 'gpt-4o', 'code-cushman-002': 'gpt-4o' },
};
for (const [date, ids] of Object.entries(PAST)) {
  test(`OpenAI: lo apagado el ${date} ya falla y dice el reemplazo de la página`, () => {
    for (const [id, repl] of Object.entries(ids)) {
      const [f] = scan(`await openai.responses.create({ model: '${id}' });`);
      assert.ok(f.message.startsWith(`El modelo \`${id}\` fue retirado el ${date}: las llamadas ya fallan. Reemplazo recomendado: \`${repl}\`.`), f.message);
    }
  });
}

test('un reemplazo que también tiene fecha se dice: nunca se recomienda un modelo apagado en silencio', () => {
  assert.match(scan("model: 'o1-mini',")[0].message, /Reemplazo recomendado: `o4-mini`\. Ojo: `o4-mini` también fue retirado el 2026-10-23; su reemplazo es `gpt-5\.6-terra`\./);
  assert.match(scan("model: 'o1-preview',")[0].message, /Ojo: `o3` también se retira el 2026-12-11; su reemplazo es `gpt-5\.6-sol`\./);
  assert.match(scan("model: 'text-davinci-003',")[0].message, /Ojo: `gpt-3\.5-turbo-instruct` también fue retirado el 2026-09-28; su reemplazo es `gpt-5\.6-terra`\./);
  // También por un alias (`gpt-4o` → su snapshot), y con el reemplazo que da la página en una lista.
  assert.match(scan("model: 'gpt-4-32k',")[0].message, /Ojo: `gpt-4o` también se retira el 2027-01-14; su reemplazo es `gpt-6-luna`\./);
  const dalle = scan("model: 'dall-e-3',")[0].message;
  assert.match(dalle, /Reemplazo recomendado: `gpt-image-2, gpt-image-1 o gpt-image-1-mini`\. Ojo: `gpt-image-1` también fue retirado el 2026-10-23; su reemplazo es `gpt-image-2\.5-sunburst o gpt-image-2\.5-flare`\. `gpt-image-1-mini` también se retira el 2026-12-01;/);
  // Sin fecha propia, sin "Ojo".
  assert.doesNotMatch(scan("model: 'gpt-4-0613',")[0].message, /Ojo/);
  assert.doesNotMatch(scan("model: 'tts-1',")[0].message, /Ojo/);
});

test('ningún reemplazo termina en un modelo apagado después de seguir la cadena una vez', () => {
  const { retired_models: retired, model_aliases: aliases } = AI.detect;
  const dated = (id) => retired[id] ?? (aliases[id] ? retired[aliases[id].target ?? aliases[id]] : null);
  const ids = (e) => (e?.replacement || '').split(/,\s*|\s+o\s+/).map((x) => x.replace(/\s*\(.*$/, '').trim()).filter(Boolean);
  for (const [id, e] of Object.entries(retired)) {
    for (const r of ids(e)) for (const next of ids(dated(r))) assert.ok(!dated(next), `${id} → ${r} → ${next}`);
  }
});

test('las palabras comunes que no son solo un modelo: `ada`, `curie`, `babbage` y `davinci` no se avisan; `o1` y `o3` piden contexto', () => {
  for (const word of ['ada', 'babbage', 'curie', 'davinci']) {
    assert.ok(!(word in AI.detect.retired_models), word);
    assert.deepEqual(scan(`const nombres = ['${word}'];`), []);
  }
  // El ozono de una app de calidad del aire no es un modelo de OpenAI.
  assert.deepEqual(scan("const CONTAMINANTES = ['pm25', 'o3', 'no2', 'o1'];"), []);
  assert.match(scan("const r = await run({ model: 'o3' });")[0].message, /^El modelo `o3` se retira el 2026-12-11\./);
  assert.match(scan(`${OPENAI}const MODELOS = ['o3'];`)[0].message, /^Aparece `o3` \(se retira el 2026-12-11\) fuera de una llamada/);
  assert.match(scan("const r = await run({ model: 'o1' });")[0].message, /^El modelo `o1` fue retirado el 2026-10-23/);
});

for (const [alias, snapshot] of [['gpt-4o', 'gpt-4o-2024-08-06'], ['gpt-4o-mini', 'gpt-4o-mini-2024-07-18'], ['gpt-4.1', 'gpt-4.1-2025-04-14'], ['gpt-4.1-mini', 'gpt-4.1-mini-2025-04-14']]) {
  test(`OpenAI: el alias ${alias} se avisa por su snapshot y dice que la fecha es la del snapshot`, () => {
    const [f, ...rest] = scan(`await openai.responses.create({ model: '${alias}' });`);
    assert.equal(rest.length, 0);
    assert.ok(f.message.startsWith(`El modelo \`${alias}\` (alias de \`${snapshot}\`) se retira el 2027-01-14. Reemplazo recomendado: \`gpt-6-luna\`. OpenAI marca el alias como Deprecated y ese día apaga`), f.message);
    assert.match(f.message, /no publicó una fecha aparte para el alias\./);
    assert.deepEqual([f.due, f.subject, f.provider], ['2027-01-14', `modelo \`${alias}\``, 'OpenAI']);
    // Azure tiene su propio calendario: la fecha de OpenAI no rige.
    assert.deepEqual(scan(`const c = new AzureOpenAI({}); await c.responses.create({ model: '${alias}' });`), []);
  });
}

test('OpenAI: los alias no se confunden con IDs que empiezan igual', () => {
  for (const id of ['gpt-4o-mini-search-preview', 'gpt-4.1-nano-x', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-luna', 'gpt-5-codex-mini', 'gpt-4o-2024']) {
    assert.deepEqual(scan(`model: '${id}',`), [], id);
  }
});

const CLAUDE_ALIASES = {
  'claude-3-5-sonnet-latest': ['claude-3-5-sonnet-20241022', '2025-10-28', 'claude-sonnet-5-5'],
  'claude-3-7-sonnet-latest': ['claude-3-7-sonnet-20250219', '2026-02-19', 'claude-sonnet-5-5'],
  'claude-3-5-haiku-latest': ['claude-3-5-haiku-20241022', '2026-02-19', 'claude-haiku-4-5-20251001'],
  'claude-3-opus-latest': ['claude-3-opus-20240229', '2026-01-05', 'claude-opus-4-8'],
  'claude-sonnet-4-0': ['claude-sonnet-4-20250514', '2026-06-15', 'claude-sonnet-5-5'],
  'claude-4-sonnet-20250514': ['claude-sonnet-4-20250514', '2026-06-15', 'claude-sonnet-5-5'],
  'claude-opus-4-0': ['claude-opus-4-20250514', '2026-06-15', 'claude-opus-4-8'],
  'claude-4-opus-20250514': ['claude-opus-4-20250514', '2026-06-15', 'claude-opus-4-8'],
  'claude-opus-4-1': ['claude-opus-4-1-20250805', '2026-08-05', 'claude-opus-4-8'],
};
for (const [alias, [snapshot, date, repl]] of Object.entries(CLAUDE_ALIASES)) {
  test(`Anthropic: el alias ${alias} ya falla, con la fecha de ${snapshot}`, () => {
    const [f, ...rest] = scan(`await client.messages.create({ model: '${alias}', max_tokens: 9, messages: [] });`);
    assert.equal(rest.length, 0);
    assert.equal(f.message, `El modelo \`${alias}\` (alias de \`${snapshot}\`) fue retirado el ${date}: las llamadas ya fallan. Reemplazo recomendado: \`${repl}\`. Corré tus pruebas de prompts antes de cambiarlo.`);
  });
}

test('Anthropic: un alias que nadie documenta no se avisa, y Bedrock o Google Cloud tienen su calendario', () => {
  for (const id of ['claude-sonnet-4-5-latest', 'claude-3-5-sonnet', 'anthropic.claude-opus-4-1-20250805-v1:0', 'claude-opus-4-1@20250805']) {
    assert.deepEqual(scan(`model: '${id}',`), [], id);
  }
});

test('OpenAI: crear un trabajo de fine-tuning se termina el 6/1/2027; lo que ya existe sigue andando', () => {
  const ts = scan(`${OPENAI}await client.fineTuning.jobs.create({ model: 'x', training_file: 'y' });`, 'a.ts');
  assert.equal(ts[0].message, '`fineTuning.jobs.create` pertenece a la creación de trabajos de fine-tuning de OpenAI, que cierra el 2027-01-06. Desde el 2026-07-02 no pueden crearlos las organizaciones sin inferencia sobre un modelo fine-tuned en los últimos 60 días. Reemplazo: OpenAI no indica ninguno. Los modelos fine-tuned ya creados siguen respondiendo hasta que se retire su modelo base.');
  assert.deepEqual([ts[0].due, ts[0].provider], ['2027-01-06', 'OpenAI']);
  assert.match(scan('from openai import OpenAI\nclient.fine_tuning.jobs.create(model="x", training_file="y")\n', 'a.py')[0].message, /^`fine_tuning\.jobs\.create` pertenece a/);
  // Sin el SDK de OpenAI en el archivo no se avisa, y consultar un trabajo no es crearlo.
  assert.deepEqual(scan('await otro.fineTuning.jobs.create({});', 'a.ts'), []);
  assert.deepEqual(scan(`${OPENAI}await client.fineTuning.jobs.retrieve('x');`, 'a.ts'), []);
});

test('endpoints: con el host de OpenAI se avisan; la misma ruta en otra API, no (D61)', () => {
  const cases = {
    'https://api.openai.com/v1/audio/translations': /de OpenAI, que cierra el 2027-02-26\. Reemplazo: `v1\/realtime\/translations`\./,
    'https://api.openai.com/v1/engines/davinci/completions': /API de Engines de OpenAI, cerrada el 2022-12-03\. Reemplazo: `\/v1\/models`\./,
    'https://api.openai.com/v1/edits': /API de Edits de OpenAI, cerrada el 2024-01-04\. Reemplazo: `\/v1\/chat\/completions`\./,
    'https://api.openai.com/v1/fine-tunes': /cerrada el 2024-01-04\. Reemplazo: `\/v1\/fine_tuning\/jobs`\./,
    'https://api.openai.com/v1/search': /cerrada el 2022-12-03\. Reemplazo: la guía de transición de OpenAI \(https:\/\/help\.openai\.com\/en\/articles\/6272952/,
  };
  for (const [url, re] of Object.entries(cases)) assert.match(scan(`await fetch('${url}');`)[0].message, re, url);
  for (const url of ['https://api.groq.com/openai/v1/audio/translations', 'https://api.ejemplo.com/v1/search', 'https://api.ejemplo.com/v1/edits', 'https://api.openai.com/v1/realtime/translations', 'https://api.openai.com/v1/fine_tuning/jobs']) {
    assert.deepEqual(scan(`await fetch('${url}');`), [], url);
  }
  assert.match(scan("const h = { 'OpenAI-Beta': 'assistants=v1' };")[0].message, /Assistants API beta v1 de OpenAI, cerrada el 2024-12-18\. Reemplazo: Responses API \+ Conversations API/);
  assert.deepEqual(scan("const h = { 'OpenAI-Beta': 'assistants=v2' };"), []);
});

test('Anthropic: las herramientas experimentales de prompts cerraron; el aviso dice de quién son', () => {
  for (const name of ['generate_prompt', 'improve_prompt', 'templatize_prompt']) {
    const r = ai({ source: `await fetch('https://api.anthropic.com/v1/experimental/${name}');`, file: 'x.js', pack: AI, today: TODAY });
    assert.equal(r.findings[0].message, `\`/v1/experimental/${name}\` pertenece a la API experimental de herramientas de prompts de Anthropic, cerrada el 2026-08-17. Reemplazo: Anthropic no indica ninguno.`);
    assert.deepEqual([r.findings[0].due, r.findings[0].provider], ['2026-08-17', 'Anthropic']);
    assert.equal(r.usages[0].op, 'Anthropic API experimental de herramientas de prompts');
  }
});

// `document` directo en `assistant` y `citations` en `user` (API version 2026-10-21).
const onlyContent = (fs) => fs.filter((f) => /`type: |`type=|`citations`/.test(f.message));
const DOC_TS = `import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();
await client.messages.create({
  model: 'claude-sonnet-5-5', max_tokens: 9,
  messages: [
    { role: 'user', content: 'hola' },
    { role: 'assistant', content: [{ type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'x' } }] },
  ],
});
`;
const CITE_TS = `import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();
await client.messages.create({
  model: 'claude-sonnet-5-5', max_tokens: 9,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'x', citations: [{ type: 'char_location', cited_text: 'x' }] }] }],
});
`;
const DOC_REMOVED = 'esa versión de la API devuelve un error 400 si un bloque `document` va directo en un mensaje de `assistant`';
const CITE_REMOVED = 'esa versión de la API devuelve un error 400 si un bloque `text` de un mensaje de `user` trae `citations` con contenido, también dentro de un `search_result`';

test('API 2026-10-21: `document` en `assistant` con el SDK 1.0 ya falla, y se dice dónde va', () => {
  const r = ai({ source: DOC_TS, file: 'a.ts', pack: AI, today: TODAY, context: ctx('npm', '@anthropic-ai/sdk', '1.2.0') });
  const [f] = onlyContent(r.findings);
  assert.equal(f.message, `\`type: 'document'\` en un mensaje de \`assistant\` ya no funciona con \`@anthropic-ai/sdk\` 1.2.0 (según package-lock.json): desde la 1.0.0, el SDK usa la API version \`2026-10-21\`, y ${DOC_REMOVED}. Mandá el documento en un mensaje de \`user\`.`);
  assert.equal(f.line, 7);
  assert.equal(f.status, 'detect-only');
  assert.ok(r.usages.some((u) => u.op === 'Anthropic document en assistant (API version 2026-10-21)'));
  assert.equal(r.output, null, 'solo detección');
});

test('API 2026-10-21: `citations` en `user` con el SDK viejo avisa antes de la suba; con rango abierto, en una instalación nueva; sin versión, lo dice', () => {
  const viejo = onlyContent(scan(CITE_TS, 'a.ts', { context: ctx('npm', '@anthropic-ai/sdk', '0.90.0') }));
  assert.equal(viejo[0].message, `\`citations\` en un mensaje de \`user\` funciona con \`@anthropic-ai/sdk\` 0.90.0 (según package-lock.json), pero va a fallar cuando lo subas a la 1.0.0 (del 21/10/2026): desde la 1.0.0, el SDK usa la API version \`2026-10-21\`, y ${CITE_REMOVED}. Antes de aceptar esa suba, sacá \`citations\` de esos bloques.`);
  const abierto = onlyContent(scan(CITE_TS, 'a.ts', { context: ctx('npm', '@anthropic-ai/sdk', '0.90.0', 'declarada', '>=0.90.0') }));
  assert.match(abierto[0].message, /^`citations` en un mensaje de `user` falla en una instalación nueva: `@anthropic-ai\/sdk` está declarado como `>=0\.90\.0`, que ya deja instalar la 1\.0\.0/);
  const sinVersion = onlyContent(scan(CITE_TS, 'a.ts'));
  assert.match(sinVersion[0].message, /^`citations` en un mensaje de `user` falla con `@anthropic-ai\/sdk` 1\.0\.0 o posterior: .* Parche no encontró qué versión del SDK usa este repo/);
});

test('API 2026-10-21: lo que sigue valiendo no se avisa', () => {
  const context = ctx('npm', '@anthropic-ai/sdk', '1.2.0');
  const request = (messages) => `import Anthropic from '@anthropic-ai/sdk';\nawait client.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 9, messages: ${messages} });\n`;
  for (const messages of [
    // Un documento en `user`, y anidado en otro bloque de `assistant`.
    "[{ role: 'user', content: [{ type: 'document', source: {} }] }]",
    "[{ role: 'assistant', content: [{ type: 'web_fetch_tool_result', content: { type: 'web_fetch_result', content: { type: 'document', source: {} } } }] }]",
    // `citations` en `assistant`, vacío, la configuración de un documento o de un resultado de búsqueda, y una variable.
    "[{ role: 'assistant', content: [{ type: 'text', text: 'x', citations: [{ type: 'char_location' }] }] }]",
    "[{ role: 'user', content: [{ type: 'text', text: 'x', citations: [] }] }]",
    "[{ role: 'user', content: [{ type: 'document', source: {}, citations: { enabled: true } }] }]",
    "[{ role: 'user', content: [{ type: 'search_result', source: 'u', title: 't', content: [{ type: 'text', text: 'x' }], citations: { enabled: true } }] }]",
    "[{ role: 'user', content: [{ type: 'text', text: 'x', citations: previas }] }]",
    // Un rol o unos mensajes que no se pueden leer.
    "[{ role: quien, content: [{ type: 'document', source: {} }] }]",
    'historial',
  ]) {
    assert.deepEqual(onlyContent(scan(request(messages), 'a.ts', { context })), [], messages);
  }
  // Un archivo que fija 2023-06-01 eligió quedarse, y por HTTP sin el header nuevo la versión no cambia sola.
  const fijo = DOC_TS.replace('const client = new Anthropic();', "const client = new Anthropic({ defaultHeaders: { 'anthropic-version': '2023-06-01' } });");
  assert.deepEqual(onlyContent(scan(fijo, 'a.ts', { context })), []);
  const http = `const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 9, messages: [{ role: 'assistant', content: [{ type: 'document' }] }] }) });`;
  assert.deepEqual(onlyContent(scan(http, 'a.js')), []);
});

test('API 2026-10-21: también dentro de un `search_result`, de un `tool_result`, por HTTP con el header y en una constante', () => {
  const context = ctx('npm', '@anthropic-ai/sdk', '1.0.0');
  const anidado = `import Anthropic from '@anthropic-ai/sdk';
await client.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 9, messages: [{ role: 'user', content: [
  { type: 'search_result', source: 'u', title: 't', citations: { enabled: true }, content: [{ type: 'text', text: 'x', citations: [{ type: 'search_result_location' }] }] },
  { type: 'tool_result', tool_use_id: 'a', content: [{ type: 'search_result', source: 'u', title: 't', content: [{ type: 'text', text: 'y', citations: [{ type: 'search_result_location' }] }] }] },
] }] });
`;
  assert.deepEqual(onlyContent(scan(anidado, 'a.js', { context })).map((f) => f.line), [3, 4]);
  const http = `const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'anthropic-version': '2026-10-21' }, body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 9, messages: [{ role: 'assistant', content: [{ type: 'document' }] }] }) });`;
  assert.equal(onlyContent(scan(http, 'a.js'))[0].message, `\`type: 'document'\` en un mensaje de \`assistant\` ya no funciona: el archivo manda \`anthropic-version: 2026-10-21\`, y ${DOC_REMOVED}. Mandá el documento en un mensaje de \`user\`.`);
  const constante = `import Anthropic from '@anthropic-ai/sdk';
const mensajes = [
  { role: 'assistant', content: [{ type: 'document', source: {} }] },
];
await client.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 9, messages: mensajes });
`;
  assert.deepEqual(onlyContent(scan(constante, 'a.js', { context })).map((f) => f.line), [3]);
});

test('API 2026-10-21: en Python, desde la 2.0.0 del SDK, y sin el error de firma de los parámetros', () => {
  const py = `import anthropic
client.messages.create(
    model="claude-sonnet-5-5", max_tokens=9,
    messages=[{"role": "assistant", "content": [{"type": "document", "source": {}}]},
              {"role": "user", "content": [{"type": "text", "text": "x", "citations": [{"type": "char_location"}]}]}],
)
`;
  const nuevo = onlyContent(scan(py, 'a.py', { context: ctx('pypi', 'anthropic', '2.0.0', 'requirements.txt') }));
  assert.deepEqual(nuevo.map((f) => f.line), [4, 5]);
  assert.match(nuevo[0].message, /^`type: "document"` en un mensaje de `assistant` ya no funciona con `anthropic` 2\.0\.0 \(según requirements\.txt\)/);
  const anterior = onlyContent(scan(py, 'a.py', { context: ctx('pypi', 'anthropic', '1.5.0', 'requirements.txt') }));
  assert.match(anterior[0].message, /funciona con `anthropic` 1\.5\.0 \(según requirements\.txt\), pero va a fallar cuando lo subas a la 2\.0\.0/);
  assert.doesNotMatch(anterior[0].message, /TypeError/);
});

test('API 2026-10-21: un archivo que no es de Anthropic no se toca', () => {
  const otro = `await otro.messages.create({ messages: [{ role: 'assistant', content: [{ type: 'document' }] }] });`;
  assert.deepEqual(scan(otro, 'a.js'), []);
});

test('fast mode: en Claude Opus 4.8 se retira el 30/11/2026, con la fecha como dato', () => {
  const src = `import Anthropic from '@anthropic-ai/sdk';\nawait client.beta.messages.create({\n  model: 'claude-opus-4-8', max_tokens: 9, messages: [],\n  speed: 'fast',\n  betas: ['fast-mode-2026-02-01'],\n});\n`;
  const r = ai({ source: src, file: 'a.js', pack: AI, today: TODAY });
  const [f] = r.findings.filter((x) => x.message.startsWith('`speed'));
  assert.equal(f.message, "`speed: 'fast'` con `claude-opus-4-8`: Anthropic retira fast mode de ese modelo el 2026-11-30: después de esa fecha, esos pedidos devuelven un error. Para seguir con fast mode, migrá a `claude-opus-5-5`.");
  assert.deepEqual([f.line, f.due, f.dueKind, f.subject, f.provider], [4, '2026-11-30', 'retirement', 'fast mode en `claude-opus-4-8`', 'Anthropic']);
  assert.ok(r.usages.some((u) => u.op === 'Anthropic fast mode (claude-opus-4-8)'));
  const despues = ai({ source: src, file: 'a.js', pack: AI, today: '2026-11-30' }).findings.find((x) => x.message.startsWith('`speed'));
  assert.equal(despues.message, "`speed: 'fast'` con `claude-opus-4-8`: Anthropic retiró fast mode de ese modelo el 2026-11-30: esos pedidos devuelven un error. Para seguir con fast mode, migrá a `claude-opus-5-5`.");
});

test('fast mode: Opus 4.7 ya da error, Opus 4.6 corre sin fast mode, y lo soportado no se avisa', () => {
  const py = (model, speed = 'fast') => `import anthropic\nclient.messages.create(model="${model}", max_tokens=9, speed="${speed}", messages=[])\n`;
  const of = (src) => scan(src, 'a.py').filter((x) => x.message.startsWith('`speed'));
  assert.match(of(py('claude-opus-4-7'))[0].message, /^`speed="fast"` con `claude-opus-4-7`: Anthropic retiró fast mode de ese modelo el 2026-07-24: esos pedidos devuelven un error\./);
  assert.match(of(py('claude-opus-4-6'))[0].message, /el 2026-06-29: esos pedidos no fallan, pero corren a velocidad estándar\./);
  assert.deepEqual(of(py('claude-opus-5-5')), []);
  assert.deepEqual(of(py('claude-opus-5')), []);
  assert.deepEqual(of(py('claude-opus-4-8', 'standard')), []);
  // Si el modelo no se puede leer, no se avisa (D64).
  assert.deepEqual(of('import anthropic\nclient.messages.create(model=config.modelo, max_tokens=9, speed="fast", messages=[])\n'), []);
});

test('la pasada rápida no cambia qué se avisa: cada ID del pack se ve con las tres comillas, y las comillas mezcladas no cuentan', () => {
  const { retired_models: retired, model_aliases: aliases } = AI.detect;
  for (const id of [...Object.keys(retired), ...Object.keys(aliases)]) {
    for (const q of ["'", '"', '`']) {
      const found = scan(`const m = await run({ model: ${q}${id}${q} });`).some((f) => f.message.includes(`\`${id}\``));
      assert.ok(found, `${q}${id}${q}`);
    }
  }
  assert.deepEqual(scan(`const m = "'gpt-4" + 'gpt-4"';`), []);
  // Un ID dentro de otro string entre comillas también se ve, como antes de la pasada rápida.
  assert.equal(scan(`const m = "usar 'gpt-4' siempre";`).length, 1);
});

test('pack: ningún modelo sin fecha se carga con una inventada', () => {
  // `claude-mythos-preview` figura Deprecated con "To be announced": sin fecha no entra a la lista de retiros.
  assert.ok(!('claude-mythos-preview' in AI.detect.retired_models));
  for (const [id, e] of Object.entries(AI.detect.retired_models)) assert.match(typeof e === 'string' ? e : e.date, /^\d{4}-\d{2}-\d{2}$/, id);
});
