// Reporte del scan y cuerpo del PR, en castellano.
const LABEL = {
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

export function scanReport({ inventory, findings, packs, changed }, today = new Date()) {
  const out = [];
  out.push(`# Parche — reporte de \`${inventory.repo}\``, '');
  out.push('## APIs que usa este repo', '');
  const pk = Object.entries(inventory.packages);
  if (pk.length) out.push(...pk.map(([n, v]) => `- \`${n}\` ${v}`), '');
  for (const [prov, p] of Object.entries(inventory.providers)) {
    out.push(`- **${prov}**: ${p.callSites} usos en ${p.files.length} archivo(s) — ${Object.entries(p.ops).map(([o, n]) => `${o} ×${n}`).join(', ')}`);
  }
  out.push('');
  for (const pack of packs) {
    const fs = findings.filter((f) => f.pack === pack.id);
    if (!fs.length) continue;
    out.push(`## ${pack.title}`, '');
    out.push(`**Proveedor:** ${pack.provider} · **Severidad:** ${SEVERITY[pack.severity]} · **Fecha límite:** ${deadlineText(pack, today)}`, '');
    out.push(pack.summary_es, '');
    for (const f of fs) {
      out.push(`- ${LABEL[f.status]} \`${f.file}${f.line ? `:${f.line}` : ''}\` — ${f.message}`);
      if (f.suggestion) out.push(`  - Sugerido: \`${f.suggestion}\``);
    }
    out.push('');
  }
  if (changed && changed.length) {
    out.push('## Archivos modificados', '', ...changed.map((c) => `- \`${c.file}\` (${c.packs.join(', ')})`), '');
  }
  return out.join('\n');
}

export function prBody({ pack, findings, changed, verification }, today = new Date()) {
  const fs = findings.filter((f) => f.pack === pack.id);
  const c = counts(fs);
  const out = [];
  out.push(`## ${pack.title}`, '');
  out.push(`> **${pack.provider}** · severidad ${SEVERITY[pack.severity]} · fecha límite: ${deadlineText(pack, today)}`, '');
  out.push('### Qué cambió', '', pack.why_es, '');
  out.push('### Qué hace este PR', '');
  const applied = fs.filter((f) => f.status === 'auto' || f.status === 'needs-review');
  out.push(changed.length
    ? `Modifica ${changed.length} archivo(s): ${changed.map((x) => `\`${x.file}\``).join(', ')}.`
    : 'No modifica archivos: solo reporta lo que hay que resolver a mano.', '');
  for (const f of applied) out.push(`- ${LABEL[f.status]} \`${f.file}:${f.line}\` — ${f.message}`);
  const pending = fs.filter((f) => f.status === 'needs-input' || f.status === 'blocked');
  if (pending.length) {
    out.push('', '### Lo que este PR NO resuelve (necesita una persona)', '');
    for (const f of pending) {
      out.push(`- ${LABEL[f.status]} \`${f.file}:${f.line}\` — ${f.message}`);
      if (f.suggestion) out.push(`  - Agregá: \`${f.suggestion}\``);
    }
  }
  out.push('', '### Verificación', '');
  if (verification) {
    out.push(`- Sintaxis de los archivos modificados: ${verification.parse.ok ? '✅ OK' : '❌ ' + verification.parse.errors.join('; ')}`);
    if (verification.tests) out.push(`- Tests del repo (\`npm test\`): ${verification.tests.ok ? '✅ pasan' : verification.tests.skipped ? '— no hay script de test' : '❌ fallan'}`);
  } else {
    out.push('- Sin verificar (corré `parche pr --verify`).');
  }
  out.push('', '### Checklist antes de mergear', '', ...pack.review_checklist_es.map((x) => `- [ ] ${x}`), '');
  out.push('### Fuentes', '', ...pack.sources.map((s) => `- [${s.title}](${s.url})`), '');
  out.push(`<sub>Pack \`${pack.id}\` v${pack.version}, verificado el ${pack.last_verified}. Resumen: ${Object.entries(c).map(([k, v]) => `${LABEL[k]} ${v}`).join(' · ')}. ¿Este PR te sirvió? Mergealo, editalo o cerralo: Parche aprende de cada resultado.</sub>`, '');
  return out.join('\n');
}

export { LABEL };
