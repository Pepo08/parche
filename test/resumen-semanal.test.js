// 0.8.0: el resumen de la semana, armado por la Action con la foto de la corrida y el diseño de los mails del chat de
// página (web-src/resumen/ en el repo privado, 25/10/2026). Sin red: la API de GitHub es un `fetch` falso y el zip del
// artifact se arma acá.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { run } from '../src/engine.js';
import { loadPacks } from '../src/packs.js';
import { renderMail } from '../src/summary/render.js';
import { weeklyData } from '../src/summary/weekly.js';
import { jobSummaryMarkdown, summaryCommand } from '../src/summary/index.js';
import { pickPrevious, previousSnapshot, parchePrs } from '../src/summary/github.js';
import { unzip } from '../src/zip.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'parche.js');
const FX = path.join(HERE, 'fixtures', 'resumen');
const ARCA = 'arca.wsfe.condicion-iva-receptor';
const packs = loadPacks();

// La foto de una copia de tienda-demo, como la arma la Action (scan --json).
function tiendaDemo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-resumen-'));
  fs.cpSync(path.join(ROOT, 'examples', 'tienda-demo'), dir, { recursive: true });
  const snap = () => JSON.parse(execFileSync('node', [BIN, 'scan', dir, '--json'], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } }));
  return { dir, snap };
}
const mailOf = (datos) => renderMail(datos);

test('el diseño de página sale idéntico: con los datos de su ejemplo, el mismo HTML y el mismo texto', () => {
  const datos = JSON.parse(fs.readFileSync(path.join(FX, 'semanal.json'), 'utf8'));
  const mail = renderMail(datos);
  const html = fs.readFileSync(path.join(FX, 'semanal.html'), 'utf8').replace(/(<body[^>]*>)\n<div[^\n]*Ejemplo con datos armados[^\n]*<\/div>/, '$1');
  const txt = fs.readFileSync(path.join(FX, 'semanal.txt'), 'utf8').replace(/^\[Ejemplo[^\n]*\]\n\n/, '');
  assert.equal(mail.html, html);
  assert.equal(mail.txt, txt);
  assert.deepEqual(mail.faltan, []);
});

