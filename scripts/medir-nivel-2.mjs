// Mide qué tan seguido el nivel 2 propone un arreglo que pasa la verificación, en repos PÚBLICOS (nunca en código de
// clientes). No ejecuta nada de esos repos: los clona sin historia, no instala dependencias ni corre sus tests; la
// verificación es la sintaxis y los tipos de la versión nueva, que Parche baja del registry de npm sin ejecutarlos.
// Cada intento llama al modelo con ANTHROPIC_API_KEY y cuesta tokens: correlo con OK de quien paga la clave.
//
//   ANTHROPIC_API_KEY=... node scripts/medir-nivel-2.mjs repos.txt [--model claude-opus-5-5] [--out medicion.json]
//
// repos.txt: una URL de git por línea (https://github.com/dueño/repo), y opcionalmente un paquete separado por un
// espacio para medir solo ese SDK (https://github.com/dueño/repo openai). Las líneas con # se saltean.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { aiUpgradeCommand } from '../src/ai/command.js';
import { createRegistry } from '../src/sdk-diff/registry.js';

const [list, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
if (!list || !fs.existsSync(list)) {
  console.error('Uso: node scripts/medir-nivel-2.mjs repos.txt [--model <id>] [--out <archivo.json>]');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Falta ANTHROPIC_API_KEY.');
  process.exit(1);
}
const repos = fs.readFileSync(list, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => { const [url, pkg] = l.split(/\s+/); return { url, pkg }; });
const registry = createRegistry();
const rows = [];
for (const { url, pkg } of repos) {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(url)) { rows.push({ url, error: 'no es una URL pública de GitHub' }); continue; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parche-medir-'));
  try {
    execFileSync('git', ['clone', '-q', '--depth', '1', url, dir], { stdio: 'ignore', timeout: 120000 });
    const results = await aiUpgradeCommand({ measure: true, ...(pkg ? { package: pkg } : {}), ...(opt('model') ? { model: opt('model') } : {}) },
      { root: dir, registry, env: process.env });
    for (const r of results) rows.push({ url, package: r.package, from: r.upgrade?.installed, to: r.upgrade?.latest, ok: r.ok, reason: r.reason || null, check: r.check || null, usage: r.usage || null });
    if (!results.length) rows.push({ url, package: pkg || null, ok: null, reason: 'sin SDKs de npm con llamadas que cambien' });
  } catch (err) {
    rows.push({ url, error: err.message.split('\n')[0] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const tried = rows.filter((r) => r.ok !== undefined && r.ok !== null);
const passed = tried.filter((r) => r.ok);
const out = { at: new Date().toISOString(), model: opt('model') || 'claude-opus-5-5', tried: tried.length, passed: passed.length, rows };
fs.writeFileSync(opt('out') || 'medicion-nivel-2.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(`\nIntentos: ${tried.length}. Pasaron la verificación (sintaxis y tipos): ${passed.length}${tried.length ? ` (${Math.round((100 * passed.length) / tried.length)}%)` : ''}.`);
console.log('Ojo: pasar la verificación no es acertar. Lo que mide el acierto es que una persona lo mergee sin cambios.');
