// Pack de IA: el resto de la página de deprecaciones de OpenAI (developers.openai.com/api/docs/deprecations,
// verificada el 18/10/2026). Lo que se apaga entre diciembre de 2026 y abril de 2027, y lo que ya se apagó en
// 2026 y el pack no tenía. Una fila por sección de la página, con su fecha y su reemplazo. Fixtures, sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ai from '../src/detectors/ai-model-retirements.js';
import { loadPacks } from '../src/packs.js';
import { run } from '../src/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'ia-openai-completo');
const AI = loadPacks().find((p) => p.id === 'ai.model-retirements');
const TODAY = '2026-10-18';

const read = (rel) => fs.readFileSync(path.join(FIX, rel), 'utf8');
const scan = (rel, today = TODAY) => ai({ source: read(rel), file: rel, pack: AI, today }).findings;
const lineWith = (rel, needle) => read(rel).split('\n').findIndex((l) => l.includes(needle)) + 1;
// La línea donde está el ID entre comillas, entero (no como principio de otro ID más largo).
const lineOfId = (rel, id) => read(rel).split('\n').findIndex((l) => [`'${id}'`, `"${id}"`, `\`${id}\``].some((q) => l.includes(q))) + 1;
const each = (ids, expected) => Object.fromEntries(ids.map((id) => [id, expected]));

const SOL = '`gpt-5.6-sol`';
const TERRA = '`gpt-5.6-terra`';
const LUNA6 = '`gpt-6-luna`';

// Una fila por sección de la página: el archivo del fixture, la fecha y, por ID, lo que tiene que decir el aviso.
const SECTIONS = [
  { section: '2026-10-14: GPT-4 series model deprecations', file: 'src/gpt4-2027.ts', date: '2027-01-14',
    ids: each(['gpt-4o-2024-08-06', 'gpt-4o-2024-11-20', 'gpt-4o-mini-2024-07-18', 'gpt-4.1-2025-04-14', 'gpt-4.1-mini-2025-04-14'], LUNA6) },
  { section: '2026-10-01: GPT-5.3-Codex, GPT-5.1, GPT-5.4-Nano', file: 'src/codex.js', date: '2027-04-01',
    ids: { 'gpt-5.1': '`gpt-6-sol`', 'gpt-5.3-codex': '`gpt-6-sol`', 'gpt-5.4-nano': LUNA6 } },
  { section: '2026-10-01: Text-to-speech models', file: 'src/audio.py', date: '2027-01-06',
    ids: each(['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts-2025-03-20', 'gpt-4o-mini-tts-2025-12-15'], '`gpt-realtime-2.1-mini`') },
  { section: '2026-08-26: Transcription models', file: 'src/audio.py', date: '2027-02-26',
    ids: each(['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe-diarize'], '`gpt-live-transcribe o gpt-transcribe`') },
  { section: '2026-07-20: Legacy audio, realtime, and transcription models', file: 'src/audio.py', date: '2027-01-20',
    ids: {
      ...each(['gpt-realtime', 'gpt-realtime-2025-08-28'], '`gpt-realtime-2.1`'),
      ...each(['gpt-realtime-mini', 'gpt-realtime-mini-2025-12-15'], '`gpt-realtime-2.1-mini`'),
      ...each(['gpt-audio', 'gpt-audio-2025-08-28', 'gpt-audio-mini', 'gpt-audio-mini-2025-12-15'], '`gpt-audio-1.5`'),
      'gpt-4o-mini-transcribe-2025-03-20': '`gpt-4o-mini-transcribe-2025-12-15`',
    } },
  { section: '2026-06-02: GPT Image model deprecations', file: 'src/imagenes.js', date: '2026-12-01',
    ids: each(['gpt-image-1-mini', 'gpt-image-1.5', 'chatgpt-image-latest'], '`gpt-image-2.5-sunburst o gpt-image-2.5-flare`') },
  // Ya apagados: las llamadas fallan.
  { section: '2026-04-22: Legacy GPT model snapshots (July 2026 shutdown)', file: 'src/retirados.js', date: '2026-07-23',
    ids: {
      ...each(['computer-use-preview', 'computer-use-preview-2025-03-11', 'gpt-4o-search-preview-2025-03-11',
        'gpt-4o-mini-search-preview-2025-03-11', 'gpt-5.1-codex-mini'], TERRA),
      ...each(['gpt-5-chat-latest', 'gpt-5.1-chat-latest', 'gpt-5-codex', 'gpt-5.1-codex', 'gpt-5.1-codex-max', 'gpt-5.2-codex',
        'o3-deep-research', 'o3-deep-research-2025-06-26', 'o4-mini-deep-research', 'o4-mini-deep-research-2025-06-26'], SOL),
      'gpt-audio-mini-2025-10-06': '`gpt-audio-1.5`',
      'gpt-realtime-mini-2025-10-06': '`gpt-realtime-2.1-mini`',
    } },
  { section: '2026-05-08: gpt-5.2-chat-latest and gpt-5.3-chat-latest', file: 'src/retirados.js', date: '2026-08-10',
    ids: each(['gpt-5.2-chat-latest', 'gpt-5.3-chat-latest'], SOL) },
  { section: '2026-03-24: Sora 2 video generation models and Videos API', file: 'src/retirados.js', date: '2026-09-24',
    ids: each(['sora-2', 'sora-2-pro', 'sora-2-2025-10-06', 'sora-2-2025-12-08', 'sora-2-pro-2025-10-06'],
      'OpenAI no indica reemplazo y ese día también cerró la Videos API.') },
  { section: '2026-09-11: GPT-5.4-Cyber', file: 'src/retirados.js', date: '2026-10-01',
    ids: { 'gpt-5.4-cyber': 'Reemplazo recomendado: el modelo cyber más capaz al que tengas acceso.' } },
  { section: '2025-09-15: gpt-4o-realtime-preview models (las filas que faltaban)', file: 'src/retirados.js', date: '2026-05-07',
    ids: { 'gpt-4o-mini-realtime-preview': '`gpt-realtime-mini`', 'gpt-4o-audio-preview': '`gpt-audio-1.5`', 'gpt-4o-mini-audio-preview': '`gpt-audio-mini`' } },
  { section: '2025-09-26: Legacy GPT model snapshots (March 2026 shutdown)', file: 'src/retirados.js', date: '2026-03-26',
    ids: { 'gpt-4-turbo-preview-completions': '`gpt-5 o gpt-4.1`' } },
];

