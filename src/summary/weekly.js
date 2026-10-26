// Los datos del resumen semanal de un repo, con la forma que esperan las plantillas de `templates/resumen/` (la de
// `test/fixtures/resumen/semanal.json`, del diseño del chat de página), armados solo con lo que Parche sabe:
// - la foto de esta corrida (`scan.json` y `ledger.jsonl`), que siempre está;
// - la foto anterior, si está: sin ella no hay "nuevo", "resuelto" ni cambios en las APIs, y el mail lo dice;
// - los PRs de Parche según la API de GitHub, si se pudieron leer; si no, los de esta corrida, del registro.
// Lo que Parche no sabe no se inventa: quién tiene cada dato (`depende`), la lectura de una persona (`revision`) y los
// descartados no aparecen. Las reglas de agrupado son las de `web-src/resumen/para-producto.md` (F8): una fila por
// pack, más una por cada aviso al que le falta un dato; en IA, una por modelo o producto que se retira.
import { apiLabel } from '../inventory/index.js';
import { diasEntre, plural } from './render.js';

const loc = (f) => `${f.file}${f.line ? `:${f.line}` : ''}`;
// Los lugares de una fila, por archivo y por línea.
const locsOf = (findings) => [...new Set([...findings].sort((a, b) => (a.file === b.file ? (a.line || 0) - (b.line || 0) : a.file < b.file ? -1 : 1)).map(loc))];
const firstSentence = (s) => (String(s).match(/^.*?[.!?](?=\s|$)/)?.[0] || String(s)).trim();
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const shortTitle = (pack) => pack.title_short_es || pack.title;
const shortProvider = (name) => String(name).split(' (')[0];
const repoName = (repository) => String(repository).split('/').pop();
const prNumber = (url) => (String(url || '').match(/\/pull\/(\d+)/) || [])[1];

// La fuente que se cita: en un pack de varios proveedores, la del proveedor del aviso; si no, la primera.
function fuente(pack, provider) {
  const s = (provider && pack.sources.find((x) => String(x.title || '').startsWith(`${provider}:`))) || pack.sources[0];
  return s ? { titulo: String(s.title || s.url).split(' (')[0], url: s.url, verificado: pack.last_verified } : null;
}

// Fecha de calendario de Buenos Aires de un instante.
export const dayIn = (instant, timeZone = 'America/Argentina/Buenos_Aires') =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));

function countsText(findings) {
  const n = (s) => findings.filter((f) => f.status === s).length;
  const parts = [];
  if (n('auto')) parts.push(plural(n('auto'), 'cambio automático', 'cambios automáticos'));
  if (n('needs-review')) parts.push(`${n('needs-review')} para revisar`);
  return parts.join(' y ');
}

// Las filas de un pack: en uno con arreglo, una con todo lo que no necesita un dato y una por cada "falta un dato";
// en uno de solo detección, una por cada cosa que se retira (o por mensaje, si el aviso no dice qué es).
function groupsOf(pack, findings) {
  if (pack.codemod) {
    const main = findings.filter((f) => f.status !== 'needs-input');
    return [...(main.length ? [{ findings: main }] : []), ...findings.filter((f) => f.status === 'needs-input').map((f) => ({ findings: [f], input: true }))];
  }
  const by = new Map();
  for (const f of findings) {
    const k = [f.provider, f.subject || f.message, f.due].join('\u0000');
    if (!by.has(k)) by.set(k, { findings: [] });
    by.get(k).findings.push(f);
  }
  return [...by.values()];
}

function changeOf(pack, f, today) {
  if (!f.subject) return shortTitle(pack);
  if (f.dueKind === 'minimum') return `${f.subject}: puede retirarse desde esa fecha`;
  return `${f.subject}: ${f.due && f.due <= today ? 'ya se retiró' : 'se retira'}`;
}

