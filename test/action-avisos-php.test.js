// La Action muestra lo que no abre PR (D67): los avisos de los packs de solo detección (IA) y lo que queda sin PR
// (falta un dato), en el resumen del job y como anotaciones. Además, la plantilla del workflow anda en repos PHP y
// el inventario de PHP y Python no dice "sin usos encontrados" cuando los usos ni se buscaron. Sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { escapeData, escapeProperty, workspacePrefix, annotations, stepSummary, MAX_ANNOTATIONS } from '../src/actions.js';
import { noUsesLabel } from '../src/inventory/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'parche.js');

const PACK = { id: 'ai.model-retirements', title: 'Modelos de IA retirados', provider: 'Modelos de IA' };
const finding = (file, line, message, status = 'detect-only') => ({ pack: PACK.id, file, line, message, status });

// Un repo git de prueba, con la configuración de git aislada de la de la máquina.
function repo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-067-'));
  const globalCfg = path.join(root, '..', `${path.basename(root)}.gitconfig`);
  fs.writeFileSync(globalCfg, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: globalCfg, GIT_CONFIG_NOSYSTEM: '1', PARCHE_GIT_NAME: 'ci', PARCHE_GIT_EMAIL: 'ci@example.com' };
  for (const k of ['GITHUB_ACTIONS', 'GITHUB_TOKEN', 'GITHUB_STEP_SUMMARY', 'GITHUB_WORKSPACE', 'PARCHE_DEFAULT_TOKEN']) delete env[k];
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', env });
  g('init', '-q', '-b', 'main');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  return { root, env, cleanup: () => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(globalCfg, { force: true }); } };
}

test('comandos de workflow: el mensaje escapa %, \\r y \\n; las propiedades, además, ":" y ","', () => {
  assert.equal(escapeData('100%\r\nlisto'), '100%25%0D%0Alisto');
  assert.equal(escapeProperty('Modelos, endpoints: IA'), 'Modelos%2C endpoints%3A IA');
});

test('ruta de la anotación: relativa a la raíz del checkout; fuera del checkout, sin archivo', () => {
  const ws = path.join(os.tmpdir(), 'ws');
  assert.equal(workspacePrefix(ws, ws), '');
  assert.equal(workspacePrefix(path.join(ws, 'apps', 'api'), ws), 'apps/api/');
  assert.equal(workspacePrefix(path.join(os.tmpdir(), 'otro'), ws), null);
  assert.equal(workspacePrefix(ws, undefined), '');
});

test('anotaciones: archivo, línea y título escapados; sin prefijo válido, el lugar va en el mensaje; como mucho 10', () => {
  const groups = [{ pack: PACK, findings: [finding('src/ia.js', 9, 'El modelo `gpt-4` se retira el 2026-10-23.')] }];
  assert.deepEqual(annotations(groups, 'apps/api/'), ['::warning file=apps/api/src/ia.js,line=9,title=Parche · Modelos de IA retirados::El modelo `gpt-4` se retira el 2026-10-23.']);
  assert.deepEqual(annotations(groups, null), ['::warning title=Parche · Modelos de IA retirados::src/ia.js:9: El modelo `gpt-4` se retira el 2026-10-23.']);
  const many = [{ pack: PACK, findings: Array.from({ length: 15 }, (_, i) => finding('src/ia.js', i + 1, `aviso ${i}`)) }];
  assert.equal(annotations(many).length, MAX_ANNOTATIONS);
});

