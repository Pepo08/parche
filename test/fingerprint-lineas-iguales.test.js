// 0.7.6 (P10): el fingerprint de un aviso no se hereda cuando se arregla otro con el mismo texto de línea. Lo encontró
// el chat de página el 25/10 armando el resumen semanal: en tienda-demo, las facturas de las líneas 14 y 62 dicen las dos
// `return afip.ElectronicBilling.createNextVoucher({`; después del arreglo de ARCA, la factura A (que sigue con "falta
// un dato") salía con el fingerprint de la otra, y el resumen la habría dado por resuelta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, fingerprint } from '../src/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCA = 'arca.wsfe.condicion-iva-receptor';

function copyOf(example) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-fp-'));
  fs.cpSync(path.join(HERE, '..', 'examples', example), dir, { recursive: true });
  return dir;
}

test('tienda-demo: después del arreglo de ARCA, la factura A conserva su fingerprint y no sale como resuelta', () => {
  const root = copyOf('tienda-demo');
  const facturacion = (r) => r.findings.filter((f) => f.pack === ARCA && f.file === 'src/facturacion.js');
  const before = facturacion(run(root));
  assert.deepEqual(before.map((f) => `${f.line} ${f.status}`), ['14 auto', '56 needs-review', '62 needs-input']);
  const facturaA = before.find((f) => f.status === 'needs-input');
  run(root, { write: true, packIds: [ARCA] });
  const after = facturacion(run(root));
  // Queda solo la factura A (corrida de línea por lo que agregó el arreglo), con el mismo fingerprint.
  assert.deepEqual(after.map((f) => f.status), ['needs-input']);
  assert.notEqual(after[0].line, facturaA.line);
  assert.equal(after[0].fingerprint, facturaA.fingerprint, 'la factura A sigue abierta: mismo fingerprint');
  // Los que se arreglaron ya no aparecen: comparando por fingerprint, salen como resueltos y la factura A no.
  const now = new Set(after.map((f) => f.fingerprint));
  assert.deepEqual(before.filter((f) => !now.has(f.fingerprint)).map((f) => f.status), ['auto', 'needs-review']);
  // Idempotencia: otra pasada no cambia nada ni mueve el fingerprint.
  assert.equal(run(root, { write: true, packIds: [ARCA] }).changed.length, 0);
  assert.deepEqual(facturacion(run(root)).map((f) => f.fingerprint), [facturaA.fingerprint]);
  fs.rmSync(root, { recursive: true, force: true });
});

const fp = (finding, source, seen = new Map()) => fingerprint(finding, source, seen);
const SOURCE = 'llamar(datos)\notra()\nllamar(datos)\n';

test('el orden cuenta entre las líneas del archivo, tengan aviso o no', () => {
  const second = { pack: 'p', file: 'a.js', line: 3 };
  const withBoth = new Map();
  fp({ pack: 'p', file: 'a.js', line: 1 }, SOURCE, withBoth);
  // Con aviso en la línea 1 o sin él, la línea 3 tiene el mismo fingerprint.
  assert.equal(fp(second, SOURCE, withBoth), fp(second, SOURCE));
  assert.notEqual(fp(second, SOURCE), fp({ ...second, line: 1 }, SOURCE));
});

test('con un solo aviso por línea, el fingerprint es el de la 0.7.3: no cambian los de siempre', () => {
  const legacy = (pack, file, text, n) => crypto.createHash('sha256').update(`${[pack, file, text].join('\u0000')}\u0000${n}`).digest('hex').slice(0, 16);
  assert.equal(fp({ pack: 'p', file: 'a.js', line: 2 }, SOURCE), legacy('p', 'a.js', 'otra()', 1));
  assert.equal(fp({ pack: 'p', file: 'a.js', line: 3 }, SOURCE), legacy('p', 'a.js', 'llamar(datos)', 2));
  const seen = new Map();
  assert.equal(fp({ pack: 'p', file: 'a.js' }, SOURCE, seen), legacy('p', 'a.js', '', 1));
  assert.equal(fp({ pack: 'p', file: 'a.js' }, SOURCE, seen), legacy('p', 'a.js', '', 2));
});

test('dos avisos del mismo pack en la misma línea tienen fingerprint distinto; el primero, el de siempre', () => {
  const seen = new Map();
  const f = { pack: 'p', file: 'a.js', line: 2 };
  const first = fp(f, SOURCE, seen);
  const second = fp(f, SOURCE, seen);
  assert.notEqual(first, second);
  assert.equal(first, fp(f, SOURCE));
  // Otro pack en la misma línea no cuenta.
  assert.equal(fp({ ...f, pack: 'q' }, SOURCE, seen), fp({ ...f, pack: 'q' }, SOURCE));
});
