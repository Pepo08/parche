// Lo que el resumen semanal lee de GitHub en una corrida de la Action, con el token del workflow: la foto de la corrida
// anterior (para separar lo nuevo de lo que sigue y de lo resuelto) y los PRs de Parche del repo. Si algo falla (por
// ejemplo, el workflow no tiene `actions: read`), el resumen sale igual, sin esa parte, y dice por qué. `request` es
// `fetch`; los tests le pasan uno propio, sin red.
import { unzip } from '../zip.js';
import { isParcheCommit } from '../publish.js';

const headers = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });

// De qué repo, commit y corrida es esta foto (en GitHub Actions).
export function actionsRun(env = process.env) {
  const repository = env.GITHUB_REPOSITORY || null;
  const runId = env.GITHUB_RUN_ID || null;
  const server = env.GITHUB_SERVER_URL || 'https://github.com';
  return {
    repository,
    sha: env.GITHUB_SHA || null,
    ref: env.GITHUB_REF_NAME || null,
    runId,
    runAttempt: env.GITHUB_RUN_ATTEMPT || null,
    url: repository && runId ? `${server}/${repository}/actions/runs/${runId}` : null,
  };
}

export const parseLedger = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const DAY = 86400000;

// La foto contra la que se compara: la más reciente de por lo menos 6 días antes (la de la semana anterior); si no hay
// ninguna tan vieja, la más vieja que haya (la primera de esta semana). Nunca la de esta misma corrida.
export function pickPrevious(artifacts, { runId, ref, now = Date.now() }) {
  const ok = artifacts
    .filter((a) => !a.expired && String(a.workflow_run?.id) !== String(runId) && (!ref || !a.workflow_run?.head_branch || a.workflow_run.head_branch === ref))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return ok.find((a) => Date.parse(a.created_at) <= now - 6 * DAY) || ok.at(-1) || null;
}

export async function previousSnapshot({ token, repository, name = 'parche', runId, ref, now, request = fetch }) {
  const res = await request(`https://api.github.com/repos/${repository}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`, { headers: headers(token) });
  if (!res.ok) {
    return { snapshot: null, note: res.status === 403 || res.status === 404
      ? 'Sin la foto de la semana anterior: el workflow necesita el permiso `actions: read` para leerla (ver la guía de instalación).'
      : `Sin la foto de la semana anterior: GitHub respondió ${res.status} al listar los artifacts.` };
  }
  const prev = pickPrevious((await res.json()).artifacts || [], { runId, ref, now });
  if (!prev) return { snapshot: null, note: null };
  // GitHub responde con una redirección al almacenamiento del artifact: se sigue a mano y sin el token, que es solo para
  // api.github.com.
  const first = await request(prev.archive_download_url, { headers: headers(token), redirect: 'manual' });
  const location = first.status >= 300 && first.status < 400 ? first.headers.get('location') : null;
  const zip = location ? await request(location) : first;
  if (!zip.ok) return { snapshot: null, note: `Sin la foto de la semana anterior: GitHub respondió ${zip.status} al bajarla.` };
  const files = unzip(Buffer.from(await zip.arrayBuffer()));
  if (!files.has('scan.json')) return { snapshot: null, note: null };
  return {
    snapshot: { scan: JSON.parse(files.get('scan.json').toString('utf8')), ledger: parseLedger(files.get('ledger.jsonl')), createdAt: prev.created_at },
    note: null,
  };
}

// Los PRs de Parche (ramas `parche/<pack>`): los abiertos, y los mergeados o cerrados desde `since`. Un PR mergeado es
// "sin cambios" si todos sus commits son de Parche.
export async function parchePrs({ token, repository, since, request = fetch }) {
  const res = await request(`https://api.github.com/repos/${repository}/pulls?state=all&sort=updated&direction=desc&per_page=50`, { headers: headers(token) });
  if (!res.ok) return { prs: null, note: `Sin el estado de los PRs: GitHub respondió ${res.status}.` };
  const mine = (await res.json()).filter((p) => p.head?.ref?.startsWith('parche/'));
  const pack = (p) => p.head.ref.slice('parche/'.length);
  const base = (p) => ({ number: p.number, title: p.title, url: p.html_url, pack: pack(p) });
  const prs = { open: [], merged: [], closed: [] };
  for (const p of mine) {
    if (p.state === 'open') prs.open.push({ ...base(p), draft: !!p.draft, createdAt: p.created_at });
    else if (p.merged_at && Date.parse(p.merged_at) >= since) {
      const c = await request(`https://api.github.com/repos/${repository}/pulls/${p.number}/commits?per_page=100`, { headers: headers(token) });
      const commits = c.ok ? await c.json() : null;
      const unchanged = commits ? commits.every((x) => isParcheCommit(x.commit?.message || '', { id: pack(p) })) : null;
      prs.merged.push({ ...base(p), mergedAt: p.merged_at, unchanged });
    } else if (!p.merged_at && p.closed_at && Date.parse(p.closed_at) >= since) prs.closed.push({ ...base(p), closedAt: p.closed_at });
  }
  return { prs, note: null };
}