for (const { section, file, date, ids } of SECTIONS) {
  test(`IA OpenAI: "${section}" se avisa con el ${date} y el reemplazo oficial, sin tocar el código`, () => {
    const r = ai({ source: read(file), file, pack: AI, today: TODAY });
    assert.equal(r.output, null, 'solo detección: nunca reescribe el modelo');
    const past = date <= TODAY;
    const head = (id) => `El modelo \`${id}\` ${past ? 'fue retirado' : 'se retira'} el ${date}${past ? ': las llamadas ya fallan' : ''}.`;
    for (const [id, expected] of Object.entries(ids)) {
      const line = lineOfId(file, id);
      assert.ok(line > 0, `${id} está en ${file}`);
      const here = r.findings.filter((f) => f.line === line);
      assert.equal(here.length, 1, `${id}: un solo aviso (no se confunde con otro ID que empieza igual)`);
      assert.equal(here[0].status, 'detect-only');
      assert.ok(here[0].message.startsWith(head(id)), here[0].message);
      assert.ok(here[0].message.includes(expected), `${id}: ${expected}`);
    }
  });
}

test('IA OpenAI: Sora 2 no inventa un reemplazo y whisper-1 avisa que las traducciones cierran el mismo día', () => {
  for (const f of scan('src/retirados.js').filter((x) => /`sora-2/.test(x.message))) assert.doesNotMatch(f.message, /Reemplazo recomendado/);
  const [whisper] = scan('src/audio.py').filter((f) => f.line === lineOfId('src/audio.py', 'whisper-1'));
  assert.match(whisper.message, /\(\/v1\/audio\/translations\), ese endpoint cierra el mismo día y el reemplazo es v1\/realtime\/translations\./);
});

// Los fine-tuned de la sección del 14/10/2026: "follow the same shutdown schedule as their underlying base models".
const FINE_TUNES = [
  { family: 'ft-gpt-4o', needles: ['ft:gpt-4o-2024-08-06:', 'ft:gpt-4o-2024-11-20:'] },
  { family: 'ft-gpt-4o-mini', needles: ['ft:gpt-4o-mini-2024-07-18:', 'ft:gpt-4o-mini:'] },
  { family: 'ft-gpt-4.1', needles: ['ft:gpt-4.1-2025-04-14:', 'ft:gpt-4.1:'] },
  { family: 'ft-gpt-4.1-mini', needles: ['ft:gpt-4.1-mini-2025-04-14:', 'ft:gpt-4.1-mini:'] },
];

for (const { family, needles } of FINE_TUNES) {
  test(`IA OpenAI: los fine-tuned ${family} se apagan con su modelo base el 2027-01-14`, () => {
    const file = 'src/gpt4-2027.ts';
    const findings = scan(file);
    for (const needle of needles) {
      const here = findings.filter((f) => f.line === lineWith(file, needle));
      assert.equal(here.length, 1, `${needle}: un solo aviso (el snapshot del ID no se cuenta dos veces)`);
      const base = needle.slice('ft:'.length, -1);
      assert.ok(here[0].message.startsWith(`El modelo fine-tuned sobre \`${base}\` (\`${family}\`) se retira el 2027-01-14.`), here[0].message);
      assert.match(here[0].message, /modelo base de reemplazo `gpt-6-luna`; el modelo fine-tuned no se migra solo/);
    }
  });
}

