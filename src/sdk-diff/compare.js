// Comparación de dos superficies de un SDK (surface.js) y cruce con las operaciones que usa el repo.
// Todo lo que sale de acá es detect-only: avisa qué cambia, no reescribe código (nivel 1).

const NS = ['default', 'exports'];

const required = (sig) => sig.params.filter((p) => !p.optional).length;
const minRequired = (sigs) => Math.min(...sigs.map(required));
const maxParams = (sigs) => Math.max(...sigs.map((s) => s.params.length));
const hasRest = (sigs) => sigs.some((s) => s.params.some((p) => p.rest));
const short = (t) => (t.length > 80 ? `${t.slice(0, 77)}...` : t);

// Cambios entre la superficie vieja (a) y la nueva (b).
// → [{ ns, path, type: 'removed' | 'new-required' | 'param-removed' | 'type-changed' | 'deprecated', message }]
export function diffSurfaces(a, b) {
  const changes = [];
  for (const ns of NS) {
    // Si la versión nueva no expone nada en este lado (pasa cuando cambia la forma del módulo, por ejemplo de
    // exports con nombre a `export =`), no se puede distinguir "se borró" de "no se pudo leer": no se compara.
    if (b[ns].size === 0 && a[ns].size > 0) continue;
    const removedRoots = [];
    for (const [p, ea] of a[ns]) {
      if (removedRoots.some((r) => p.startsWith(`${r}.`))) continue; // ya se reportó el padre
      const eb = b[ns].get(p);
      if (!eb) {
        removedRoots.push(p);
        changes.push({ ns, path: p, type: 'removed', message: `\`${p}\` ya no existe.` });
        continue;
      }
      if (ea.signatures && eb.signatures) changes.push(...compareSignatures(ns, p, ea.signatures, eb.signatures));
      if (eb.deprecated && !ea.deprecated) {
        changes.push({ ns, path: p, type: 'deprecated', message: `\`${p}\` pasó a estar deprecado${eb.deprecated !== 'deprecado' ? `: ${short(eb.deprecated)}` : '.'}` });
      }
    }
  }
  return changes;
}

function compareSignatures(ns, p, sa, sb) {
  const out = [];
  const reqA = minRequired(sa);
  const reqB = minRequired(sb);
  if (reqB > reqA) {
    const best = sb.find((s) => required(s) === reqB);
    const oldNames = new Set(sa.flatMap((s) => s.params.filter((x) => !x.optional).map((x) => x.name)));
    const nuevos = best.params.filter((x) => !x.optional && !oldNames.has(x.name)).map((x) => x.name);
    out.push({ ns, path: p, type: 'new-required',
      message: `\`${p}\` pide más parámetros obligatorios (${reqA} → ${reqB}${nuevos.length ? `: ${nuevos.join(', ')}` : ''}).` });
  }
  if (!hasRest(sb) && maxParams(sb) < maxParams(sa)) {
    const newNames = new Set(sb.flatMap((s) => s.params.map((x) => x.name)));
    const quitados = sa.flatMap((s) => s.params.map((x) => x.name)).filter((n, i, all) => !newNames.has(n) && all.indexOf(n) === i);
    out.push({ ns, path: p, type: 'param-removed',
      message: `\`${p}\` acepta menos parámetros (${maxParams(sa)} → ${maxParams(sb)}${quitados.length ? `: se quitó ${quitados.join(', ')}` : ''}).` });
  }
  // Tipos: solo con una firma de cada lado (con sobrecargas, comparar por posición confunde más de lo que ayuda).
  if (sa.length === 1 && sb.length === 1) {
    const n = Math.min(sa[0].params.length, sb[0].params.length);
    for (let i = 0; i < n; i++) {
      const pa = sa[0].params[i];
      const pb = sb[0].params[i];
      if (pa.type !== pb.type) {
        out.push({ ns, path: p, type: 'type-changed',
          message: `En \`${p}\`, el parámetro \`${pb.name}\` cambió de tipo: \`${short(pa.type)}\` → \`${short(pb.type)}\`.` });
      }
    }
  }
  return out;
}

// ¿En qué parte de la superficie vieja vive esta operación? La ruta exacta o, si no, su prefijo más largo.
function namespaceOf(op, surface) {
  let best = null;
  for (const ns of NS) {
    const parts = op.split('.');
    for (let i = parts.length; i > 0; i--) {
      const pre = parts.slice(0, i).join('.');
      if (surface[ns].has(pre)) {
        if (!best || i > best.depth) best = { ns, depth: i };
        break;
      }
    }
  }
  return best && best.ns;
}

// Para mostrar y contar: el mismo cambio suele verse por varios caminos (la instancia del export por defecto,
// la clase exportada y la fábrica: clientes.borrar, Cliente.clientes.borrar, crearCliente.clientes.borrar).
// Se queda con el más corto. El cruce con el repo usa la lista completa, porque el repo puede usar cualquiera.
export function dedupeChanges(changes) {
  const seen = new Set(changes.filter((c) => c.ns === 'default').map((c) => `${c.type}|${c.path}`));
  const out = [];
  for (const c of changes) {
    if (c.ns === 'exports') {
      const rest = c.path.split('.').slice(1).join('.');
      if (rest && seen.has(`${c.type}|${rest}`)) continue;
      const key = `${c.type}|${rest || c.path}`;
      if (rest && seen.has(`x|${key}`)) continue;
      if (rest) seen.add(`x|${key}`);
    }
    out.push(c);
  }
  return out;
}

// Operaciones del repo que no aparecen en los tipos de la versión instalada: sobre esas no se puede afirmar nada.
export function unverifiedOperations(operations, oldSurface) {
  return operations.filter((op) => !namespaceOf(op, oldSurface));
}

// Operaciones del repo (del inventario) que tocan un cambio: la misma ruta, o una ruta padre que desapareció.
// → [{ op, changes: [...] }]  (solo las operaciones afectadas)
export function affectedOperations(changes, operations, oldSurface) {
  const out = [];
  for (const op of operations) {
    const ns = namespaceOf(op, oldSurface);
    if (!ns) continue; // la operación no está en los tipos de la versión instalada: no se puede afirmar nada
    const hits = changes.filter((c) => c.ns === ns && (c.path === op || (c.type === 'removed' && op.startsWith(`${c.path}.`))));
    if (hits.length) out.push({ op, changes: hits });
  }
  return out;
}