test('primera foto de un repo: los avisos por fecha, el próximo vencimiento, y lo nuevo y lo resuelto, para la próxima', () => {
  const { dir, snap } = tiendaDemo();
  const scan = snap();
  const datos = weeklyData({ scan, packs, today: '2026-11-02' });
  const filas = datos.clientes[0].para_hacer;
  // Lo vencido primero, después por fecha, y Mercado Pago (sin fecha) al final. ARCA: una fila con el PR y otra con el dato.
  assert.deepEqual(filas.map((r) => `${r.vence || '-'} ${r.proveedor}`), [
    '2026-02-19 Anthropic', '2026-08-26 OpenAI', '2026-12-01 ARCA', '2026-12-01 ARCA', '- Mercado Pago']);
  assert.equal(filas[3].falta_dato, true);
  assert.match(filas[3].que_hacer, /comprobante clase A/);
  assert.ok(filas.every((r) => !('seguimiento' in r)), 'sin la foto anterior, el seguimiento no se inventa');
  assert.ok(filas.every((r) => !('depende' in r)), 'quién tiene el dato no se inventa');
  assert.equal(datos.proxima.vence, '2026-12-01');
  assert.equal(datos.proxima.repos, `${path.basename(dir)}: quedan 3 lugares, y falta un dato`);
  const mail = mailOf(datos);
  assert.match(mail.asunto, /: 5 para hacer$/);
  assert.doesNotMatch(mail.asunto, /nada nuevo/);
  assert.match(mail.txt, /Es la primera foto de este repo: lo nuevo se ve desde la próxima corrida\./);
  assert.match(mail.txt, /Es la primera foto de este repo: lo resuelto se ve desde la próxima corrida\./);
  assert.doesNotMatch(mail.txt, /Nada nuevo esta semana|Sin cambios desde la semana pasada|respondeme|vigilancia de Parche|Hola, /);
  assert.match(mail.txt, /6 APIs en 1 repo\./);
  assert.match(mail.txt, /Lo armó la Action de Parche en el CI de /);
  assert.deepEqual(mail.faltan, []);
  assert.doesNotMatch(mail.html + mail.txt, /\{\{|\}\}/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('la semana siguiente, después del arreglo de ARCA: 2 de 3 lugares resueltos y la factura A sigue pendiente', () => {
  const { dir, snap } = tiendaDemo();
  const before = snap();
  run(dir, { write: true, packIds: [ARCA] });
  const now = snap();
  const datos = weeklyData({ scan: now, previous: { scan: before }, packs, today: '2026-11-09' });
  const c = datos.clientes[0];
  const arca = c.para_hacer.filter((r) => r.proveedor === 'ARCA');
  assert.deepEqual(arca.map((r) => [r.falta_dato, r.seguimiento]), [[true, 'pendiente']]);
  assert.deepEqual(c.resueltos.map((r) => r.cambio), ['ARCA: `CondicionIVAReceptorId` obligatorio en WSFEv1, 2 de 3 lugares']);
  assert.equal(c.resueltos[0].como, 'Ya no aparece en el código.');
  assert.deepEqual(c.nuevos, []);
  const mail = mailOf(datos);
  assert.match(mail.asunto, /: 4 para hacer, nada nuevo$/);
  assert.match(mail.txt, /Nada nuevo esta semana\./);
  assert.match(mail.txt, /6 APIs en 1 repo\. Sin cambios desde la semana pasada\./);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('un aviso nuevo sale en "Nuevo esta semana" y marcado como nuevo; una API nueva, en "Sus APIs"', () => {
  const { dir, snap } = tiendaDemo();
  const before = snap();
  fs.writeFileSync(path.join(dir, 'src', 'resumir.js'), "import OpenAI from 'openai';\nconst openai = new OpenAI();\nexport const resumir = (t) => openai.chat.completions.create({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: t }] });\n");
  fs.writeFileSync(path.join(dir, 'src', 'sms.js'), "import twilio from 'twilio';\nexport const sms = (to) => twilio().messages.create({ to, body: 'hola' });\n");
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  pkg.dependencies.twilio = '^5.0.0';
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  const datos = weeklyData({ scan: snap(), previous: { scan: before }, packs, today: '2026-11-09' });
  const c = datos.clientes[0];
  assert.deepEqual(c.nuevos.map((n) => `${n.proveedor} ${n.donde}`), ['OpenAI src/resumir.js:3']);
  assert.match(c.nuevos[0].consecuencia, /^El modelo `gpt-3\.5-turbo` fue retirado el /);
  assert.equal(c.para_hacer.find((r) => r.donde.includes('src/resumir.js:3')).seguimiento, 'nuevo');
  assert.equal(c.para_hacer.find((r) => r.proveedor === 'ARCA').seguimiento, 'pendiente');
  assert.ok(c.apis.cambios.some((x) => x.signo === '+' && /Twilio/.test(x.texto)));
  assert.match(mailOf(datos).asunto, /, 1 nuevo$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('los PRs: los de la corrida (registro) y, con la API, los abiertos, los mergeados sin cambios y lo que resolvieron', () => {
  const { dir, snap } = tiendaDemo();
  const before = snap();
  const ledger = [{ type: 'pr', pack: 'mercadopago.payments-to-orders', url: 'https://github.com/acme/tienda/pull/15', draft: true, existing: 'unchanged' }];
  const soloRegistro = weeklyData({ scan: before, ledger, packs, today: '2026-11-02' }).clientes[0];
  assert.deepEqual(soloRegistro.prs.esperan.map((p) => [p.numero, p.estado, 'desde' in p]), [['#15', 'borrador', false]]);
  const mp = soloRegistro.para_hacer.find((r) => r.proveedor === 'Mercado Pago');
  assert.equal(mp.seguimiento, 'en curso');
  assert.match(mp.que_hacer, /^Revisar el PR #15 \(borrador\): 3 cambios automáticos y 8 para revisar\. `src\/marketplace\.cjs:7` queda bloqueado: usa `application_fee`/);
  assert.deepEqual(mp.link, { texto: 'Ver el PR #15', url: 'https://github.com/acme/tienda/pull/15' });
  assert.match(mailOf(weeklyData({ scan: before, ledger, packs, today: '2026-11-02' })).txt, /\(\w[\w-]*#15\), borrador\. https:\/\/github\.com\/acme\/tienda\/pull\/15/);

  run(dir, { write: true, packIds: [ARCA] });
  const prs = {
    open: [{ number: 15, title: 'Parche: Migración', url: 'https://github.com/acme/tienda/pull/15', pack: 'mercadopago.payments-to-orders', draft: true, createdAt: '2026-10-23T12:00:00Z' }],
    merged: [{ number: 14, title: 'Parche: ARCA', url: 'https://github.com/acme/tienda/pull/14', pack: ARCA, mergedAt: '2026-11-04T15:00:00Z', unchanged: true }],
    closed: [],
  };
  const c = weeklyData({ scan: snap(), previous: { scan: before }, ledger, prs, packs, today: '2026-11-09' }).clientes[0];
  assert.deepEqual(c.prs.esperan.map((p) => [p.numero, p.desde]), [['#15', '2026-10-23']]);
  assert.deepEqual(c.prs.mergeados.map((p) => [p.numero, p.como, p.fecha]), [['#14', 'sin cambios', '2026-11-04']]);
  assert.equal(c.resueltos[0].como, 'Con el PR #14, mergeado sin cambios.');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('un pack que no se pudo completar lo dice arriba, y nada se inventa sobre él', () => {
  const { dir, snap } = tiendaDemo();
  const ledger = [{ type: 'error', pack: ARCA, message: 'La verificación falló para arca; no se abre el PR y el repo queda como estaba.\n{ "detalle": 1 }' }];
  const datos = weeklyData({ scan: snap(), ledger, packs, today: '2026-11-02' });
  assert.deepEqual(datos.corrida.no_se_pudo, [{ pack: 'Condición frente al IVA del receptor obligatoria en WSFEv1', motivo: 'La verificación falló para arca; no se abre el PR y el repo queda como estaba.' }]);
  const arca = datos.clientes[0].para_hacer.find((r) => r.proveedor === 'ARCA' && !r.falta_dato);
  assert.match(arca.que_hacer, /^Parche no pudo completar este pack en esta corrida: La verificación falló/);
  const mail = mailOf(datos);
  assert.match(mail.txt, /pero no pudo completar 1 pack\.\n- No se pudo con Condición frente al IVA/);
  assert.doesNotMatch(mail.txt, /detalle/);
  // Si la corrida falló sin registrar el error (se cortó antes), también se dice.
  assert.equal(weeklyData({ scan: snap(), packs, today: '2026-11-02', outcome: 'failure' }).corrida.no_se_pudo[0].pack, '`parche pr`');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('el resumen del job: el texto del mail como markdown, con las notas arriba', () => {
  const md = jobSummaryMarkdown('Asunto: Parche · a/b · semana del 9/11: 1 para hacer\n\nHola\n\n1. Para hacer, por fecha\n------------------------\n\n* algo\n\nParche\nlínea\n--\npie', ['Sin la foto de la semana anterior: el workflow necesita el permiso `actions: read`.']);
  assert.match(md, /^## Resumen de la semana\n\n\*\*Parche · a\/b · semana del 9\/11: 1 para hacer\*\*\n\n> Sin la foto/);
  assert.match(md, /\n### 1\\\. Para hacer, por fecha\n/);
  assert.match(md, /línea\n\n---\n\npie/);
  assert.doesNotMatch(md, /^-{4,}$/m);
});

// Un zip mínimo (guardado o con deflate), como los de los artifacts.
function zipOf(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data);
    const comp = e.method === 8 ? zlib.deflateRawSync(data) : data;
    const name = Buffer.from(e.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(e.method, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(e.method, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, comp);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('el zip del artifact: entradas guardadas y con deflate', () => {
  const files = unzip(zipOf([{ name: 'scan.json', data: '{"a":1}', method: 8 }, { name: 'ledger.jsonl', data: '{"type":"scan"}\n', method: 0 }]));
  assert.equal(files.get('scan.json').toString(), '{"a":1}');
  assert.equal(files.get('ledger.jsonl').toString(), '{"type":"scan"}\n');
  assert.throws(() => unzip(Buffer.from('no es un zip')), /no es un zip/);
});

const DAY = 86400000;
const NOW = Date.parse('2026-11-09T12:00:00Z');
const art = (id, daysAgo, runId, extra = {}) => ({ id, expired: false, created_at: new Date(NOW - daysAgo * DAY).toISOString(), workflow_run: { id: runId, head_branch: 'main' }, archive_download_url: `https://api.github.com/a/${id}/zip`, ...extra });

test('la foto anterior: la de la semana pasada, si no la más vieja de esta semana, nunca la de esta corrida', () => {
  const list = [art(1, 0, 99), art(2, 2, 98), art(3, 7, 97), art(4, 14, 96), art(5, 8, 95, { expired: true }), art(6, 7, 94, { workflow_run: { id: 94, head_branch: 'otra' } })];
  assert.equal(pickPrevious(list, { runId: 99, ref: 'main', now: NOW }).id, 3);
  assert.equal(pickPrevious([art(1, 0, 99), art(2, 2, 98), art(7, 1, 93)], { runId: 99, ref: 'main', now: NOW }).id, 2);
  assert.equal(pickPrevious([art(1, 0, 99)], { runId: 99, now: NOW }), null);
});

test('previousSnapshot baja el zip siguiendo la redirección sin el token, y sin `actions: read` lo dice', async () => {
  const scan = { findings: [{ fingerprint: 'abc' }], inventory: { apis: [] } };
  const zip = zipOf([{ name: 'scan.json', data: JSON.stringify(scan), method: 8 }, { name: 'ledger.jsonl', data: '{"type":"pr","pack":"x","url":"u"}\n', method: 8 }]);
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push([url, init.headers?.Authorization ? 'con token' : 'sin token', init.redirect || '']);
    if (url.includes('/actions/artifacts?')) return { ok: true, status: 200, json: async () => ({ artifacts: [art(1, 0, 99), art(3, 7, 97)] }) };
    if (url.endsWith('/a/3/zip')) return { ok: false, status: 302, headers: { get: (h) => (h === 'location' ? 'https://almacen.example/3.zip' : null) } };
    if (url === 'https://almacen.example/3.zip') return { ok: true, status: 200, arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length) };
    throw new Error(`inesperado: ${url}`);
  };
  const r = await previousSnapshot({ token: 't', repository: 'acme/tienda', runId: 99, ref: 'main', now: NOW, request: fakeFetch });
  assert.deepEqual(r.snapshot.scan, scan);
  assert.deepEqual(r.snapshot.ledger, [{ type: 'pr', pack: 'x', url: 'u' }]);
  assert.deepEqual(calls.map((c) => c.slice(1)), [['con token', ''], ['con token', 'manual'], ['sin token', '']]);
  const sinPermiso = await previousSnapshot({ token: 't', repository: 'acme/tienda', runId: 99, request: async () => ({ ok: false, status: 403 }) });
  assert.equal(sinPermiso.snapshot, null);
  assert.match(sinPermiso.note, /necesita el permiso `actions: read`/);
});

test('parchePrs: solo las ramas parche/, y "sin cambios" si todos los commits del PR son de Parche', async () => {
  const pulls = [
    { number: 15, title: 'Parche: MP', html_url: 'u15', state: 'open', draft: true, created_at: '2026-10-23T12:00:00Z', head: { ref: 'parche/mercadopago.payments-to-orders' } },
    { number: 14, title: 'Parche: ARCA', html_url: 'u14', state: 'closed', merged_at: '2026-11-04T15:00:00Z', closed_at: '2026-11-04T15:00:00Z', head: { ref: `parche/${ARCA}` } },
    { number: 13, title: 'Parche: viejo', html_url: 'u13', state: 'closed', merged_at: '2026-09-01T15:00:00Z', closed_at: '2026-09-01T15:00:00Z', head: { ref: `parche/${ARCA}` } },
    { number: 12, title: 'Otra cosa', html_url: 'u12', state: 'open', head: { ref: 'feature/x' } },
  ];
  const fakeFetch = async (url) => {
    if (url.includes('/pulls?')) return { ok: true, json: async () => pulls };
    if (url.includes('/pulls/14/commits')) return { ok: true, json: async () => [{ commit: { message: `Parche: ARCA\n\nresumen\nPack ${ARCA} v1.` } }] };
    throw new Error(`inesperado: ${url}`);
  };
  const { prs } = await parchePrs({ token: 't', repository: 'acme/tienda', since: NOW - 7 * DAY, request: fakeFetch });
  assert.deepEqual(prs.open.map((p) => [p.number, p.pack, p.draft]), [[15, 'mercadopago.payments-to-orders', true]]);
  assert.deepEqual(prs.merged.map((p) => [p.number, p.unchanged]), [[14, true]]);
  assert.deepEqual(prs.closed, []);
});

test('parche summary: deja resumen.html, .txt y .json en la foto; sin scan.json explica qué correr', async () => {
  const { dir, snap } = tiendaDemo();
  const foto = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-foto-'));
  fs.writeFileSync(path.join(foto, 'scan.json'), JSON.stringify(snap()));
  const r = spawnSync('node', [BIN, 'summary', '--snapshot', foto, '--date', '2026-11-02'], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Parche · .* · semana del 2\/11: 5 para hacer/);
  for (const f of ['resumen.html', 'resumen.txt', 'resumen.json']) assert.ok(fs.existsSync(path.join(foto, f)), f);
  assert.ok(fs.statSync(path.join(foto, 'resumen.html')).size < 102 * 1024);
  const vacio = spawnSync('node', [BIN, 'summary', '--snapshot', dir], { encoding: 'utf8' });
  assert.notEqual(vacio.status, 0);
  assert.match(vacio.stderr, /No hay scan\.json en .*parche scan \. --json/);
  // En GitHub Actions lo suma al resumen del job.
  const job = path.join(foto, 'job.md');
  await summaryCommand({ snapshot: foto, date: '2026-11-02', 'no-github': true }, { env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: job } });
  assert.match(fs.readFileSync(job, 'utf8'), /^## Resumen de la semana\n/);
  for (const d of [dir, foto]) fs.rmSync(d, { recursive: true, force: true });
});

test('P2: cada aviso con fecha la trae como dato; en IA, con qué se retira, de quién y si la fecha es mínima', () => {
  const { dir, snap } = tiendaDemo();
  const { findings } = snap();
  assert.ok(findings.filter((f) => f.pack === ARCA).every((f) => f.due === '2026-12-01'));
  assert.ok(findings.filter((f) => f.pack === 'mercadopago.payments-to-orders').every((f) => !('due' in f)));
  const haiku = findings.find((f) => f.subject === 'modelo `claude-3-5-haiku-20241022`');
  assert.deepEqual([haiku.due, haiku.dueKind, haiku.provider], ['2026-02-19', 'retirement', 'Anthropic']);
  const assistants = findings.find((f) => f.subject === 'Assistants API');
  assert.deepEqual([assistants.due, assistants.provider], ['2026-08-26', 'OpenAI']);
  const [piso, fecha] = Object.entries(packs.find((p) => p.id === 'ai.model-retirements').detect.retirement_floors)[0];
  fs.writeFileSync(path.join(dir, 'src', 'piso.js'), `export const config = { model: '${piso}' };\n`);
  const floor = snap().findings.find((f) => f.file === 'src/piso.js');
  assert.deepEqual([floor.due, floor.dueKind], [fecha, 'minimum']);
  // En el resumen, una fecha mínima no va en rojo ni cuenta como el próximo vencimiento.
  assert.equal(weeklyData({ scan: snap(), packs, today: '2026-11-02' }).clientes[0].para_hacer.find((r) => r.donde.includes('src/piso.js:1')).rompe, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('F4: el registro anota qué avisos cubre cada PR y cada reporte sin PR', () => {
  const { dir } = tiendaDemo();
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  const r = spawnSync('node', [BIN, 'pr', dir, '--dry-run', '--author', 't <t@users.noreply.github.com>'], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_TOKEN: '' } });
  assert.equal(r.status, 0, r.stderr);
  const events = fs.readFileSync(path.join(dir, '.parche', 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.type === 'pr');
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.fingerprints.length && e.fingerprints.every((x) => /^[0-9a-f]{16}$/.test(x))));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('la Action arma el resumen después de la foto y antes de subirla, se puede apagar y la plantilla pide actions: read', () => {
  const action = fs.readFileSync(path.join(ROOT, 'action.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(action, /^ {2}summary:\n {4}description: .+\n {4}default: 'true'$/m);
  const steps = [...action.matchAll(/^ {4}- name: (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(steps.slice(-3), ['Foto de la corrida', 'Resumen de la semana', 'Guardar la foto como artifact']);
  assert.match(action, /PARCHE_PR_OUTCOME: \$\{\{ steps\.pr\.outcome \}\}/);
  assert.match(action, /\|\| echo "::warning title=Parche::No se pudo armar el resumen de la semana/);
  const tpl = fs.readFileSync(path.join(ROOT, 'templates', 'github-workflow.yml'), 'utf8');
  assert.match(tpl, /^ {6}actions: read # /m);
  // Un ": " en una descripción sin comillas rompe el YAML de la Action (pasó en la CI del PR #31: "`actions: read`").
  for (const [, value] of action.matchAll(/^ {4}description: (.*)$/gm)) {
    if (!/^["']/.test(value)) assert.doesNotMatch(value, /: |^[[{&*!|>%@`]/, `description sin comillas: ${value}`);
  }
});
