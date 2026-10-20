// Pack de IA: los productos que OpenAI cierra y no son modelos (developers.openai.com/api/docs/deprecations,
// verificada el 18/10/2026): prompts reutilizables, la plataforma de Evals y ChatKit con un workflow de Agent Builder.
// Cómo se usan desde el SDK de Node y el de Python sale de la referencia oficial de la API. Fixtures, sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ai from '../src/detectors/ai-model-retirements.js';
import { loadPacks } from '../src/packs.js';
import { run } from '../src/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'ia-openai-productos');
const AI = loadPacks().find((p) => p.id === 'ai.model-retirements');
const TODAY = '2026-10-18';

const read = (rel) => fs.readFileSync(path.join(FIX, rel), 'utf8');
const scan = (rel, today = TODAY) => ai({ source: read(rel), file: rel, pack: AI, today }).findings;
const scanSource = (source, today = TODAY) => ai({ source, file: 'x.js', pack: AI, today }).findings;
const lineWith = (rel, needle) => read(rel).split('\n').findIndex((l) => l.includes(needle)) + 1;
const shown = (f) => f.message.match(/^`([^`]+)`/)[1];

const PROMPTS = 'pertenece a la API de prompts reutilizables de OpenAI, que cierra el 2026-11-30. Reemplazo: pasar el contenido del prompt a tu código y mandarlo en `input` de la Responses API (guía oficial "Migrate from prompt objects").';
const EVALS = 'pertenece a la plataforma de Evals de OpenAI, que cierra el 2026-11-30. El 2026-10-31 las evals existentes pasan a solo lectura. Reemplazo: Promptfoo, que recomienda OpenAI (guía oficial "Moving from OpenAI Evals to Promptfoo").';
const CHATKIT = 'pertenece a la integración de ChatKit con Agent Builder de OpenAI, que cierra el 2026-11-30. Reemplazo: exportar el workflow como código del Agents SDK y conectar ChatKit a tu propio servidor (guía oficial "Migrate from Agent Builder"). ChatKit sigue disponible; el workflow alojado en Agent Builder se puede usar solo durante la transición.';

test('IA OpenAI: prompts reutilizables (IDs pmpt_ y v1/prompts) se avisan con el cierre del 2026-11-30, en JS y en Python', () => {
  const cases = [
    ['src/prompts.js', "'pmpt_68b2c0ffee5e8190a1b2c3d4e5f60718'", 'pmpt_68b2c0ffee5e8190a1b2c3d4e5f60718'],
    ['src/prompts.js', '"pmpt_123"', 'pmpt_123'],
    ['src/prompts.js', 'api.openai.com/v1/prompts', 'api.openai.com/v1/prompts'],
    ['src/prompts.py', '"pmpt_123"', 'pmpt_123'],
  ];
  for (const [file, needle, id] of cases) {
    const r = ai({ source: read(file), file, pack: AI, today: TODAY });
    assert.equal(r.output, null, 'solo detección: nunca reescribe el código');
    const here = r.findings.filter((f) => f.line === lineWith(file, needle));
    assert.equal(here.length, 1, `${file}: ${needle}`);
    assert.equal(here[0].status, 'detect-only');
    assert.equal(here[0].message, `\`${id}\` ${PROMPTS}`);
  }
  assert.equal(scan('src/prompts.js').length, 3, 'dos IDs y la API por HTTP; el comentario que nombra v1/prompts no cuenta');
  assert.equal(scan('src/prompts.py').length, 1);
  const [despues] = scan('src/prompts.py', '2026-12-01');
  assert.match(despues.message, /^`pmpt_123` pertenece a la API de prompts reutilizables de OpenAI, cerrada el 2026-11-30\. Reemplazo: /);
});

test('IA OpenAI: Evals desde el SDK de Node y el de Python y por HTTP, con el paso a solo lectura del 2026-10-31', () => {
  const expected = {
    'src/evals.ts': ['evals.create', 'evals.runs.create', 'evals.runs.outputItems.list', '/v1/evals'],
    'src/evals.py': ['evals.retrieve', 'evals.runs.output_items.list', 'evals.runs.cancel'],
  };
  for (const [file, ids] of Object.entries(expected)) {
    const findings = scan(file);
    assert.deepEqual(findings.map(shown), ids, file);
    for (const f of findings) {
      assert.equal(f.status, 'detect-only');
      assert.equal(f.message, `\`${shown(f)}\` ${EVALS}`);
    }
  }
});

test('IA OpenAI: el aviso de Evals cambia con la fecha (solo lectura desde el 31/10, cerrada desde el 30/11)', () => {
  const file = 'src/evals.ts';
  const line = lineWith(file, 'openai.evals.create(');
  const message = (today) => scan(file, today).find((f) => f.line === line).message;
  assert.match(message('2026-10-31'), /que cierra el 2026-11-30\. Desde el 2026-10-31 las evals existentes están en solo lectura\. Reemplazo: Promptfoo/);
  assert.match(message('2026-11-29'), /que cierra el 2026-11-30\. Desde el 2026-10-31/);
  assert.match(message('2026-11-30'), /^`evals\.create` pertenece a la plataforma de Evals de OpenAI, cerrada el 2026-11-30\. Reemplazo: Promptfoo/);
  assert.doesNotMatch(message('2026-11-30'), /solo lectura/, 'cerrada la plataforma, el paso intermedio no se nombra');
});

