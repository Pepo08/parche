// Reporte del scan y cuerpo del PR, en castellano.
import { apiLabel } from './inventory/index.js';

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

export function scanReport({ inventory, findings, packs, changed, upgrades = null }, today = new Date()) {
  const out = [];
  out.push(`# Parche — reporte de \`${inventory.repo}\``, '');
  out.push('## APIs que usa este repo', '');
  out.push('Todas las APIs de terceros que se encontraron en el código, tengan pack de Parche o no.', '');
  if (inventory.apis.length) {
    const KIND = { sdk: 'SDK', http: 'HTTP directo', 'ai-model': 'Modelos de IA' };
    out.push('| Tipo | API | Rubro | Confianza | Operaciones (usos) | Pack |', '|---|---|---|---|---|---|');
    for (const api of inventory.apis) {
      const ops = api.operations.map((o) => `\`${o.op}\` ×${o.count}`).join(', ') || 'declarada, sin usos encontrados';
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

export function prBody({ pack, findings, changed, verification }, today = new Date()) {
  const fs = findings.filter((f) => f.pack === pack.id);
  const c = counts(fs);
  const out = [];
  out.push(`## ${pack.title}`, '');
  out.push(`> **${pack.provider}** · severidad ${SEVERITY[pack.severity]} · fecha límite: ${deadlineText(pack, today)}`, '');
  out.push('### Qué cambió', '', pack.why_es, '');
  // Sin cambios de código el texto se usa como issue: los títulos no pueden hablar de "este PR".
  const asIssue = !changed.length;
  out.push(asIssue ? '### Qué encontró Parche' : '### Qué hace este PR', '');
  const covers = partialCovers(fs);
  if (covers.length && !asIssue) {
    out.push(`> **Este PR es parcial (${covers.join(', ')}).** Arregla solo esos casos, sin inventar datos: el resto del pedido sale igual que hoy. Lo que no cubre está en "Lo que este PR NO resuelve" y hay que completarlo antes de la fecha límite.`, '');
  }
  const applied = fs.filter((f) => f.status === 'auto' || f.status === 'needs-review');
  out.push(changed.length
    ? `Modifica ${changed.length} archivo(s): ${changed.map((x) => `\`${x.file}\``).join(', ')}.`
    : 'No hay un arreglo automático seguro: esto es lo que hay que resolver a mano.', '');
  for (const f of applied) out.push(`- ${LABEL[f.status]} \`${f.file}:${f.line}\` — ${f.message}`);
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
  out.push('', '### Verificación', '');
  if (verification) {
    out.push(`- Sintaxis de los archivos modificados: ${verification.parse.ok ? '✅ OK' : '❌ ' + verification.parse.errors.join('; ')}`);
    const t = verification.tests;
    if (t) {
      out.push(t.skipped
        ? '- Tests del repo: — no hay tests para correr; se validó la sintaxis de los archivos modificados.'
        : `- Tests del repo (${t.commands.map((c) => `\`${c}\``).join(' y ')}): ${t.ok ? '✅ pasan' : '❌ fallan'}`);
    }
  } else {
    out.push('- Sin verificar (corré `parche pr --verify`).');
  }
  out.push('', asIssue ? '### Checklist' : '### Checklist antes de mergear', '', ...pack.review_checklist_es.map((x) => `- [ ] ${x}`), '');
  out.push('### Fuentes', '', ...pack.sources.map((s) => `- [${s.title}](${s.url})`), '');
  out.push(`<sub>Pack \`${pack.id}\` v${pack.version}, verificado el ${pack.last_verified}. Resumen: ${Object.entries(c).map(([k, v]) => `${LABEL[k]} ${v}`).join(' · ')}. ¿Este PR te sirvió? Mergealo, editalo o cerralo: Parche aprende de cada resultado.</sub>`, '');
  return out.join('\n');
}

export { LABEL };
