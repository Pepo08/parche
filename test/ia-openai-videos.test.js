// Pack de IA: la Videos API de OpenAI, cerrada el 24/9/2026 sin reemplazo (developers.openai.com/api/docs/deprecations,
// sección "2026-03-24: Sora 2 video generation models and Videos API", verificada el 19/10/2026). Los métodos salen de
// la referencia oficial de la API (Node y Python) y del SDK de Python (create_and_poll, poll). Fixtures, sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ai from '../src/detectors/ai-model-retirements.js';
import { loadPacks } from '../src/packs.js';
import { run } from '../src/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'ia-openai-videos');
const AI = loadPacks().find((p) => p.id === 'ai.model-retirements');
const TODAY = '2026-10-19';

const read = (rel) => fs.readFileSync(path.join(FIX, rel), 'utf8');
const scan = (rel, today = TODAY) => ai({ source: read(rel), file: rel, pack: AI, today }).findings;
const scanSource = (source, today = TODAY) => ai({ source, file: 'x.js', pack: AI, today }).findings;
const lineWith = (rel, needle) => read(rel).split('\n').findIndex((l) => l.includes(needle)) + 1;
const shown = (f) => f.message.match(/^`([^`]+)`/)[1];
// El aviso del modelo `sora-2` también nombra la Videos API ("ese día también cerró"): acá solo cuentan las llamadas.
const videos = (findings) => findings.filter((f) => f.message.includes('la Videos API de OpenAI'));

const VIDEOS = 'pertenece a la Videos API de OpenAI, cerrada el 2026-09-24. Reemplazo: OpenAI no indica ninguno (según su referencia, no hay una API que la reemplace uno a uno). Ese mismo día cerraron los modelos `sora-2` y `sora-2-pro`: no alcanza con cambiar de modelo.';

test('IA OpenAI: la Videos API se avisa desde el SDK de Node y el de Python y por HTTP, cerrada el 2026-09-24 y sin reemplazo', () => {
  const expected = {
    'src/videos.ts': ['videos.create', 'videos.retrieve', 'videos.retrieve', 'videos.downloadContent', 'videos.remix', 'videos.list',
      'videos.delete', 'videos.getCharacter', '/v1/videos'],
    'src/videos.py': ['videos.create_and_poll', 'videos.with_streaming_response.download_content', 'videos.edit', 'videos.extend',
      'videos.retrieve', 'videos.poll', 'videos.get_character'],
  };
  for (const [file, ids] of Object.entries(expected)) {
    const r = ai({ source: read(file), file, pack: AI, today: TODAY });
    assert.equal(r.output, null, 'solo detección: nunca reescribe el código');
    const found = videos(r.findings);
    assert.deepEqual(found.map(shown), ids, file);
    for (const f of found) {
      assert.equal(f.status, 'detect-only');
      assert.equal(f.message, `\`${shown(f)}\` ${VIDEOS}`);
      assert.doesNotMatch(f.message, /Reemplazo recomendado/, 'no se inventa un reemplazo');
    }
  }
});

test('IA OpenAI: en la misma línea se avisan el modelo sora-2 y la llamada a la Videos API', () => {
  const file = 'src/videos.ts';
  const here = scan(file).filter((f) => f.line === lineWith(file, 'openai.videos.create('));
  assert.equal(here.length, 2);
  assert.match(here[0].message, /^El modelo `sora-2` fue retirado el 2026-09-24: las llamadas ya fallan\./);
  assert.equal(here[1].message, `\`videos.create\` ${VIDEOS}`);
});

test('IA OpenAI: antes del 2026-09-24 el aviso de la Videos API dice que cierra ese día', () => {
  const [f] = videos(scan('src/videos.py', '2026-09-23'));
  assert.match(f.message, /^`videos\.create_and_poll` pertenece a la Videos API de OpenAI, que cierra el 2026-09-24\. Reemplazo: OpenAI no indica ninguno/);
});

test('IA OpenAI: no avisa los videos de YouTube ni de Vimeo, aunque el archivo use el SDK de OpenAI', () => {
  assert.deepEqual(scan('src/no-avisa.js'), [], 'youtube.videos.list/insert, google.youtube("v3").videos.list, rutas /videos de Vimeo y YouTube');
  assert.deepEqual(scan('src/no-avisa.py'), [], 'youtube.videos().list() del cliente de Google');
  for (const call of ['youtube.videos.delete({ id })', 'this.youtube.videos.list({ id })', 'youTubeApi.videos.list({ id })',
    "google.youtube({ version: 'v3' }).videos.list({ id })", 'client.videos.listWithResponseHeaders()', 'client.videos.upload(id, f)']) {
    assert.deepEqual(scanSource(`import OpenAI from 'openai';\nexport const r = () => ${call};\n`), [], call);
  }
});

test('IA OpenAI: la Videos API exige el SDK oficial o el host de OpenAI en el archivo', () => {
  assert.deepEqual(scan('src/sin-sdk.js'), [], 'api.video (client.videos.create) y otro proveedor con /v1/videos');
  const call = 'export const r = (id) => client.videos.retrieve(id);';
  for (const head of ["import OpenAI from 'openai';", "const OpenAI = require('openai');", 'from openai import OpenAI', 'import openai',
    "const BASE = 'https://api.openai.com/v1';"]) {
    assert.equal(scanSource(`${head}\n${call}\n`).length, 1, head);
  }
  for (const head of ["import ApiVideoClient from '@api.video/nodejs-client';", "import { google } from 'googleapis';", '// sin import']) {
    assert.deepEqual(scanSource(`${head}\n${call}\n`), [], head);
  }
  assert.deepEqual(scanSource("fetch('https://api.example-video.dev/v1/videos');"), []);
  assert.equal(scanSource("fetch('https://api.openai.com/v1/videos');").length, 1, 'con el host de OpenAI alcanza');
});

test('IA OpenAI: en Azure OpenAI, la Videos API no se da por cerrada con la fecha de OpenAI', () => {
  const src = 'from openai import AzureOpenAI\nclient = AzureOpenAI()\nvideo = client.videos.retrieve(video_id)\n';
  const [f] = scanSource(src);
  assert.equal(f.message, '`videos.retrieve` es la Videos API. En Azure OpenAI sigue su propio calendario (el cierre del 2026-09-24 es el de la API de OpenAI): revisá el de Azure.');
});

test('IA OpenAI: el motor reporta la Videos API en TS y Python, con rutas "/", sin cambiar nada', () => {
  const r = run(FIX, { packIds: [AI.id], today: TODAY });
  const byFile = (f) => r.findings.filter((x) => x.file === f).length;
  assert.equal(byFile('src/videos.ts'), 10, 'nueve de la Videos API y el modelo sora-2');
  assert.equal(byFile('src/videos.py'), 7);
  assert.equal(byFile('src/no-avisa.js') + byFile('src/no-avisa.py') + byFile('src/sin-sdk.js'), 0);
  assert.ok(r.findings.every((f) => !f.file.includes('\\') && f.status === 'detect-only'));
  assert.equal(r.changed.length, 0);
  assert.ok(r.inventory.usages.some((u) => u.op === 'OpenAI Videos API'));
});
