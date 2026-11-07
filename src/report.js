// Reporte del scan y cuerpo del PR, en castellano.
import { apiLabel, noUsesLabel } from './inventory/index.js';
import { isTestFile } from './paths.js';

const LABEL ={
  auto: '✅ automático',
  'needs-review': '👀 revisar',
  'needs-input': '✋ falta un dato',
  blocked: '⛔ bloqueado',
  'detect-only': '🔎 detectado',
};
const SEVERITY = { critical: 'crítica', high: 'alta', medium: 'media', low: 'baja' };

export function daysUntil(date, today = new Date()) {
  if (!date) return null;
  const ms = new Date(date + 'T00:00:00-03:00') - today;
  return Math.ceil(ms / 86400000);
}

function deadlineText(pack, today) {
  if (!pack.deadline) return 'sin fecha límite';
  const d = daysUntil(pack.deadline, today);
  return d >= 0 ? `${pack.deadline} (faltan ${d} días)` : `${pack.deadline} (vencida hace ${-d} días)`;
}

export function counts(findings) {
  const c = {};
  for (const f of findings) c[f.status] = (c[f.status] || 0) + 1;
  return c;
}

function upgradesSection(upgrades) {
  const out = ['## Versiones nuevas de tus SDKs de npm', '',
    'Comparación de la API pública (tipos `.d.ts`) entre la versión instalada y la última publicada, cruzada con lo que usa este repo. Solo avisa: no cambia código.', '',
    '| SDK | Instalada → última | Resultado |', '|---|---|---|'];
  const STATUS = {
    afectado: (r) => `⚠ ${r.affected.length} operación(es) del repo cambian o desaparecen`,
    'sin-impacto': (r) => `✓ lo que usás no cambia (${r.totalChanges} cambios en el SDK)`,
    'al-dia': () => '✓ al día',
    'sin-verificar': () => '? tus operaciones no aparecen en los tipos instalados',
  };
  for (const r of upgrades) {
    const res = STATUS[r.status] ? STATUS[r.status](r) : `— ${r.error || 'sin versión instalada'}`;
    out.push(`| \`${r.package}\` | ${r.installed ? `${r.installed} → ${r.latest}` : '—'} | ${res} |`);
  }
  out.push('');
  for (const r of upgrades.filter((x) => x.status === 'afectado')) {
    out.push(`### \`${r.package}\` ${r.installed} → ${r.latest}`, '');
    for (const a of r.affected) {
      out.push(`- \`${a.op}\` (${a.locations.map((l) => `\`${l.file}:${l.line}\``).join(', ')}): ${a.changes.map((c) => c.message).join(' ')}`);
    }
    out.push('');
  }
  return out;
}

export function scanReport({ inventory, findings, packs, changed, upgrades = null, skipped = [] }, today = new Date()) {
  const out = [];
  out.push(`# Parche — reporte de \`${inventory.repo}\``, '');
  out.push('## APIs que usa este repo', '');
  out.push('Todas las APIs de terceros que se encontraron en el código, tengan pack de Parche o no.', '');
  if (inventory.apis.length) {
    const KIND = { sdk: 'SDK', http: 'HTTP directo', 'ai-model': 'Modelos de IA' };
    out.push('| Tipo | API | Rubro | Confianza | Operaciones (usos) | Pack |', '|---|---|---|---|---|---|');
    for (const api of inventory.apis) {
      const ops = api.operations.map((o) => `\`${o.op}\` ×${o.count}`).join(', ') || noUsesLabel(api);
      out.push(`| ${KIND[api.kind]} | ${apiLabel(api)} | ${api.category || '—'} | ${api.confidence} | ${ops} | ${api.packs.length ? 'sí' : '—'} |`);
    }
    out.push('');
  } else {
    out.push('No se encontraron APIs de terceros.', '');
  }
  if (inventory.unresolved.length) {
    out.push('**Llamadas HTTP con URL dinámica** (no se puede saber a qué host van):', '',
      ...inventory.unresolved.map((u) => `- \`${u.file}:${u.line}\` (${u.client})`), '');
  }
  if (skipped.length) {
    out.push('**Copias de respaldo que no se revisaron** (si alguna es código que corre, renombrala o movela):', '',
      ...skipped.map((s) => `- \`${s}\``), '');
  }
  if (upgrades) out.push(...upgradesSection(upgrades));
  for (const pack of packs) {
    const fs = findings.filter((f) => f.pack === pack.id);
    if (!fs.length) continue;
    out.push(`## ${pack.title}`, '');
    out.push(`**Proveedor:** ${pack.provider} · **Severidad:** ${SEVERITY[pack.severity]} · **Fecha límite:** ${deadlineText(pack, today)}`, '');
    out.push(pack.summary_es, '');
    for (const f of fs) {
      out.push(`- ${LABEL[f.status]} \`${f.file}${f.line ? `:${f.line}` : ''}\` — ${f.message}`);
      if (f.suggestion) out.push(`  - Sugerido: \`${f.suggestion}\``);
      if (f.partial) out.push(`  - ${LABEL['needs-input']} ${f.partial.message}`, `  - Cuando tengas el dato: \`${f.partial.suggestion}\``);
    }
    out.push('');
  }
  if (changed && changed.length) {
    out.push('## Archivos modificados', '', ...changed.map((c) => `- \`${c.file}\` (${c.packs.join(', ')})`), '');
  }
  return out.join('\n');
}

