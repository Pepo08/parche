// El cuerpo del PR del nivel 2 (0.9.0). Dice sin vueltas que el arreglo lo escribió un modelo de IA, cuál, con qué
// datos y qué verificó Parche: es lo que permite revisarlo como el PR de una persona.
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

export function aiPrBody({ proposal, upgrade, model, tests, lockfile }) {
  const files = Object.keys(proposal.files);
  const c = proposal.check;
  const lines = [
    `Actualiza \`${upgrade.package}\` de ${upgrade.installed} a ${upgrade.latest} y adapta las llamadas que cambian.`,
    '',
    `> **Arreglo generado con IA, a prueba (nivel 2).** Lo escribió el modelo \`${proposal.model || model}\`, con la clave que configuraste en el workflow, a partir de los cambios que Parche encontró en los tipos de \`${upgrade.package}\`. Parche lo verificó, pero no es un pack verificado: revisalo como el PR de una persona. Es un borrador y nunca se mergea solo.`,
    '',
    '## Qué cambia en el SDK y te afecta',
    '',
    ...upgrade.affected.map((a) => `- \`${a.op}\` (${a.locations.map((l) => `\`${l.file}:${l.line}\``).join(', ')}): ${a.changes.map((x) => x.message).join(' ')}`),
    '',
    '## Qué cambia en tu código',
    '',
    `- \`package.json\`: \`${upgrade.package}\` pasa a ${upgrade.latest}${lockfile ? ', y `package-lock.json` se actualizó con `npm install --package-lock-only --ignore-scripts`' : ''}.`,
    ...files.map((rel) => `- \`${rel}\`: ${plural(proposal.changedLines[rel]?.length || 0, 'línea nueva o cambiada', 'líneas nuevas o cambiadas')}.`),
    ...(lockfile ? [] : ['', 'Si usás `package-lock.json`, corré `npm install` para actualizarlo.']),
    '',
    '## Verificación',
    '',
    '- Sintaxis de cada archivo: ✅',
    `- Tipos con \`${upgrade.package}\` ${upgrade.latest} (en los archivos del arreglo): ${plural(c.typesBefore, 'error', 'errores')} antes del arreglo, ${plural(c.typesAfter, 'error', 'errores')} después, y ninguno en las líneas que cambió.`,
    tests ? '- Tests del repo: ✅ pasan, con la versión nueva instalada (`npm install --ignore-scripts`).' : '- Tests del repo: no se corrieron (`verify` apagado). Corrélos antes de mergear.',
    '',
    '## Qué se le mandó al modelo',
    '',
    `El contenido completo de ${files.map((f) => `\`${f}\``).join(', ')} y la lista de cambios de arriba. Nada más del repo. El modelo solo devolvió un diff: no corrió comandos. Parche no aplica nada fuera de esos archivos, y descarta el arreglo si cambia un ID de modelo de IA o suma una URL o una variable de entorno.`,
    '',
    '## Qué revisar',
    '',
    '- [ ] Que cada llamada nueva haga lo mismo que la vieja (los nombres de los campos de la respuesta suelen cambiar entre versiones mayores).',
    '- [ ] Los errores y los reintentos: los SDK nuevos suelen tirar otras excepciones.',
    '- [ ] Tus tests, con la versión nueva instalada.',
    '',
    '---',
    'Parche no toca código de facturación ni de pagos con IA (ahí van sus packs verificados), ni cambia modelos de IA.',
  ];
  return `${lines.join('\n')}\n`;
}
