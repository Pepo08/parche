// 0.7.3: la foto de cada corrida de la Action (P1 de docs/app-vigilancia.md, en el repo privado) y el identificador
// estable de cada aviso (P5). Sin la foto, el inventario, los avisos y el registro se perdían con el runner; sin el
// identificador, el resumen semanal no podía separar lo nuevo de lo que sigue igual cuando se movían las líneas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { run, fingerprint } from '../src/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'parche.js');

// Un repo mínimo con dos facturas iguales de afip.js (mismo texto en las dos llamadas) y un modelo de IA retirado.
const FACTURA = [
  "import Afip from '@afipsdk/afip.js';",
  'const afip = new Afip({ CUIT: 1 });',
  'export function uno(n) {',
  '  return afip.ElectronicBilling.createVoucher({ CbteTipo: 1, DocTipo: 80, DocNro: n });',
  '}',
  'export function otro(n) {',
  '  return afip.ElectronicBilling.createVoucher({ CbteTipo: 1, DocTipo: 80, DocNro: n });',
  '}',
  '',
].join('\n');
const IA = "import OpenAI from 'openai';\nexport const pedir = (c) => c.chat.completions.create({ model: 'gpt-3.5-turbo', messages: [] });\n";

function repo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-foto-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', dependencies: { '@afipsdk/afip.js': '^1.0.0', openai: '^4.0.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, 'src', name), text);
  return root;
}
const fps = (root) => run(root).findings.map((f) => `${f.pack} ${f.fingerprint}`).sort();

test('P5: cada aviso trae un fingerprint, y dos llamadas con el mismo texto tienen uno distinto', () => {
  const root = repo({ 'factura.js': FACTURA, 'ia.js': IA });
  const { findings } = run(root);
  assert.ok(findings.every((f) => /^[0-9a-f]{16}$/.test(f.fingerprint)));
  assert.equal(new Set(findings.map((f) => f.fingerprint)).size, findings.length);
  // Las dos facturas están en líneas con el mismo texto: el orden de aparición las distingue.
  const arca = findings.filter((f) => f.pack === 'arca.wsfe.condicion-iva-receptor' && f.file === 'src/factura.js');
  assert.deepEqual(arca.map((f) => f.line), [4, 7]);
  assert.notEqual(arca[0].fingerprint, arca[1].fingerprint);
  assert.ok(findings.some((f) => f.pack === 'ai.model-retirements'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('P5: el fingerprint no cambia si se mueven las líneas, se reindenta o se pasa a CRLF', () => {
  const before = repo({ 'factura.js': FACTURA, 'ia.js': IA });
  const moved = repo({ 'factura.js': `// arriba\n\n\n${FACTURA}`, 'ia.js': `\n\n${IA}` });
  const reindented = repo({ 'factura.js': FACTURA.replace(/^ {2}return/gm, '\t\treturn').replace(/\n/g, '\r\n'), 'ia.js': IA.replace(/\n/g, '\r\n') });
  assert.deepEqual(fps(moved), fps(before));
  assert.deepEqual(fps(reindented), fps(before));
  // Las líneas sí cambian: el fingerprint es lo que no depende de ellas.
  assert.notDeepEqual(run(moved).findings.map((f) => f.line), run(before).findings.map((f) => f.line));
  for (const r of [before, moved, reindented]) fs.rmSync(r, { recursive: true, force: true });
});

test('P5: si cambia el código de la línea, es otro aviso; si cambia solo el mensaje del pack, es el mismo', () => {
  const seen = () => new Map();
  const base = { pack: 'p', file: 'src/a.js', line: 1, status: 'needs-input', message: 'uno' };
  const fp = (f, source) => fingerprint(f, source, seen());
  assert.equal(fp(base, 'llamar(datos)\n'), fp({ ...base, message: 'otro texto', status: 'needs-review' }, 'llamar(datos)\n'));
  assert.notEqual(fp(base, 'llamar(datos)\n'), fp(base, 'llamar(otrosDatos)\n'));
  assert.notEqual(fp(base, 'x\n'), fp({ ...base, pack: 'q' }, 'x\n'));
  assert.notEqual(fp(base, 'x\n'), fp({ ...base, file: 'src/b.js' }, 'x\n'));
  // Sin línea (un aviso del archivo entero) también tiene uno.
  assert.match(fp({ ...base, line: null }, 'x\n'), /^[0-9a-f]{16}$/);
});

test('scan --json: la versión de Parche que lo generó y el fingerprint de cada aviso', () => {
  const root = repo({ 'factura.js': FACTURA });
  const out = JSON.parse(execFileSync('node', [BIN, 'scan', root, '--json'], { encoding: 'utf8' }));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(out.parcheVersion, pkg.version);
  assert.ok(out.inventory.apis.length);
  assert.ok(out.findings.length && out.findings.every((f) => f.fingerprint));
  fs.rmSync(root, { recursive: true, force: true });
});

test('P1: la Action guarda la foto de la corrida como artifact, se puede apagar y no hace fallar la corrida', () => {
  const action = fs.readFileSync(path.join(ROOT, 'action.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(action, /^ {2}snapshot:\n {4}description: .+\n {4}default: 'true'$/m);
  assert.match(action, /^ {2}snapshot-name:\n {4}description: .+\n {4}default: parche$/m);
  // Los dos pasos corren aunque `parche pr` haya fallado, salvo que se cancele o se apague la foto.
  assert.equal(action.match(/if: \$\{\{ !cancelled\(\) && inputs\.snapshot == 'true' \}\}/g).length, 2);
  assert.match(action, /args=\(scan \. --json\)/);
  assert.match(action, /cp \.parche\/ledger\.jsonl "\$dir\/ledger\.jsonl"/);
  // Si la foto falla, solo avisa.
  assert.match(action, /::warning title=Parche::No se pudo armar la foto de la corrida/);
  assert.match(action, /uses: actions\/upload-artifact@[0-9a-f]{40} # v\d/);
  assert.match(action, /name: \$\{\{ inputs\.snapshot-name \}\}/);
  // El nombre del artifact llega al script por una variable de entorno, no interpolado en el código.
  assert.doesNotMatch(action.split('- name: Foto de la corrida')[1].split('run: |')[1].split('- name:')[0], /\$\{\{/);
});