test('IA OpenAI: ChatKit con un workflow de Agent Builder se avisa con el cierre de Agent Builder, por SDK y por HTTP', () => {
  const cases = [['src/chatkit.js', 'chatkit.sessions.create(', 'chatkit.sessions.create'], ['src/chatkit.py', '/v1/chatkit/sessions', '/v1/chatkit/sessions']];
  for (const [file, needle, id] of cases) {
    const findings = scan(file);
    assert.equal(findings.length, 1, file);
    assert.equal(findings[0].line, lineWith(file, needle));
    assert.equal(findings[0].message, `\`${id}\` ${CHATKIT}`);
  }
});

test('IA OpenAI: no avisa evals, prompts ni workflows de otras librerías y APIs, ni lo que sigue en OpenAI', () => {
  assert.deepEqual(scan('src/no-avisa.js'), [], 'otro cliente con evals, Portkey /v1/prompts, un objeto prompt propio, wf_ de otro sistema');
  assert.deepEqual(scan('src/no-avisa.py'), [], 'phoenix.evals, el servidor propio de ChatKit, imágenes y Responses');
});

test('IA OpenAI: los patrones de Evals y ChatKit exigen el SDK oficial o el host de OpenAI en el archivo', () => {
  const call = 'export const r = () => client.evals.list();';
  for (const head of ["import OpenAI from 'openai';", 'import OpenAI from "openai";', "import 'openai/shims/node';",
    "const OpenAI = require('openai');", "const { OpenAI } = await import('openai');", 'from openai import OpenAI', 'import openai',
    'from openai.types import EvalCreateParams', "const BASE = 'https://api.openai.com/v1';"]) {
    assert.equal(scanSource(`${head}\n${call}\n`).length, 1, head);
  }
  for (const head of ["import OpenAI from 'openai-edge';", 'import openai_helpers', "import { Client } from '@acme/openai-like';", '// sin import']) {
    assert.deepEqual(scanSource(`${head}\n${call}\n`), [], head);
  }
  assert.deepEqual(scanSource('const s = client.beta.chatkit.sessions.create({ workflow: { id: wf } });'), []);
  assert.deepEqual(scanSource("fetch('https://example.com/v1/chatkit/sessions');"), []);
  // Los IDs pmpt_ y la URL con el host de OpenAI no necesitan más contexto: no se confunden con otra API.
  assert.equal(scanSource("export const ID = 'pmpt_abc';").length, 1);
  assert.equal(scanSource("fetch('https://api.openai.com/v1/prompts');").length, 1);
});

test('IA OpenAI: en Azure OpenAI, Evals no se da por cerrada con la fecha de OpenAI', () => {
  const src = 'from openai import AzureOpenAI\nclient = AzureOpenAI()\nclient.evals.create(name="x")\n';
  const [f] = scanSource(src);
  assert.equal(f.message, '`evals.create` es la plataforma de Evals. En Azure OpenAI sigue su propio calendario (el cierre del 2026-11-30 es el de la API de OpenAI): revisá el de Azure.');
});

test('IA OpenAI: el motor reporta los productos en JS, TS y Python, con rutas "/", sin cambiar nada', () => {
  const r = run(FIX, { packIds: [AI.id], today: TODAY });
  const byFile = (f) => r.findings.filter((x) => x.file === f).length;
  assert.equal(byFile('src/prompts.js'), 3);
  assert.equal(byFile('src/prompts.py'), 1);
  assert.equal(byFile('src/evals.ts'), 4);
  assert.equal(byFile('src/evals.py'), 3);
  assert.equal(byFile('src/chatkit.js'), 1);
  assert.equal(byFile('src/chatkit.py'), 1);
  assert.equal(byFile('src/no-avisa.js') + byFile('src/no-avisa.py'), 0);
  assert.ok(r.findings.every((f) => !f.file.includes('\\') && f.status === 'detect-only'));
  assert.equal(r.changed.length, 0);
  const ops = new Set(r.inventory.usages.map((u) => u.op));
  for (const op of ['OpenAI API de prompts reutilizables', 'OpenAI plataforma de Evals', 'OpenAI integración de ChatKit con Agent Builder']) assert.ok(ops.has(op), op);
});

test('IA OpenAI: cada endpoint del pack tiene un patrón o un regex válido, fechas y reemplazo', () => {
  for (const ep of AI.detect.retired_endpoints) {
    const name = ep.pattern || ep.regex;
    assert.ok(!!ep.pattern !== !!ep.regex, `${name}: pattern o regex, no los dos`);
    if (ep.regex) assert.ok(new RegExp(ep.regex).source, name);
    assert.ok(ep.openai_context === undefined || typeof ep.openai_context === 'boolean', name);
    assert.ok(ep.api_es && ep.replacement_es && /^\d{4}-\d{2}-\d{2}$/.test(ep.retired), name);
    for (const m of ep.milestones || []) {
      assert.match(m.date, /^\d{4}-\d{2}-\d{2}$/, name);
      assert.ok(m.date < ep.retired && m.future_es && m.past_es, `${name}: el paso intermedio es antes del cierre`);
    }
  }
});