test('IA OpenAI: el header de la Realtime API Beta (realtime=v1) se avisa con su fecha, antes y después, y en Azure', () => {
  const file = 'src/retirados.js';
  const line = lineWith(file, 'realtime=v1');
  const [despues] = scan(file).filter((f) => f.line === line);
  assert.equal(despues.message, '`realtime=v1` pertenece a la Realtime API Beta de OpenAI, cerrada el 2026-05-12. Reemplazo: la Realtime API (GA).');
  const [antes] = scan(file, '2026-05-01').filter((f) => f.line === line);
  assert.match(antes.message, /de OpenAI, que cierra el 2026-05-12\./);
  const azure = ai({ source: "const c = new AzureOpenAI({}); const h = { 'OpenAI-Beta': 'realtime=v1' };", file: 'x.js', pack: AI, today: TODAY });
  assert.match(azure.findings[0].message, /^`realtime=v1` es la Realtime API Beta\. En Azure OpenAI sigue su propio calendario/);
  assert.equal(azure.usages[0].op, 'OpenAI Realtime API Beta');
});

test('IA OpenAI: no avisa alias sin fecha, fine-tuned ambiguos ni los reemplazos que empiezan igual', () => {
  assert.deepEqual(scan('src/no-retirados.js'), []);
});

test('IA OpenAI: cada entrada del pack tiene fecha y reemplazo (o lo que dice la página), y ninguna base se repite', () => {
  for (const [id, e] of Object.entries(AI.detect.retired_models)) {
    const v = typeof e === 'string' ? { date: e } : e;
    assert.match(v.date, /^\d{4}-\d{2}-\d{2}$/, id);
    assert.ok(v.replacement || v.replacement_es || v.note_es, `${id}: reemplazo o nota`);
  }
  for (const alias of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o-mini-tts']) {
    assert.ok(!(alias in AI.detect.retired_models), `${alias}: la página no le pone fecha`);
  }
  const bases = Object.values(AI.detect.retired_fine_tunes).flatMap((e) => e.bases);
  assert.equal(new Set(bases).size, bases.length, 'una base no puede estar en dos familias');
  assert.ok(!bases.includes('gpt-4o'), 'gpt-4o tiene snapshots que se apagan en fechas distintas');
  for (const ep of AI.detect.retired_endpoints) {
    assert.ok(ep.api_es && ep.replacement_es && /^\d{4}-\d{2}-\d{2}$/.test(ep.retired), ep.pattern);
  }
});

test('IA OpenAI: el motor lo reporta en JS, TS y Python, con rutas "/", y el inventario reconoce los IDs nuevos', () => {
  const r = run(FIX, { packIds: [AI.id], today: TODAY });
  const byFile = (f) => r.findings.filter((x) => x.file === f).length;
  assert.equal(byFile('src/gpt4-2027.ts'), 13, '5 snapshots y 8 fine-tuned');
  assert.equal(byFile('src/codex.js'), 3);
  assert.equal(byFile('src/imagenes.js'), 3);
  assert.equal(byFile('src/audio.py'), 17, '4 de voz, 5 de transcripción y 8 de audio y realtime');
  assert.equal(byFile('src/retirados.js'), 30, '29 modelos y el header de la Realtime API Beta');
  assert.equal(byFile('src/no-retirados.js'), 0);
  assert.ok(r.findings.every((f) => !f.file.includes('\\')));
  assert.equal(r.changed.length, 0);
  const ops = r.inventory.usages.map((u) => u.op);
  for (const op of ['modelo whisper-1', 'modelo fine-tuned gpt-4o-mini', 'modelo sora-2', 'OpenAI Realtime API Beta']) assert.ok(ops.includes(op), op);
  const models = r.inventory.apis.find((a) => a.id === 'ai:OpenAI').operations.map((o) => o.op);
  for (const id of ['computer-use-preview', 'o4-mini-deep-research', 'sora-2-pro', 'gpt-realtime-mini-2025-10-06', 'gpt-audio-1.5', 'gpt-6-luna']) {
    assert.ok(models.includes(id), `inventario: ${id}`);
  }
});