// Si algún arreglo es parcial, qué casos cubre ("consumidor final"): va en el título y arriba del cuerpo del PR.
export function partialCovers(findings) {
  return [...new Set(findings.filter((f) => f.partial).map((f) => f.partial.covers))];
}

// En un issue no se aplica nada: un arreglo que solo caería en un test o un mock no se puede listar como "automático"
// abajo de "no hay un arreglo automático seguro" (frente B, punto 27).
export const onlyInTests = (f) => isTestFile(f.file) && (f.status === 'auto' || f.status === 'needs-review');

// Si el repo ya manda el campo en otro archivo, el PR lo dice: quien lo recibe puede pensar que Parche no vio su
// servicio (frente B, punto 28). No cuentan los tests ni los WSDL, y tampoco los archivos que toca este mismo PR.
function alreadyUsesNote(pack, context, changed) {
  const field = pack.detect?.field;
  if (!field) return null;
  const touched = new Set(changed.map((c) => c.file));
  const elsewhere = (context?.fieldFiles || []).filter((f) => !touched.has(f) && !isTestFile(f) && !/\.wsdl$/i.test(f));
  if (!elsewhere.length) return null;
  const names = elsewhere.slice(0, 3).map((f) => `\`${f}\``).join(', ') + (elsewhere.length > 3 ? ` y ${elsewhere.length - 3} más` : '');
  return `> **El repo ya usa \`${field}\` en ${names}**, y este PR no toca esos archivos. Cubre lo que todavía no lo lleva: ${changed.map((c) => `\`${c.file}\``).join(', ')}.`;
}

// `ciApproval`: el PR lo abre GitHub Actions con el GITHUB_TOKEN por defecto. GitHub deja los workflows de ese PR
// esperando aprobación (docs de GitHub, "GITHUB_TOKEN"): sin avisarlo, el PR parece roto.
export function prBody({ pack, findings, changed, verification, ciApproval = false, context = null }, today = new Date()) {
  // Sin cambios de código el texto se usa como issue: los títulos no pueden hablar de "este PR".
  const asIssue = !changed.length;
  const all = findings.filter((f) => f.pack === pack.id);
  const inTests = asIssue ? all.filter(onlyInTests) : [];
  const fs = all.filter((f) => !inTests.includes(f));
  const c = counts(fs);
  const out = [];
  out.push(`## ${pack.title}`, '');
  out.push(`> **${pack.provider}** · severidad ${SEVERITY[pack.severity]} · fecha límite: ${deadlineText(pack, today)}`, '');
  out.push('### Qué cambió', '', pack.why_es, '');
  out.push(asIssue ? '### Qué encontró Parche' : '### Qué hace este PR', '');
  const covers = partialCovers(fs);
  if (covers.length && !asIssue) {
    out.push(`> **Este PR es parcial (${covers.join(', ')}).** Arregla solo esos casos, sin inventar datos: el resto del pedido sale igual que hoy. Lo que no cubre está en "Lo que este PR NO resuelve" y hay que completarlo antes de la fecha límite.`, '');
  }
  const applied = fs.filter((f) => f.status === 'auto' || f.status === 'needs-review');
  out.push(changed.length
    ? `Modifica ${changed.length} archivo(s): ${changed.map((x) => `\`${x.file}\``).join(', ')}.`
    : !fs.length ? 'Solo aparece en tests, mocks o scripts de prueba: no hay nada para cambiar en el código que corre.'
      : fs.every((f) => f.status === 'detect-only') ? 'Parche no encontró comprobantes sin el campo. Esto es lo que conviene revisar.'
        : 'No hay un arreglo automático seguro: esto es lo que hay que resolver a mano.', '');
  const note = changed.length ? alreadyUsesNote(pack, context, changed) : null;
  if (note) out.push(note, '');
  for (const f of applied) out.push(`- ${LABEL[f.status]} \`${f.file}:${f.line}\` — ${f.message}`);
  if (inTests.length) out.push(`- En tests, mocks o scripts de prueba (Parche no los toca): ${inTests.map((f) => `\`${f.file}:${f.line}\``).join(', ')}.`);
  // Lo que falta: los hallazgos sin arreglo y, de cada arreglo parcial, la parte que no cubre.
  const pending = [
    ...fs.filter((f) => f.status === 'needs-input' || f.status === 'blocked'),
    ...fs.filter((f) => f.partial).map((f) => ({ ...f, status: 'needs-input', message: f.partial.message, suggestion: f.partial.suggestion })),
  ];
  if (pending.length) {
    out.push('', asIssue ? '### Lo que hay que resolver (necesita una persona)' : '### Lo que este PR NO resuelve (necesita una persona)', '');
    for (const f of pending) {
      out.push(`- ${LABEL[f.status]} \`${f.file}:${f.line}\` — ${f.message}`);
      if (f.suggestion) out.push(`  - Agregá: \`${f.suggestion}\``);
    }
  }
  // Avisos de solo detección dentro de un pack con arreglo: ni los cubre el PR ni los resuelve Parche (frente B, punto 29).
  const notices = fs.filter((f) => f.status === 'detect-only');
  if (notices.length) {
    out.push('', `### ${pack.notices_title_es || 'Para revisar aparte (Parche no lo cambia)'}`, '');
    if (pack.notices_intro_es) out.push(pack.notices_intro_es, '');
    for (const f of notices) out.push(`- ${LABEL[f.status]} \`${f.file}:${f.line}\` — ${f.message}`);
  }
  // Un issue no cambia código: no hay verificación que mostrar (antes decía "Sin verificar").
  if (!asIssue) {
    out.push('', '### Verificación', '');
    if (verification) {
      out.push(`- Sintaxis de los archivos modificados: ${verification.parse.ok ? '✅ OK' : '❌ ' + verification.parse.errors.join('; ')}`);
      const t = verification.tests;
      if (t?.notRun) {
        // Lo que escribió a mano el frente B en el primer PR real (obraya), ahora lo dice Parche.
        out.push(t.ci.length
          ? `- Tests del repo: Parche no los corrió; los corre el CI de este repo (${t.ci.map((w) => `\`${w}\``).join(', ')}) en este PR.`
          : '- Tests del repo: Parche no los corrió (sin `--verify` no ejecuta código del repo). Corrélos antes de mergear.');
      } else if (t) {
        out.push(t.skipped
          ? '- Tests del repo: — no hay tests para correr; se validó la sintaxis de los archivos modificados.'
          : `- Tests del repo (${t.commands.map((c) => `\`${c}\``).join(' y ')}): ${t.ok ? '✅ pasan' : '❌ fallan'}`);
      }
    } else {
      out.push('- Sin verificar (corré `parche pr --verify`).');
    }
    if (ciApproval) {
      out.push('- CI de este PR: lo abrió GitHub Actions con el `GITHUB_TOKEN`, así que GitHub deja sus workflows esperando aprobación. Alguien con permiso de escritura tiene que tocar **Approve workflows to run**. Para que corran solos, pasale a la Action un token de una GitHub App o un token personal (input `token`).');
    }
  }
  // Los ítems que dependen de un dato del negocio (por ejemplo, los clientes con CUIT) solo van si queda algo
  // pendiente: en un PR que arregla todo, como uno de puros consumidores finales, no aplican (frente B, punto 12).
  const checklist = [...pack.review_checklist_es, ...(pending.length ? pack.review_checklist_if_pending_es || [] : [])];
  out.push('', asIssue ? '### Checklist' : '### Checklist antes de mergear', '', ...checklist.map((x) => `- [ ] ${x}`), '');
  out.push('### Fuentes', '', ...pack.sources.map((s) => `- [${s.title}](${s.url})`), '');
  const feedback = asIssue
    ? '¿Te sirvió este aviso? Cerralo cuando lo resuelvas, o contestá si algo no aplica: Parche aprende de cada resultado.'
    : '¿Este PR te sirvió? Mergealo, editalo o cerralo: Parche aprende de cada resultado.';
  out.push(`<sub>Pack \`${pack.id}\` v${pack.version}, verificado el ${pack.last_verified}. Resumen: ${Object.entries(c).map(([k, v]) => `${LABEL[k]} ${v}`).join(' · ')}. ${feedback} [¿Qué es Parche y por qué recibiste esto?](https://github.com/Pepo08/parche/blob/main/docs/por-que-recibi-este-pr.md)</sub>`, '');
  return out.join('\n');
}

export { LABEL };
