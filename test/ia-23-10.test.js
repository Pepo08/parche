// Pack de IA: lo que OpenAI apaga el 23/10/2026 y el pack no tenía (sección "2026-04-22: Legacy GPT model
// snapshots" de developers.openai.com/api/docs/deprecations, verificada el 18/10/2026): los alias "-completions"
// y los modelos fine-tuned. Todo con fixtures, sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ai from '../src/detectors/ai-model-retirements.js';
import { loadPacks } from '../src/packs.js';
import { run } from '../src/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'ia-23-10');
const AI = loadPacks().find((p) => p.id === 'ai.model-retirements');
const TODAY = '2026-10-18';

const read = (rel) => fs.readFileSync(path.join(FIX, rel), 'utf8');
const scan = (rel, today = TODAY) => ai({ source: read(rel), file: rel, pack: AI, today }).findings;
const lineOf = (rel, needle) => read(rel).split('\n').findIndex((l) => l.includes(needle)) + 1;

// Una familia por fila: dónde aparece en el fixture y qué tiene que decir el aviso.
const FAMILIES = [
  { family: 'gpt-3.5-turbo-completions', file: 'src/completions.js', needles: ["'gpt-3.5-turbo-completions'"], replacement: 'gpt-5.6-terra' },
  { family: 'gpt-4-completions y gpt-4-0613-completions', file: 'src/completions.js', needles: ['"gpt-4-completions"', "'gpt-4-0613-completions'"], replacement: 'gpt-5.6-sol' },
  { family: 'gpt-4-turbo-completions', file: 'src/completions.js', needles: ['`gpt-4-turbo-completions`'], replacement: 'gpt-5.6-sol' },
  { family: 'ft-gpt-3.5-turbo', file: 'src/finetune.ts', needles: ['ft:gpt-3.5-turbo-0125:', 'ft:gpt-3.5-turbo:'], replacement: 'gpt-5.6-terra', fineTune: true },
  { family: 'ft-gpt-4', file: 'src/finetune.ts', needles: ['ft:gpt-4-0613:'], replacement: 'gpt-5.6-sol', fineTune: true },
  { family: 'ft-gpt-4.1-nano-2025-04-14', file: 'src/finetune.ts', needles: ['ft:gpt-4.1-nano-2025-04-14:'], replacement: 'gpt-5.6-luna', fineTune: true },
  { family: 'ft-o4-mini-2025-04-16', file: 'src/finetune.ts', needles: ['ft:o4-mini-2025-04-16:'], replacement: 'gpt-5.6-terra', fineTune: true },
  { family: 'ft-babbage-002', file: 'src/finetune.py', needles: ['ft:babbage-002:'], replacement: 'gpt-5.6-terra', fineTune: true },
  { family: 'ft-davinci-002', file: 'src/finetune.py', needles: ['ft:davinci-002:'], replacement: 'gpt-5.6-terra', fineTune: true },
];

for (const { family, file, needles, replacement, fineTune } of FAMILIES) {
  test(`IA 23/10: ${family} se avisa con la fecha y el reemplazo oficial, sin tocar el código`, () => {
    const r = ai({ source: read(file), file, pack: AI, today: TODAY });
    assert.equal(r.output, null, 'solo detección: nunca reescribe el modelo');
    for (const needle of needles) {
      const line = lineOf(file, needle);
      const here = r.findings.filter((f) => f.line === line);
      assert.equal(here.length, 1, `${needle}: un solo aviso por línea (el alias no repite el modelo base)`);
      assert.equal(here[0].status, 'detect-only');
      assert.match(here[0].message, /se retira el 2026-10-23/);
      assert.ok(here[0].message.includes(`\`${replacement}\``), `${needle}: reemplazo ${replacement}`);
      if (fineTune) {
        assert.ok(here[0].message.includes(`\`${family}\``), 'nombra la familia como la página de OpenAI');
        assert.match(here[0].message, /el modelo fine-tuned no se migra solo/);
      }
    }
  });
}

test('IA 23/10: no avisa fine-tuned de otros modelos base ni nombres parecidos', () => {
  // ft:gpt-4o*, ft:gpt-4.1* y ft:gpt-4.1-mini* empiezan igual que ft:gpt-4 pero son otros modelos: OpenAI los
  // apaga el 14/1/2027 (sección del 14/10/2026), que el pack todavía no tiene. Si se agrega, este test cambia.
  assert.deepEqual(scan('src/no-retirados.js'), []);
});

test('IA 23/10: un fine-tuned en una lista es una mención, y después de la fecha ya falla', () => {
  const file = 'src/finetune.ts';
  const catalogo = scan(file).find((f) => f.line === lineOf(file, 'MODELOS_PROPIOS'));
  assert.match(catalogo.message, /^Aparece un modelo fine-tuned sobre `gpt-4` \(`ft-gpt-4`, se retira el 2026-10-23\) fuera de una llamada/);
  const despues = scan(file, '2026-10-23').find((f) => f.line === lineOf(file, 'ft:gpt-4-0613:'));
  assert.match(despues.message, /fue retirado el 2026-10-23: las llamadas ya fallan/);
});

test('IA 23/10: cada familia fine-tuned del pack tiene fecha, reemplazo y modelos base', () => {
  assert.equal(AI.last_verified, '2026-10-18');
  const ft = AI.detect.retired_fine_tunes;
  assert.deepEqual(Object.keys(ft).sort(), ['ft-babbage-002', 'ft-davinci-002', 'ft-gpt-3.5-turbo', 'ft-gpt-4',
    'ft-gpt-4.1-nano-2025-04-14', 'ft-o4-mini-2025-04-16']);
  for (const [name, e] of Object.entries(ft)) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, name);
    assert.ok(e.replacement && e.bases.length, name);
    for (const b of e.bases) assert.ok(!b.includes(':'), `${name}: la base va sin "ft:" ni ":"`);
  }
  for (const id of ['gpt-3.5-turbo-completions', 'gpt-4-completions', 'gpt-4-0613-completions', 'gpt-4-turbo-completions']) {
    assert.equal(AI.detect.retired_models[id].date, '2026-10-23', id);
  }
});

test('IA 23/10: el motor lo reporta en JS, TS y Python, con rutas "/" y usos en el inventario', () => {
  const r = run(FIX, { packIds: [AI.id], today: TODAY });
  const byFile = (f) => r.findings.filter((x) => x.file === f).length;
  assert.equal(byFile('src/completions.js'), 4);
  assert.equal(byFile('src/finetune.ts'), 6);
  assert.equal(byFile('src/finetune.py'), 2);
  assert.equal(byFile('src/no-retirados.js'), 0);
  assert.ok(r.findings.every((f) => !f.file.includes('\\')));
  assert.equal(r.changed.length, 0);
  const ops = r.inventory.usages.map((u) => u.op);
  assert.ok(ops.includes('modelo fine-tuned gpt-3.5-turbo-0125'));
  assert.ok(ops.includes('modelo gpt-4-turbo-completions'));
});
