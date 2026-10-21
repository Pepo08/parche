// Pack de IA: `temperature`, `top_p` y `top_k` en Claude 4.7 y posteriores (platform.claude.com/docs/en/about-claude/
// model-deprecations, "API parameter deprecations", verificada el 20/10/2026). Valores aceptados: referencia de la API
// (`temperature` 1, `top_p` desde 0.99, `top_k` ninguno) y guía de Claude Haiku 5.5 (`top_p` solo 0.99, y nunca
// `temperature` y `top_p` juntos). Fixtures, sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ai from '../src/detectors/ai-model-retirements.js';
import { loadPacks } from '../src/packs.js';
import { run } from '../src/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'ia-claude-47');
const AI = loadPacks().find((p) => p.id === 'ai.model-retirements');
const TODAY = '2026-10-20';

const read = (rel) => fs.readFileSync(path.join(FIX, rel), 'utf8');
// Solo los avisos de este cambio: el resto del pack (por ejemplo, la fecha mínima de `claude-haiku-4-5-20251001`)
// también corre sobre estos archivos.
const sampling = (findings) => findings.filter((f) => / dan? un error 400: /.test(f.message));
const scan = (rel) => sampling(ai({ source: read(rel), file: rel, pack: AI, today: TODAY }).findings);
const scanSource = (source, file = 'x.ts') => sampling(ai({ source, file, pack: AI, today: TODAY }).findings);
const lineWith = (rel, needle) => {
  const lines = read(rel).split('\n');
  assert.equal(lines.filter((l) => l.includes(needle)).length, 1, `"${needle}" tiene que aparecer una sola vez en ${rel}`);
  return lines.findIndex((l) => l.includes(needle)) + 1;
};
const shown = (f) => f.message.match(/^`([^`]+)`/)[1];
const model = (f) => f.message.match(/con el modelo `([^`]+)`/)[1];
const expect = (rel, cases) => {
  const found = scan(rel);
  assert.deepEqual(found.map((f) => [f.line, shown(f), model(f)]), cases.map(([needle, s, m]) => [lineWith(rel, needle), s, m]), rel);
  for (const f of found) assert.equal(f.status, 'detect-only');
  return found;
};

const GENERAL = 'en Claude 4.7 y posteriores (y en Claude Mythos Preview)';
const PYTHON_SDK = 'Además, el SDK de Python 1.0 o posterior ya no tiene `temperature`, `top_p` ni `top_k`: pasarlos tira `TypeError`.';
const ZERO = 'Si estaba en 0 para tener respuestas determinísticas: según Anthropic, eso nunca garantizó respuestas idénticas.';
const recommend = (params) => `Recomendación oficial de Anthropic: sacar ${params} del pedido y guiar el comportamiento del modelo con el prompt.`;

test('IA Claude 4.7: SDK de TypeScript, cada parámetro fuera de lo aceptado con el archivo, la línea, el modelo y la recomendación', () => {
  const rel = 'src/soporte.ts';
  const r = ai({ source: read(rel), file: rel, pack: AI, today: TODAY });
  assert.equal(r.output, null, 'solo detección: nunca reescribe el código');
  const found = expect(rel, [
    ['temperature: 0.2', 'temperature: 0.2', 'claude-opus-4-7'],
    ['top_p: 0.9,', 'top_p: 0.9', 'claude-opus-4-7'],
    ['top_k: 40', 'top_k: 40', 'claude-opus-4-7'],
    ['temperature: CREATIVIDAD', 'temperature: CREATIVIDAD (0.3)', 'claude-sonnet-5-5'],
    ['temperature: 0, messages', 'temperature: 0', 'claude-opus-5'],
    ['top_p: 0.99,', 'temperature', 'claude-haiku-5-5'],
    ['top_p: 1,', 'top_p: 1', 'claude-haiku-5-5'],
  ]);
  assert.equal(found[0].file, rel);
  assert.equal(found[0].message, `\`temperature: 0.2\` con el modelo \`claude-opus-4-7\` da un error 400: ${GENERAL}, \`temperature\` solo acepta 1, su valor por defecto. ${recommend('`temperature`')}`);
  assert.match(found[1].message, /^`top_p: 0\.9` con el modelo `claude-opus-4-7` \(el valor por defecto de `process\.env\.CLAUDE_MODEL`\) da un error 400: .*`top_p` solo acepta valores desde 0\.99\./);
  assert.match(found[2].message, /`top_k` no acepta ningún valor\./);
  assert.ok(found[4].message.endsWith(ZERO), 'con temperature 0 se aclara que nunca fue determinístico');
  assert.ok(found.every((f) => !f.message.includes('TypeError')), 'el TypeError es solo del SDK de Python');
});

test('IA Claude 4.7: en Claude Haiku 5.5, top_p solo 0.99 y nunca temperature y top_p juntos', () => {
  const found = scan('src/soporte.ts');
  const juntos = found.find((f) => f.message.startsWith('`temperature` y `top_p` juntos'));
  assert.equal(juntos.message, `\`temperature\` y \`top_p\` juntos con el modelo \`claude-haiku-5-5\` dan un error 400: Claude Haiku 5.5 rechaza los pedidos que mandan los dos, aunque tengan sus valores por defecto. ${recommend('`temperature` y `top_p`')}`);
  const uno = found.find((f) => shown(f) === 'top_p: 1');
  assert.match(uno.message, /: en Claude Haiku 5\.5, `top_p` solo acepta 0\.99, su valor por defecto \(ni siquiera 1\)\./);
  const call = (m, params) => `client.messages.create({ model: '${m}', max_tokens: 9, ${params}, messages: [] });`;
  assert.deepEqual(scanSource(call('claude-haiku-5-5', 'top_p: 0.99')), [], 'top_p 0.99 solo, sí');
  assert.deepEqual(scanSource(call('claude-haiku-5-5', 'temperature: 1')), [], 'temperature 1 sola, sí');
  assert.deepEqual(scanSource(call('claude-opus-4-7', 'temperature: 1, top_p: 1')), [], 'la regla de los dos juntos es solo de Haiku 5.5');
  assert.equal(scanSource(call('claude-haiku-5-5', 'temperature: 0.5, top_p: 0.99')).length, 1, 'si uno ya está mal, alcanza con ese aviso');
});

test('IA Claude 4.7: SDK de Python (create, stream, **params, with_raw_response), con el TypeError del SDK 1.0', () => {
  const rel = 'src/resumenes.py';
  const found = expect(rel, [
    ['temperature=0,', 'temperature=0', 'claude-opus-4-8'],
    ['top_k=50', 'top_k=50', 'claude-opus-4-8'],
    ['"temperature": TEMPERATURA', 'temperature: TEMPERATURA (0.4)', 'claude-fable-5-1'],
    ['top_p=0.5', 'top_p=0.5', 'claude-mythos-preview'],
  ]);
  assert.equal(found[0].message, `\`temperature=0\` con el modelo \`claude-opus-4-8\` da un error 400: ${GENERAL}, \`temperature\` solo acepta 1, su valor por defecto. ${recommend('`temperature`')} ${ZERO} ${PYTHON_SDK}`);
  assert.match(found[1].message, /con el modelo `claude-opus-4-8` \(el valor por defecto de la variable de entorno `CLAUDE_MODEL`\) da un error 400/);
  assert.ok(found.every((f) => f.message.endsWith(PYTHON_SDK)));
});

test('IA Claude 4.7: HTTP directo a api.anthropic.com/v1/messages (fetch, axios, requests), sin avisar la capa compatible con OpenAI', () => {
  expect('src/http.js', [
    ['temperature: 0.7', 'temperature: 0.7', 'claude-sonnet-5'],
    ['"top_p": 0.5', 'top_p: 0.5', 'claude-opus-5-5'],
  ]);
  const [py] = expect('src/http.py', [['"top_k": 10', 'top_k: 10', 'claude-opus-4-7']]);
  assert.ok(!py.message.includes('TypeError'), 'por HTTP no hay SDK de Python de por medio');
  assert.deepEqual(scanSource("const BODY = { model: 'claude-opus-4-7', max_tokens: 9, temperature: 0.2, messages: [] };\nfetch(ANTHROPIC_URL, { body: JSON.stringify(BODY) });"), [],
    'sin el host ni la ruta en el archivo, no se sabe a dónde va');
  assert.deepEqual(scanSource("fetch('https://api.anthropic.com/v1/messages', { body: JSON.stringify({ model: 'claude-opus-4-7', temperature: 0.2 }) });"), [],
    'un objeto sin messages ni max_tokens no es el cuerpo de un pedido');
});

test('IA Claude 4.7: no avisa valores por defecto, modelos anteriores, otros proveedores ni modelos que no se pueden saber', () => {
  assert.deepEqual(scan('src/no-avisa.ts'), []);
  assert.deepEqual(scan('src/no_avisa.py'), []);
  assert.deepEqual(scan('src/config.js'), [], 'un objeto de configuración sin la llamada ni el host en el archivo');
  const call = (m, params) => `client.messages.create({ model: '${m}', max_tokens: 9, ${params}, messages: [] });`;
  for (const m of ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5', 'claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929', 'claude-3-7-sonnet-20250219']) {
    assert.deepEqual(scanSource(call(m, 'temperature: 0.2, top_p: 0.5, top_k: 5')), [], m);
  }
  for (const params of ['temperature: 1', 'temperature: 1.0', 'top_p: 0.99', 'top_p: 0.995', 'top_p: 1', 'temperature: undefined', 'top_k: null']) {
    assert.deepEqual(scanSource(call('claude-opus-4-7', params)), [], params);
  }
  assert.deepEqual(scanSource("openai.chat.completions.create({ model: 'claude-opus-4-7', max_tokens: 9, temperature: 0.2, messages: [] });"), []);
});

test('IA Claude 4.7: el modelo por constante cuenta solo si se asigna una vez; un parámetro con el mismo nombre la tapa', () => {
  // El comentario con el ID hace que el archivo pase el filtro rápido (sin un modelo afectado en el texto, ni se tokeniza).
  const body = '// claude-opus-4-7\nclient.messages.create({ model: M, max_tokens: 9, temperature: 0.2, messages: [] });';
  assert.equal(scanSource(`const M = 'claude-opus-4-7';\n${body}`).length, 1);
  assert.equal(scanSource(`const M: string = "claude-opus-4-7";\n${body}`).length, 1, 'con tipo');
  assert.equal(scanSource(`const M = process.env.MODEL ?? 'claude-opus-4-7';\n${body}`).length, 1, 'valor por defecto de una variable');
  assert.deepEqual(scanSource(`let M = 'claude-opus-4-7';\nif (x) M = 'claude-sonnet-4-6';\n${body}`), [], 'reasignada');
  assert.deepEqual(scanSource(`const M = 'claude-opus-4-7';\nfunction f(M) { ${body} }`), [], 'parámetro que tapa la constante');
  assert.deepEqual(scanSource(`const M = 'claude-opus-4-7';\nconst g = (M) => ${body}`), [], 'parámetro de una arrow function');
  assert.deepEqual(scanSource(`const { M } = config;\n${body}`), [], 'desestructurada');
  assert.deepEqual(scanSource(`import { M } from './modelos';\n${body}`), [], 'importada');
  const py = (head) => scanSource(`${head}\n# claude-opus-4-7\nclient.messages.create(model=M, max_tokens=9, temperature=0.2, messages=[])\n`, 'x.py');
  assert.equal(py('M = "claude-opus-4-7"').length, 1);
  assert.equal(py('M = os.environ.get("CLAUDE_MODEL", "claude-opus-4-7")').length, 1);
  assert.equal(py('M = settings.CLAUDE_MODEL or "claude-opus-4-7"').length, 1);
  assert.deepEqual(py('from config import M'), []);
  assert.deepEqual(py('M = "claude-opus-4-7"\nfor M in MODELOS: pass'), []);
});

test('IA Claude 4.7: CRLF, tabs, regex, template literals, comentarios y strings no corren las líneas ni inventan claves', () => {
  const src = [
    "const re = /[{(]model/g; // { suelto",
    "const s = 'temperature: 0.1 }';",
    'export const f = async (texto) => {',
    '\tconst r = await client.messages.create({',
    "\t\tmodel: `claude-opus-4-7`,",
    '\t\tmax_tokens: 9,',
    "\t\tmessages: [{ role: 'user', content: `a ${texto} }` }],",
    '\t\ttop_k: 3,',
    '\t});',
    '};',
  ];
  for (const eol of ['\n', '\r\n']) {
    const found = scanSource(src.join(eol));
    assert.deepEqual(found.map((f) => [f.line, shown(f)]), [[8, 'top_k: 3']], JSON.stringify(eol));
  }
  const py = ['r = client.messages.create(', "    model='claude-opus-4-7',  # temperature=0.1", '    max_tokens=9,', '    messages=[{"role": "user", "content": """multi', '    línea )"""}],', '    top_p=0.2,', ')'];
  for (const eol of ['\n', '\r\n']) {
    assert.deepEqual(scanSource(py.join(eol), 'x.py').map((f) => [f.line, shown(f)]), [[6, 'top_p=0.2']], JSON.stringify(eol));
  }
});

test('IA Claude 4.7: los modelos y los valores aceptados salen de las páginas oficiales', () => {
  const sp = AI.detect.sampling_params;
  assert.equal(sp.last_verified, '2026-10-20');
  assert.deepEqual(sp.models, ['claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-sonnet-5-5',
    'claude-haiku-5-5', 'claude-fable-5', 'claude-fable-5-1', 'claude-mythos-5', 'claude-mythos-5-1', 'claude-mythos-preview']);
  for (const old of ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5']) assert.ok(!sp.models.includes(old), `${old} acepta los tres`);
  assert.deepEqual([sp.accepted.temperature.min, sp.accepted.temperature.max], [1, 1]);
  assert.deepEqual([sp.accepted.top_p.min, sp.accepted.top_p.max], [0.99, 1]);
  assert.equal(sp.accepted.top_k.min, undefined, 'top_k no acepta ningún valor');
  assert.deepEqual(sp.overrides['claude-haiku-5-5'].exclusive, ['temperature', 'top_p']);
  assert.ok(AI.sources.some((s) => s.url === 'https://platform.claude.com/docs/en/about-claude/model-deprecations#api-parameter-deprecations'));
  assert.ok(AI.sources.some((s) => s.url === 'https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide#remove-sampling-parameters'));
});

test('IA Claude 4.7: el motor reporta los avisos en TS, Python y HTTP, con rutas "/", sin cambiar nada', () => {
  const r = run(FIX, { packIds: [AI.id], today: TODAY });
  const byFile = (f) => sampling(r.findings.filter((x) => x.file === f)).length;
  assert.equal(byFile('src/soporte.ts'), 7);
  assert.equal(byFile('src/resumenes.py'), 4);
  assert.equal(byFile('src/http.js') + byFile('src/http.py'), 3);
  assert.equal(byFile('src/no-avisa.ts') + byFile('src/no_avisa.py') + byFile('src/config.js'), 0);
  assert.ok(r.findings.every((f) => !f.file.includes('\\') && f.status === 'detect-only'));
  assert.equal(r.changed.length, 0);
  assert.ok(r.inventory.usages.some((u) => u.op === 'Anthropic temperature (Claude 4.7+)' && u.file === 'src/soporte.ts'));
});