test('resumen del job: PRs, lo que quedó sin PR y los avisos; sin nada, lo dice', () => {
  const md = stepSummary({
    opened: [{ title: 'Parche: ARCA', url: 'https://github.com/o/r/pull/1', draft: true }, { title: 'Parche: Mercado Pago', url: null, draft: false }],
    reportOnly: [{ pack: { ...PACK, title: 'ARCA' }, findings: [finding('src/f.js', 3, 'Falta la condición frente al IVA.', 'needs-input')] }],
    notices: [{ pack: PACK, findings: [finding('src/ia.js', 9, 'El modelo `gpt-4` se retira.')] }],
  });
  assert.match(md, /^## Parche$/m);
  assert.match(md, /^- \[Parche: ARCA\]\(https:\/\/github\.com\/o\/r\/pull\/1\) · borrador$/m);
  assert.match(md, /^- Parche: Mercado Pago · modo prueba: no se abrió$/m);
  assert.match(md, /^### Sin PR$/m);
  assert.match(md, /^- ✋ falta un dato · `src\/f\.js:3` · Falta la condición frente al IVA\.$/m);
  assert.match(md, /^### Avisos$/m);
  assert.match(md, /^- 🔎 detectado · `src\/ia\.js:9` · El modelo `gpt-4` se retira\.$/m);
  assert.match(stepSummary({}), /Ninguno de los packs verificados tiene cambios que te afecten hoy\./);
});

// Un repo con un modelo de IA que se apaga (solo detección) y una factura A a un CUIT (falta un dato: sin PR).
const FILES = {
  'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { openai: '^4.0.0', '@afipsdk/afip.js': '^1.2.0' } }, null, 2),
  'src/ia.js': "import OpenAI from 'openai';\nconst client = new OpenAI();\nexport const r = await client.chat.completions.create({ model: 'gpt-4', messages: [] });\n",
  'src/factura.js': "import Afip from '@afipsdk/afip.js';\nconst afip = new Afip({ CUIT: 20111111112 });\nexport const f = () => afip.ElectronicBilling.createVoucher({\n  CbteTipo: 1,\n  DocTipo: 80,\n  DocNro: 20111111112,\n  ImpTotal: 121,\n});\n",
};

test('pr en GitHub Actions: resumen del job con los avisos de IA y lo que quedó sin PR, y anotaciones con archivo y línea', () => {
  const { root, env, cleanup } = repo(FILES);
  try {
    const summaryFile = path.join(root, '..', `${path.basename(root)}-summary.md`);
    const out = execFileSync('node', [BIN, 'pr', '.', '--dry-run'], { cwd: root, encoding: 'utf8',
      env: { ...env, GITHUB_ACTIONS: 'true', GITHUB_WORKSPACE: root, GITHUB_STEP_SUMMARY: summaryFile } });
    const md = fs.readFileSync(summaryFile, 'utf8');
    fs.rmSync(summaryFile, { force: true });
    assert.match(md, /^### Avisos$/m);
    assert.match(md, /`src\/ia\.js:3` · El modelo `gpt-4` (se retira|fue retirado) el 2026-10-23/); // `pr` usa la fecha de hoy
    assert.match(md, /^### Sin PR$/m);
    assert.match(md, /✋ falta un dato · `src\/factura\.js:3`/);
    assert.match(out, /^::warning file=src\/ia\.js,line=3,title=Parche · /m);
    assert.match(out, /^::warning file=src\/factura\.js,line=3,title=Parche · /m);
  } finally {
    cleanup();
  }
});

test('pr fuera de GitHub Actions: los avisos de solo detección se imprimen al final, sin anotaciones', () => {
  const { root, env, cleanup } = repo(FILES);
  try {
    const out = execFileSync('node', [BIN, 'pr', '.', '--dry-run'], { cwd: root, encoding: 'utf8', env });
    assert.match(out, /Avisos sin PR \(solo detección\):/);
    assert.match(out, /src\/ia\.js:3 +El modelo `gpt-4` (se retira|fue retirado) el 2026-10-23/);
    assert.doesNotMatch(out, /::warning/);
  } finally {
    cleanup();
  }
});

test('inventario: en PHP y Python los usos todavía no se analizan; en JS/TS, "sin usos encontrados" es lo que se buscó', () => {
  assert.equal(noUsesLabel({ kind: 'sdk', ecosystem: 'composer' }), 'declarada en composer.json; los usos en PHP todavía no se analizan');
  assert.equal(noUsesLabel({ kind: 'sdk', ecosystem: 'pypi' }), 'declarada en requirements.txt; los usos en Python todavía no se analizan');
  assert.equal(noUsesLabel({ kind: 'sdk', ecosystem: 'npm' }), 'declarada, sin usos encontrados');
  const out = execFileSync('node', [BIN, 'scan', path.join(ROOT, 'examples', 'tienda-php')], { encoding: 'utf8' });
  assert.match(out, /afipsdk\/afip\.php +alta +\(declarada en composer\.json; los usos en PHP todavía no se analizan\)/);
  assert.doesNotMatch(out, /sin usos encontrados/);
});

test('plantilla del workflow: npm ci solo con package-lock.json y composer install solo con composer.json', () => {
  const t = fs.readFileSync(path.join(ROOT, 'templates', 'github-workflow.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(t, /if: hashFiles\('package-lock\.json'\) != ''\n {8}run: npm ci$/m);
  assert.match(t, /if: hashFiles\('composer\.json'\) != ''\n {8}run: composer install --no-interaction --no-progress$/m);
  assert.equal(t.match(/run: npm ci/g).length, 1, 'no queda un npm ci sin condición');
});
