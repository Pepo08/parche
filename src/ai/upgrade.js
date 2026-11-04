// Nivel 2, a prueba (0.9.0; decisión del 25/10, doc 05, fila 65): para un SDK de npm que `scan --upgrades` encuentra
// con llamadas que cambian en la versión nueva, un modelo propone el arreglo como diff y Parche lo verifica antes de que
// exista un PR. Este módulo arma la propuesta y no toca el repo; el PR (siempre borrador) lo abre src/ai/command.js.
//
// Lo que nunca hace, aunque el modelo lo proponga (cada regla es un control de Parche, no una instrucción al modelo):
// - facturación ni pagos (categorías del inventario, o un SDK que tiene un pack de ARCA o de Mercado Pago), ni un
//   archivo donde esos packs encontraron algo;
// - tocar un archivo que no sea de los del aviso, crear o borrar archivos;
// - cambiar un ID de modelo de IA (los retiros de modelos son del pack de IA, que solo avisa);
// - sumar una URL o una variable de entorno que el archivo no tenía (un cambio así puede llevarse datos);
// - diffs de más de MAX_LINES líneas.
// Y sin verificación no hay propuesta: cada archivo parsea, y con los tipos de la versión nueva no queda ningún error en
// las líneas que cambiaron ni hay más errores que antes.
import fs from 'node:fs';
import path from 'node:path';
import { parseCheck } from '../ast.js';
import { extractDiff, parseDiff, applyFile } from './patch.js';
import { typeCheck } from './types.js';
import { SYSTEM, userPrompt } from './prompt.js';

export const MAX_LINES = 400;
const MAX_BYTES = 200 * 1024;
const BLOCKED_CATEGORIES = new Set(['pagos', 'facturación']);
const BLOCKED_PACKS = new Set(['arca.wsfe.condicion-iva-receptor', 'mercadopago.payments-to-orders']);

