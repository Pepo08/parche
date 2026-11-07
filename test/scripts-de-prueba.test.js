// Punto 34 de startup/traccion/feedback-producto.md (7/11/2026): el PR #16 de Elitali1/proyectoPaginaWeb solo tocaba
// probar-arca.js, un script para probar ARCA a mano, y el servicio ya mandaba el campo. El mantenedor lo cerró:
// "El sistema ya informa CondicionIVAReceptorId según el receptor". Un script de prueba cuenta como un test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadPacks } from '../src/packs.js';
import { run } from '../src/engine.js';
import { isProbeScript, isTestFile } from '../src/paths.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'parche.js');
const ARCA = loadPacks().find((p) => p.id === 'arca.wsfe.condicion-iva-receptor');

function repo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-probe-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  return { root, g };
}

// El servicio ya manda el campo; el script de prueba, no (como en Elitali1).
const SERVICE = 'export const emitir = (afip) => afip.ElectronicBilling.createVoucher({\n  CbteTipo: 6,\n  DocTipo: 99,\n  DocNro: 0,\n  CondicionIVAReceptorId: 5,\n});\n';
const PROBE = 'const probar = async (afip) => {\n  const r = await afip.ElectronicBilling.createVoucher({\n    CbteTipo: 6,\n    DocTipo: 99,\n    DocNro: 0,\n  });\n  console.log(r);\n};\nprobar(globalThis.afip);\n';

test('isProbeScript: los scripts sueltos para probar a mano, por el nombre', () => {
  const probes = ['probar-arca.js', 'src/prueba.php', 'scripts/test-afip.js', 'ejemplo_factura.ts', 'pruebas.js', 'probando.mjs', 'Prueba-Factura.PHP', 'demo-arca.js', 'testear.js'];
  for (const f of probes) {
    assert.ok(isProbeScript(f), f);
    assert.ok(isTestFile(f), f);
  }
  // Código que corre: no cuentan aunque el nombre se parezca, ni una carpeta con ese nombre.
  const code = ['src/test_data.js', 'src/testimonios.js', 'contest.js', 'demo.js', 'src/probar/arca.js', 'src/pruebaDeVida.js', 'src/afip.service.ts', 'src/ejemplar.js', 'latest-arca.js'];
  for (const f of code) {
    assert.ok(!isProbeScript(f), f);
    assert.ok(!isTestFile(f), f);
  }
});

test('pr: si solo cambiaría un script de prueba, no abre un PR, no deja rama y el issue lo dice', () => {
  const { root, g } = repo({ 'src/services/arca.service.js': SERVICE, 'probar-arca.js': PROBE });
  const out = execFileSync('node', [BIN, 'pr', root, '--pack', ARCA.id, '--dry-run'], { encoding: 'utf8' });
  assert.match(out, /Solo cambiaría tests, mocks o scripts de prueba: no se abre un PR/);
  assert.equal(g('branch', '--list', 'parche/*').trim(), '', 'sin rama de Parche');
  assert.equal(g('status', '--porcelain').trim(), '', 'sin archivos modificados');
  // git puede pasarlo a CRLF al volver a main (core.autocrlf en Windows): se compara sin el fin de línea.
  assert.equal(fs.readFileSync(path.join(root, 'probar-arca.js'), 'utf8').replace(/\r\n/g, '\n'), PROBE, 'el script queda como estaba');
  const body = fs.readFileSync(path.join(root, '.parche', `pr-${ARCA.id}.md`), 'utf8');
  assert.match(body, /Solo aparece en tests, mocks o scripts de prueba/);
  assert.match(body, /En tests, mocks o scripts de prueba \(Parche no los toca\): `probar-arca\.js:2`/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('scan: el script de prueba sigue apareciendo, y el campo del servicio cuenta como "ya lo usa"', () => {
  const { root } = repo({ 'src/services/arca.service.js': SERVICE, 'probar-arca.js': PROBE });
  const result = run(root, { write: false, packIds: [ARCA.id] });
  assert.ok(result.findings.some((f) => f.file === 'probar-arca.js'), 'el hallazgo del script no se pierde');
  assert.deepEqual(result.context.fieldFiles, ['src/services/arca.service.js']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('pr: si el servicio también necesita el arreglo, el PR se abre y no toca el script de prueba', () => {
  const service = SERVICE.replace('  CondicionIVAReceptorId: 5,\n', '');
  const { root, g } = repo({ 'src/services/arca.service.js': service, 'probar-arca.js': PROBE });
  const out = execFileSync('node', [BIN, 'pr', root, '--pack', ARCA.id, '--dry-run'], { encoding: 'utf8' });
  assert.doesNotMatch(out, /no se abre un PR/);
  assert.match(g('show', '--stat', '--format=', 'parche/' + ARCA.id), /src\/services\/arca\.service\.js/);
  fs.rmSync(root, { recursive: true, force: true });
});
