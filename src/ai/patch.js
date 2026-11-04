// Leer y aplicar el diff que devuelve el modelo (nivel 2, 0.9.0), sin dependencias y sin `git apply`: el modelo suele
// errarle a los números de línea, así que cada bloque se ubica por su contexto, en el texto con el fin de línea del
// archivo pasado a "\n", y el resultado vuelve con el fin de línea original (regla de CLAUDE.md: respetar el formato).

// El único bloque ```diff de la respuesta (o el texto entero, si es un diff sin cerco). null si no hay ninguno.
export function extractDiff(text) {
  const fenced = [...String(text).matchAll(/```(?:diff|patch)?[ \t]*\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const diffs = fenced.filter((d) => /^--- /m.test(d) && /^\+\+\+ /m.test(d));
  if (diffs.length > 1) throw new Error('La respuesta trae más de un diff.');
  if (diffs.length === 1) return diffs[0];
  return /^--- /m.test(text) && /^\+\+\+ /m.test(text) && /^@@ /m.test(text) ? String(text) : null;
}

const cleanPath = (p) => {
  const s = p.trim().split('\t')[0];
  return s === '/dev/null' ? null : s.replace(/^[ab]\//, '');
};

// [{ path, hunks: [{ oldStart, lines: [{ t: ' ' | '-' | '+', s }] }] }]. Un archivo nuevo o borrado es un error.
export function parseDiff(diff) {
  const files = [];
  const lines = String(diff).replace(/\r\n/g, '\n').split('\n');
  let file = null;
  let hunk = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      const from = cleanPath(l.slice(4));
      const to = cleanPath(lines[i + 1].slice(4));
      if (!from || !to) throw new Error('El diff crea o borra un archivo: solo se aceptan cambios en archivos que existen.');
      if (from !== to) throw new Error(`El diff renombra un archivo (${from} → ${to}).`);
      file = { path: to, hunks: [] };
      files.push(file);
      hunk = null;
      i++;
      continue;
    }
    const h = l.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
    if (h) {
      if (!file) throw new Error('El diff tiene un bloque @@ sin archivo.');
      hunk = { oldStart: Number(h[1]), lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (l.startsWith('\\')) continue; // "\ No newline at end of file"
    const t = l[0];
    if (t === ' ' || t === '-' || t === '+') hunk.lines.push({ t, s: l.slice(1) });
    // Una línea vacía dentro del bloque es contexto vacío (el modelo a veces se come el espacio), salvo al final.
    else if (l === '' && i < lines.length - 1 && /^[ +\-@\\]/.test(lines[i + 1] || '')) hunk.lines.push({ t: ' ', s: '' });
  }
  for (const f of files) if (!f.hunks.length) throw new Error(`El diff de ${f.path} no tiene cambios.`);
  return files;
}

// Dónde empieza `block` en `lines`: igual, o (si no aparece) igual sin contar los espacios de los costados. Si aparece
// más de una vez, el lugar más cercano a `near`. -1 si no está.
function locate(lines, block, near) {
  for (const norm of [(s) => s, (s) => s.trim()]) {
    const want = block.map(norm);
    const hits = [];
    for (let i = 0; i + want.length <= lines.length; i++) {
      let ok = true;
      for (let j = 0; j < want.length && ok; j++) ok = norm(lines[i + j]) === want[j];
      if (ok) hits.push(i);
    }
    if (hits.length) return hits.sort((a, b) => Math.abs(a - near) - Math.abs(b - near))[0];
  }
  return -1;
}

const eolOf = (s) => (/\r\n/.test(s) ? '\r\n' : '\n');

// Aplica los bloques de un archivo a su texto. Las líneas de contexto se dejan como estaban (con su indentación); las
// nuevas, como las escribió el modelo. → { output, changed: [números de línea, en el resultado, de lo agregado] }
export function applyFile(source, hunks) {
  const eol = eolOf(source);
  const endsWithEol = /\r?\n$/.test(source);
  let lines = source.replace(/\r\n/g, '\n').split('\n');
  if (endsWithEol) lines.pop();
  const added = [];
  let shift = 0;
  for (const h of hunks) {
    const old = h.lines.filter((x) => x.t !== '+').map((x) => x.s);
    if (!old.length) throw new Error('Un bloque del diff no tiene contexto: no se puede ubicar.');
    const at = locate(lines, old, h.oldStart - 1 + shift);
    if (at < 0) throw new Error(`Un bloque del diff no coincide con el archivo (cerca de la línea ${h.oldStart}).`);
    const out = [];
    let k = at;
    for (const x of h.lines) {
      if (x.t === ' ') out.push(lines[k++]);
      else if (x.t === '-') k++;
      else { added.push(at + out.length + 1); out.push(x.s); }
    }
    lines = [...lines.slice(0, at), ...out, ...lines.slice(at + old.length)];
    shift += out.length - old.length;
  }
  return { output: lines.join(eol) + (endsWithEol ? eol : ''), changed: added };
}