// IDs de modelos de IA escritos como texto en el código: tienen que quedar los mismos, con la misma cantidad.
const MODEL_ID = /(['"`])((?:gpt|o\d|claude|chatgpt|text-|dall-e|whisper|tts|davinci|babbage|gemini|mistral|llama|command)[\w.:@/-]*)\1/g;
const URL = /https?:\/\/[^\s'"`)<>]+/g;
const ENV = /process\.env(?:\.(\w+)|\[\s*['"`](\w+)['"`]\s*\])/g;
const bag = (text, re, pick = (m) => m[0]) => [...String(text).matchAll(re)].map(pick).sort();
const sameBag = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const newOnes = (before, after) => [...new Set(after)].filter((x) => !before.includes(x));

// Por qué un SDK no entra al nivel 2, o null si entra.
export function excluded(api) {
  if (BLOCKED_CATEGORIES.has(api?.category)) return `es de ${api.category}: ahí van los packs verificados, nunca un arreglo con IA`;
  if ((api?.packs || []).some((p) => BLOCKED_PACKS.has(p))) return 'tiene un pack verificado de facturación o pagos';
  return null;
}

// Los archivos donde un pack de facturación o pagos encontró algo, o que usan un SDK de facturación o pagos: el nivel 2
// no los toca.
export function blockedFiles(scan) {
  const files = new Set((scan.findings || []).filter((f) => BLOCKED_PACKS.has(f.pack)).map((f) => f.file));
  for (const api of scan.inventory?.apis || []) {
    if (excluded(api)) for (const op of api.operations || []) for (const l of op.locations || []) files.add(l.file);
  }
  return files;
}

const errorsOn = (diags, lines) => diags.filter((d) => d.line && lines.includes(d.line));

// upgrade: un resultado `afectado` de checkUpgrades; api: su entrada del inventario; scan: el resultado del motor;
// ask: la llamada al modelo (src/ai/model.js), types: los tipos de la versión nueva (registry.types).
// → { ok: true, files: { rel: nuevo }, changedLines, check, usage, model } | { ok: false, reason }
export async function proposeUpgrade({ root, upgrade, api, scan, types, ask, model }) {
  const no = (reason) => ({ ok: false, package: upgrade.package, reason });
  const why = excluded(api);
  if (why) return no(why);
  const blocked = blockedFiles(scan);
  const targets = [...new Set(upgrade.affected.flatMap((a) => a.locations.map((l) => l.file)))].filter((f) => !blocked.has(f)).sort();
  if (!targets.length) return no('los únicos archivos del aviso tienen código de facturación o pagos');
  const before = Object.fromEntries(targets.map((rel) => [rel, fs.readFileSync(path.join(root, rel), 'utf8')]));
  if (Object.values(before).reduce((s, t) => s + Buffer.byteLength(t), 0) > MAX_BYTES) return no(`los archivos del aviso pasan los ${MAX_BYTES / 1024} KB`);
  if (!types) return no(`no hay tipos (.d.ts) de ${upgrade.package} ${upgrade.latest} para verificar el arreglo`);
  // Lo que se le manda al modelo, con el fin de línea pasado a "\n" (el diff se aplica sobre el original).
  const shown = Object.fromEntries(Object.entries(before).map(([rel, t]) => [rel, t.replace(/\r\n/g, '\n')]));
  const reply = await ask({ system: SYSTEM, user: userPrompt({ upgrade, files: shown }), model });
  if (/^\s*NO_CHANGE\b/.test(reply.text)) return no(`el modelo no propuso un cambio: ${reply.text.replace(/^\s*NO_CHANGE\s*/, '').trim() || 'sin motivo'}`);
  let parsed;
  try {
    const diff = extractDiff(reply.text);
    if (!diff) return no('la respuesta del modelo no trae un diff');
    parsed = parseDiff(diff);
  } catch (err) {
    return no(`el diff del modelo no se puede leer: ${err.message}`);
  }
  const outside = parsed.map((f) => f.path).filter((p) => !targets.includes(p));
  if (outside.length) return no(`el diff toca archivos que no son del aviso: ${outside.join(', ')}`);
  const after = { ...before };
  const changedLines = {};
  let size = 0;
  for (const f of parsed) {
    try {
      const r = applyFile(after[f.path], f.hunks);
      after[f.path] = r.output;
      changedLines[f.path] = [...(changedLines[f.path] || []), ...r.changed];
    } catch (err) {
      return no(`el diff no se puede aplicar en ${f.path}: ${err.message}`);
    }
    size += f.hunks.reduce((s, h) => s + h.lines.filter((x) => x.t !== ' ').length, 0);
  }
  if (size > MAX_LINES) return no(`el diff cambia ${size} líneas (el máximo es ${MAX_LINES})`);
  const touched = Object.keys(changedLines);
  for (const rel of touched) {
    if (!sameBag(bag(before[rel], MODEL_ID, (m) => m[2]), bag(after[rel], MODEL_ID, (m) => m[2]))) return no(`el diff cambia un ID de modelo de IA en ${rel}`);
    const urls = newOnes(bag(before[rel], URL), bag(after[rel], URL));
    if (urls.length) return no(`el diff suma una URL que ${rel} no tenía (${urls[0]})`);
    const envs = newOnes(bag(before[rel], ENV, (m) => m[1] || m[2]), bag(after[rel], ENV, (m) => m[1] || m[2]));
    if (envs.length) return no(`el diff suma una variable de entorno que ${rel} no leía (${envs[0]})`);
    try {
      parseCheck(after[rel], rel);
    } catch (err) {
      return no(`${rel} no parsea después del arreglo: ${err.message}`);
    }
  }
  const pick = (o) => Object.fromEntries(touched.map((rel) => [rel, o[rel]]));
  const typesBefore = typeCheck({ files: pick(before), pkg: upgrade.package, types });
  const typesAfter = typeCheck({ files: pick(after), pkg: upgrade.package, types });
  const count = (r) => Object.values(r).reduce((s, d) => s + d.length, 0);
  const onChanged = touched.flatMap((rel) => errorsOn(typesAfter[rel], changedLines[rel]).map((d) => ({ file: rel, ...d })));
  const check = { syntax: true, typesBefore: count(typesBefore), typesAfter: count(typesAfter), typeErrorsOnChanged: onChanged };
  if (onChanged.length) return { ...no(`con los tipos de ${upgrade.package} ${upgrade.latest}, quedan errores en las líneas que cambió el diff: ${onChanged[0].file}:${onChanged[0].line} ${onChanged[0].message}`), check };
  if (check.typesAfter > check.typesBefore) return { ...no(`el arreglo suma errores de tipos (${check.typesBefore} antes, ${check.typesAfter} después)`), check };
  return { ok: true, package: upgrade.package, from: upgrade.installed, to: upgrade.latest, files: pick(after), changedLines, check, usage: reply.usage, model: reply.model };
}