export function weeklyData({ scan, ledger = [], previous = null, prs = null, packs, today, outcome = null, notes = [] }) {
  const byId = new Map(packs.map((p) => [p.id, p]));
  const repository = scan.run?.repository || scan.inventory?.repo || 'repo';
  const repo = repoName(repository);
  const runUrl = scan.run?.url || null;
  const prevFps = previous ? new Set(previous.scan.findings.map((f) => f.fingerprint)) : null;
  const nowFps = new Set(scan.findings.map((f) => f.fingerprint));
  // El PR de cada pack en esta corrida (registro) y, si se pudo leer, el abierto según GitHub.
  const runPr = new Map(ledger.filter((e) => e.type === 'pr' && e.url).map((e) => [e.pack, e]));
  const openPr = new Map((prs?.open || []).map((p) => [p.pack, p]));
  const errors = ledger.filter((e) => e.type === 'error');
  const reportOnly = new Map(ledger.filter((e) => e.type === 'report-only').map((e) => [e.pack, e]));

  const rows = [];
  for (const pack of packs) {
    const findings = scan.findings.filter((f) => f.pack === pack.id);
    if (!findings.length) continue;
    const pr = runPr.get(pack.id);
    const open = openPr.get(pack.id);
    const number = open?.number || pr?.number || prNumber(pr?.url);
    const url = open?.url || pr?.url || null;
    const draft = open ? open.draft : pr?.draft;
    const error = errors.find((e) => e.pack === pack.id);
    for (const g of groupsOf(pack, findings)) {
      const f0 = g.findings[0];
      const locs = locsOf(g.findings);
      const withPr = !!url && !g.input && !!pack.codemod;
      const blocked = g.findings.filter((f) => f.status === 'blocked');
      let queHacer;
      if (g.input || !pack.codemod) queHacer = f0.message;
      else if (error) queHacer = `Parche no pudo completar este pack en esta corrida: ${firstSentence(error.message)}`;
      else if (withPr) {
        const kept = pr?.existing === 'kept';
        const counts = countsText(g.findings);
        queHacer = kept
          ? `El PR #${number} tiene commits de otra persona: Parche no lo actualizó.${counts ? ` Hoy encuentra ${counts}.` : ''}`
          : `Revisar el PR #${number}${draft ? ' (borrador)' : ''}${counts ? `: ${counts}` : ''}.`;
      } else {
        const why = reportOnly.get(pack.id)?.reason;
        const counts = countsText(g.findings);
        queHacer = blocked.length === g.findings.length ? firstSentence(f0.message) : `Parche no abrió un PR${why ? ` (${why})` : ''}${counts ? `: ${counts}` : ''}.`;
      }
      if (blocked.length && blocked.length < g.findings.length) {
        queHacer += ` ${blocked.length === 1 ? `\`${loc(blocked[0])}\` queda bloqueado` : `${blocked.length} lugares quedan bloqueados`}: ${lowerFirst(firstSentence(blocked[0].message))}`;
      }
      const fps = g.findings.map((f) => f.fingerprint);
      let seguimiento = null;
      if (withPr && pr?.existing !== 'kept') seguimiento = 'en curso';
      else if (prevFps) seguimiento = fps.some((x) => prevFps.has(x)) ? 'pendiente' : 'nuevo';
      const due = f0.due || null;
      rows.push({
        row: {
          vence: due,
          ...(f0.dueKind === 'minimum' ? { rompe: false } : {}),
          proveedor: shortProvider(f0.provider || pack.provider),
          cambio: changeOf(pack, f0, today),
          repo,
          donde: locs.slice(0, 2),
          ...(locs.length > 2 ? { donde_mas: `y ${plural(locs.length - 2, 'lugar más', 'lugares más')}${withPr ? ', en el PR' : ''}` } : {}),
          ...(g.input ? { falta_dato: true } : {}),
          ...(blocked.length === g.findings.length ? { bloqueado: true } : {}),
          que_hacer: queHacer,
          ...(seguimiento ? { seguimiento } : {}),
          ...(withPr ? { link: { texto: `Ver el PR #${number}`, url } } : runUrl ? { link: { texto: 'Ver la corrida', url: runUrl } } : {}),
          fuente: fuente(pack, f0.provider),
        },
        pack,
        findings: g.findings,
      });
    }
  }
  // Lo que ya venció primero (ya falla), después por fecha, y lo que no tiene fecha al final.
  const rank = (r) => (r.row.vence ? (diasEntre(today, r.row.vence) < 0 ? 0 : 1) : 2);
  rows.sort((a, b) => rank(a) - rank(b) || String(a.row.vence || '').localeCompare(String(b.row.vence || '')));

  // El próximo vencimiento: la fecha más cercana que todavía no pasó, de un cambio que rompe ese día.
  const next = rows.filter((r) => r.row.vence && r.row.rompe !== false && diasEntre(today, r.row.vence) >= 0)[0];
  let proxima = null;
  if (next) {
    const same = rows.filter((r) => r.pack === next.pack && r.row.vence === next.row.vence);
    const n = same.reduce((s, r) => s + r.findings.length, 0);
    proxima = {
      vence: next.row.vence,
      proveedor: next.row.proveedor,
      cambio: next.row.cambio,
      resumen: next.pack.codemod ? next.pack.summary_es : firstSentence(next.findings[0].message),
      repos: `${repo}: ${n === 1 ? 'queda 1 lugar' : `quedan ${n} lugares`}${same.some((r) => r.row.falta_dato) ? ', y falta un dato' : ''}`,
      fuente: next.row.fuente,
    };
  }

  const nuevos = prevFps ? rows.flatMap((r) => {
    const fresh = r.findings.filter((f) => !prevFps.has(f.fingerprint));
    return fresh.length ? [{ proveedor: r.row.proveedor, cambio: r.row.cambio, repo, donde: loc(fresh[0]), consecuencia: firstSentence(fresh[0].message) }] : [];
  }) : [];

  const merged = new Map((prs?.merged || []).map((p) => [p.pack, p]));
  const resueltos = [];
  if (previous) {
    for (const pack of packs) {
      const before = previous.scan.findings.filter((f) => f.pack === pack.id);
      // En un pack con arreglo se cuenta sobre todo el pack ("2 de 3 lugares", como en el diseño); en IA, por modelo.
      for (const g of pack.codemod ? [{ findings: before }] : groupsOf(pack, before)) {
        if (!g.findings.length) continue;
        const gone = g.findings.filter((f) => !nowFps.has(f.fingerprint));
        if (!gone.length) continue;
        const f0 = gone[0];
        const m = merged.get(pack.id);
        const locs = locsOf(gone);
        const of = gone.length < g.findings.length ? `, ${gone.length} de ${g.findings.length} lugares` : '';
        resueltos.push({
          resuelto_el: today,
          cambio: `${shortProvider(f0.provider || pack.provider)}: ${changeOf(pack, f0, today)}${of}`,
          repo,
          donde: locs.slice(0, 3).join(', ') + (locs.length > 3 ? ` y ${locs.length - 3} más` : ''),
          como: m && pack.codemod
            ? `Con el PR #${m.number}, mergeado ${m.unchanged === true ? 'sin cambios' : m.unchanged === false ? 'con cambios' : ''}.`.replace(' .', '.')
            : 'Ya no aparece en el código.',
        });
      }
    }
  }

  const prSection = prs
    ? {
      esperan: prs.open.map((p) => ({ titulo: p.title, repo, numero: `#${p.number}`, estado: p.draft ? 'borrador' : 'listo para revisar', desde: dayIn(p.createdAt), url: p.url })),
      mergeados: prs.merged.map((p) => ({ titulo: p.title, repo, numero: `#${p.number}`, como: p.unchanged === true ? 'sin cambios' : p.unchanged === false ? 'con cambios' : 'mergeado', fecha: dayIn(p.mergedAt), url: p.url })),
      cerrados: prs.closed.map((p) => ({ titulo: p.title, repo, numero: `#${p.number}`, fecha: dayIn(p.closedAt), url: p.url })),
    }
    : {
      esperan: [...runPr.values()].map((e) => ({ titulo: `Parche: ${byId.get(e.pack)?.title || e.pack}`, repo, numero: prNumber(e.url) ? `#${prNumber(e.url)}` : '', estado: e.draft ? 'borrador' : 'listo para revisar', url: e.url })),
      mergeados: [],
      cerrados: [],
    };

  const apis = { total: scan.inventory?.apis?.length || 0, repos: 1, cambios: [] };
  if (previous) {
    const prevApis = new Map((previous.scan.inventory?.apis || []).map((a) => [a.id, a]));
    const nowApis = new Map((scan.inventory?.apis || []).map((a) => [a.id, a]));
    for (const [id, a] of nowApis) if (!prevApis.has(id)) apis.cambios.push({ signo: '+', texto: `${apiLabel(a)}: aparece en ${repo}.` });
    for (const [id, a] of prevApis) if (!nowApis.has(id)) apis.cambios.push({ signo: '−', texto: `${apiLabel(a)}: ya no aparece en ${repo}.` });
  }

  const noSePudo = errors.map((e) => ({ pack: byId.get(e.pack)?.title || e.pack, motivo: firstSentence(e.message) }));
  if (outcome === 'failure' && !noSePudo.length) noSePudo.push({ pack: '`parche pr`', motivo: 'la corrida terminó con error; el detalle está en el log.' });

  return {
    mail: 'semanal',
    fecha_envio: today,
    cliente: repository,
    remitente: { nombre: 'Parche', linea: 'Armado por la Action de Parche en tu CI · getparche.com' },
    corrida: { dia: today, repos: 1, fallas: [], ...(noSePudo.length ? { no_se_pudo: noSePudo } : {}) },
    ...(proxima ? { proxima } : {}),
    revision: null,
    sin_vigilancia: true,
    ...(previous ? {} : { sin_anterior: true }),
    notas: notes.filter(Boolean),
    clientes: [{ cliente_final: repo, para_hacer: rows.map((r) => r.row), nuevos, prs: prSection, resueltos, apis }],
  };
}
