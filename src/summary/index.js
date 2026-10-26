// `parche summary`: el resumen semanal de un repo, con el diseño de los mails de la vigilancia, armado con la foto de
// la corrida (0.8.0). No manda mails ni habla con un servidor de Parche: deja `resumen.html`, `resumen.txt` y
// `resumen.json` en la carpeta de la foto y, en GitHub Actions, lo suma al resumen del job. Cómo llega por mail se decide
// después (docs/app-vigilancia.md, sección 12, en el repo privado).
import fs from 'node:fs';
import path from 'node:path';
import { loadPacks } from '../packs.js';
import { renderMail, GMAIL_LIMIT } from './render.js';
import { weeklyData, dayIn } from './weekly.js';
import { parseLedger, previousSnapshot, parchePrs } from './github.js';

const readSnapshot = (dir) => {
  const scanPath = path.join(dir, 'scan.json');
  if (!fs.existsSync(scanPath)) return null;
  const ledgerPath = path.join(dir, 'ledger.jsonl');
  return { scan: JSON.parse(fs.readFileSync(scanPath, 'utf8')), ledger: fs.existsSync(ledgerPath) ? parseLedger(fs.readFileSync(ledgerPath, 'utf8')) : [] };
};

// El texto del mail, como markdown para el resumen del job: los títulos subrayados pasan a títulos, y el "--" de la
// firma a una línea (si no, markdown lo toma como subrayado del renglón de arriba).
export function jobSummaryMarkdown(txt, notes = []) {
  const body = txt
    .replace(/^Asunto: (.*)\n\n/, '')
    .replace(/^(\d+)\. (.+)\n-+$/gm, '### $1\\. $2')
    .replace(/\n--\n/, '\n\n---\n\n');
  const header = txt.match(/^Asunto: (.*)/)?.[1];
  return ['## Resumen de la semana', '', header ? `**${header}**` : '', '', ...notes.map((n) => `> ${n}`), notes.length ? '' : null, body, '']
    .filter((l) => l !== null).join('\n');
}

export async function summaryCommand(args, { env = process.env, request = fetch, now = Date.now() } = {}) {
  const snapshotDir = typeof args.snapshot === 'string' ? path.resolve(args.snapshot) : null;
  if (!snapshotDir) throw new Error('Uso: parche summary --snapshot <carpeta con scan.json> [--previous <carpeta>] [--out <carpeta>] [--date AAAA-MM-DD]');
  const current = readSnapshot(snapshotDir);
  if (!current) throw new Error(`No hay scan.json en ${snapshotDir}: corré antes \`parche scan . --json > ${path.join(snapshotDir, 'scan.json')}\`.`);
  const today = typeof args.date === 'string' ? args.date : dayIn(now);
  const notes = [];
  let previous = null;
  let prs = null;
  // En GitHub Actions, con el token del workflow: la foto anterior (salvo que se pase --previous) y los PRs de Parche.
  const inActions = env.GITHUB_ACTIONS === 'true' && env.GITHUB_TOKEN && env.GITHUB_REPOSITORY && !args['no-github'];
  if (typeof args.previous === 'string') {
    previous = readSnapshot(path.resolve(args.previous));
    if (!previous) notes.push(`Sin la foto anterior: no hay scan.json en ${args.previous}.`);
  } else if (inActions) {
    try {
      const r = await previousSnapshot({ token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY, name: env.PARCHE_SNAPSHOT_NAME || 'parche', runId: env.GITHUB_RUN_ID, ref: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME, now, request });
      previous = r.snapshot;
      if (r.note) notes.push(r.note);
    } catch (err) {
      notes.push(`Sin la foto de la semana anterior: ${err.message}`);
    }
  }
  if (inActions) {
    try {
      const r = await parchePrs({ token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY, since: now - 7 * 86400000, request });
      prs = r.prs;
      if (r.note) notes.push(r.note);
    } catch (err) {
      notes.push(`Sin el estado de los PRs: ${err.message}`);
    }
  }
  const datos = weeklyData({ ...current, previous, prs, packs: loadPacks(), today, outcome: env.PARCHE_PR_OUTCOME || null, notes });
  const mail = renderMail(datos);
  const outDir = typeof args.out === 'string' ? path.resolve(args.out) : snapshotDir;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'resumen.html'), mail.html);
  fs.writeFileSync(path.join(outDir, 'resumen.txt'), mail.txt);
  fs.writeFileSync(path.join(outDir, 'resumen.json'), `${JSON.stringify(datos, null, 2)}\n`);
  if (env.GITHUB_ACTIONS === 'true' && env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, jobSummaryMarkdown(mail.txt, datos.notas));
  console.log(mail.asunto);
  for (const n of datos.notas) console.log(`  ${n}`);
  console.log(`Resumen: ${path.join(outDir, 'resumen.html')} (${(Buffer.byteLength(mail.html) / 1024).toFixed(1)} KB) y resumen.txt`);
  if (Buffer.byteLength(mail.html) > GMAIL_LIMIT) console.warn('Ojo: el HTML pasa los 102 KB en los que Gmail corta el mensaje.');
  if (mail.faltan.length) console.warn(`Ojo: las plantillas pidieron datos que no están: ${mail.faltan.join(', ')}.`);
  return { datos, mail };
}
