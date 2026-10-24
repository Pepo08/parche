// Pack arca.wsfe.condicion-iva-receptor (PHP: afipsdk/afip.php y sus forks)
// Mismas reglas que el codemod de JS: agrega CondicionIVAReceptorId a cada
// $afip->ElectronicBilling->CreateVoucher($data) / CreateNextVoucher($data) cuando se puede inferir
// sin datos del negocio, y marca el resto para que una persona complete el dato.
// Edita con inserciones de texto mínimas sobre los offsets exactos de php-parser (ver src/php.js).
import { eolOf, applyEdits, finding } from '../ast.js';
import { parsePhp, walkPhp, phpLiteral, phpKey } from '../php.js';
import {
  PACK, decideCondition, validCodesText, missingMessage, appliedMessage, soapDetection, ARCA_HINT, libraryCaveat, alreadyMigratedPrefix,
  canApplyAtRuntime, PARTIAL_COMMENT, partialAppliedMessage, partialPending, partialLeftMessage,
  NEAR_HINT, isNearMissKey, isVoucherDetail, nearMissMessage, nearMissBothMessage, nearMissUnsureMessage,
} from './arca-rules.js';
import { emptyContext } from '../context.js';
import { isTestFile } from '../paths.js';

// En PHP los nombres de método no distinguen mayúsculas: createVoucher también es válido.
// El inventario usa el nombre oficial, así un mismo método no aparece dos veces.
const VOUCHER_METHODS = new Map([['createvoucher', 'CreateVoucher'], ['createnextvoucher', 'CreateNextVoucher']]);
// Claves que cambian la decisión: si se tocan fuera del array literal, no se puede inferir.
const DECISION_KEYS = new Set(['DocTipo', 'CbteTipo', 'DocNro']);
const FIELD = 'CondicionIVAReceptorId';
const HINT_TAIL = 'con la condición frente al IVA del cliente.';

const isLookup = (n) => n && (n.kind === 'propertylookup' || n.kind === 'nullsafepropertylookup');
const identName = (n) => (n && n.kind === 'identifier' ? n.name : null);

// '...->ElectronicBilling->CreateVoucher(...)' → nombre oficial del método; null si no es.
function voucherMethod(call) {
  const what = call.what;
  if (!isLookup(what)) return null;
  const method = identName(what.offset);
  if (!method || !VOUCHER_METHODS.has(method.toLowerCase())) return null;
  if (!isLookup(what.what) || identName(what.what.offset) !== 'ElectronicBilling') return null;
  return VOUCHER_METHODS.get(method.toLowerCase());
}

// if ($data['DocTipo'] == 99) / if ((int) $data['DocTipo'] === 99): el arreglo parcial de Parche
// (o uno igual escrito a mano). Devuelve el nombre de la variable, o null.
function partialIfVar(test) {
  if (!test || test.kind !== 'bin' || (test.type !== '==' && test.type !== '===')) return null;
  const side = (n) => (n && n.kind === 'cast' ? n.expr : n);
  const isDocTipo = (n) => n && n.kind === 'offsetlookup' && n.what?.kind === 'variable' && typeof n.what.name === 'string'
    && n.offset && phpLiteral(n.offset) === 'DocTipo';
  const [a, b] = [side(test.left), side(test.right)];
  const lookup = isDocTipo(a) ? a : isDocTipo(b) ? b : null;
  const other = lookup === a ? b : a;
  return lookup && phpLiteral(other) === 99 ? lookup.what.name : null;
}

// Asignaciones por scope: $var = ... y $var['Clave'] = ...
function collect(ast) {
  const scopes = new Map();
  const calls = [];
  const info = (scope) => {
    if (!scopes.has(scope)) scopes.set(scope, { assigns: new Map(), offsets: new Map(), partialIfs: new Map() });
    return scopes.get(scope);
  };
  const push = (map, name, value) => map.set(name, [...(map.get(name) || []), value]);
  walkPhp(ast, (node, scope) => {
    if (node.kind === 'if') {
      const v = partialIfVar(node.test);
      if (v) push(info(scope).partialIfs, v, node);
    }
    if (node.kind === 'assign') {
      const left = node.left;
      if (left.kind === 'variable' && typeof left.name === 'string') push(info(scope).assigns, left.name, node);
      else if (left.kind === 'offsetlookup' && left.what && left.what.kind === 'variable' && typeof left.what.name === 'string' && left.offset) {
        push(info(scope).offsets, left.what.name, { key: phpLiteral(left.offset), node });
      }
    }
    if (node.kind === 'call') {
      const method = voucherMethod(node);
      if (method) calls.push({ node, scope, method });
    }
  });
  return { scopes, calls };
}

// El array con los datos del comprobante: literal en la llamada o $var definida una sola vez,
// antes de la llamada y en el mismo scope.
function resolveData(arg, scope, call, scopes) {
  if (!arg) return { reason: 'la llamada no tiene argumentos' };
  if (arg.kind === 'array') return { arr: arg };
  if (arg.kind !== 'variable' || typeof arg.name !== 'string') return { reason: 'no es un array literal ni una variable' };
  const s = scopes.get(scope) || { assigns: new Map(), offsets: new Map(), partialIfs: new Map() };
  const defs = s.assigns.get(arg.name) || [];
  const v = `$${arg.name}`;
  if (defs.length === 0) {
    const isParam = (scope.arguments || []).some((a) => a.kind === 'parameter' && (a.name?.name ?? a.name) === arg.name);
    if (isParam) return { hint: `Los datos del comprobante llegan en \`${v}\` como parámetro: agregá ${FIELD} donde se arma ese array, ${HINT_TAIL}` };
    return { reason: `${v} no se define en esta función` };
  }
  if (defs.length > 1) return { reason: `${v} se asigna más de una vez` };
  const def = defs[0];
  // $data = armarComprobante(...) / $this->builder->armar(...) / Builder::armar(...): decir qué función lo arma.
  if (def.right.kind === 'call') {
    const what = def.right.what;
    const fn = what && (what.kind === 'name' ? what.name : identName(what.offset));
    if (typeof fn === 'string') return { hint: `Los datos del comprobante los arma \`${fn}()\`: agregá ${FIELD} ahí, ${HINT_TAIL}` };
  }
  if (def.operator !== '=' || def.right.kind !== 'array') return { reason: `${v} no es un array literal` };
  if (def.loc.start.offset > call.loc.start.offset) return { reason: `${v} se define después de la llamada` };
  const offsets = s.offsets.get(arg.name) || [];
  // $data['CondicionIVAReceptorId'] = ... : migrado, salvo que solo pase dentro del if del arreglo parcial.
  const fieldSets = offsets.filter((o) => o.key === FIELD);
  const ifs = s.partialIfs.get(arg.name) || [];
  const insideIf = (o) => ifs.some((i) => o.node.loc.start.offset >= i.loc.start.offset && o.node.loc.end.offset <= i.loc.end.offset);
  const partial = fieldSets.length > 0 && fieldSets.every(insideIf);
  if (fieldSets.length && !partial) return { migrated: true };
  if (offsets.some((o) => o.key === undefined || DECISION_KEYS.has(o.key))) return { reason: `${v} se completa en varios pasos` };
  return { arr: def.right, def, name: arg.name, partial };
}

export default function transform({ source, file, pack, context = emptyContext() }) {
  const findings = [];
  const usages = [];
  if (!ARCA_HINT.test(source) && !NEAR_HINT.test(source)) return { output: null, findings, usages }; // prefiltro (ver el codemod de JS)
  const caveat = libraryCaveat(context, 'composer');
  const migrated = alreadyMigratedPrefix(context);
  let ast;
  try {
    ast = parsePhp(source, file);
  } catch (err) {
    if (/ElectronicBilling|FECAESolicitar|FECAEDetRequest/.test(source)) {
      findings.push({ pack: PACK, file, line: err.lineNumber || null, status: 'needs-input',
        message: `No pude analizar este archivo PHP (${err.message}). Revisá a mano las llamadas a ElectronicBilling.` });
    }
    return { output: null, findings, usages };
  }

  const { scopes, calls } = collect(ast);
  const edits = [];
  const edited = new Set(); // el mismo $data en dos llamadas: se inserta una sola vez (ver el codemod de JS)

  // Punto 13 del frente B: 'CondicionIVAReceptor' => $x (sin Id) se renombra, como en JS. Solo cambia el texto
  // entre las comillas de la clave; el array queda marcado para que la llamada no reciba un campo nuevo.
  let nearMiss = false; // el archivo ya tiene un aviso de la clave: el de SOAP sin el campo sobra
  if (!isTestFile(file)) {
    walkPhp(ast, (node) => {
      if (node.kind !== 'array') return;
      const entries = node.items.filter((it) => it && it.kind === 'entry');
      const near = entries.find((e) => isNearMissKey(phpKey(e)));
      if (!near || !isVoucherDetail(entries.map(phpKey))) return;
      edited.add(node);
      nearMiss = true;
      if (entries.some((e) => phpKey(e) === FIELD)) {
        findings.push(finding(PACK, file, near, 'needs-review', nearMissBothMessage(phpKey(near))));
        return;
      }
      const { start, end } = near.key.loc;
      edits.push({ offset: start.offset + 1, remove: end.offset - start.offset - 2, text: FIELD });
      findings.push(finding(PACK, file, near, 'needs-review', nearMissMessage(phpKey(near), pack) + (caveat ? ` ${caveat}` : '')));
    });

    // Punto 25: $det['CondicionIVAReceptor'] = $x; en una asignación aparte. Se renombra si $det es, en la misma
    // función, un array literal con claves de WSFEv1 definido una sola vez; si no se puede confirmar, se avisa.
    for (const s of scopes.values()) {
      for (const [name, offsets] of s.offsets) {
        for (const o of offsets) {
          if (!isNearMissKey(o.key) || o.node.left.offset.kind !== 'string') continue;
          const defs = s.assigns.get(name) || [];
          const arr = defs.length === 1 && defs[0].operator === '=' && defs[0].right.kind === 'array' ? defs[0].right : null;
          const entries = arr ? arr.items.filter((it) => it && it.kind === 'entry') : [];
          if (!arr || !isVoucherDetail(entries.map(phpKey))) {
            // Solo con la grafía de WSFEv1 (con mayúscula): $cliente['condicionIvaReceptor'] es un campo propio.
            if (ARCA_HINT.test(source) && /^Condicion/.test(o.key)) {
              findings.push(finding(PACK, file, o.node, 'needs-review', nearMissUnsureMessage(`$${name}['${o.key}']`, o.key)));
              nearMiss = true;
            }
            continue;
          }
          edited.add(arr);
          nearMiss = true;
          if (entries.some((e) => phpKey(e) === FIELD) || offsets.some((x) => x.key === FIELD)) {
            findings.push(finding(PACK, file, o.node, 'needs-review', nearMissBothMessage(o.key)));
            continue;
          }
          const { start, end } = o.node.left.offset.loc;
          edits.push({ offset: start.offset + 1, remove: end.offset - start.offset - 2, text: FIELD });
          findings.push(finding(PACK, file, o.node, 'needs-review', nearMissMessage(o.key, pack) + (caveat ? ` ${caveat}` : '')));
        }
      }
    }
  }

  for (const { node: call, scope, method } of calls) {
    usages.push({ provider: 'arca', op: `ElectronicBilling->${method}`, line: call.loc.start.line });
    const data = resolveData(call.arguments[0], scope, call, scopes);
    if (data.migrated) continue;
    const entries = data.arr ? data.arr.items.filter((it) => it && it.kind === 'entry') : null;
    if (!entries || entries.some((e) => e.unpack || e.byRef)) {
      const msg = data.hint || `No pude leer los datos del comprobante (${data.reason || 'el array usa ...$otro o referencias'}). Agregá ${FIELD} a mano, ${HINT_TAIL}`;
      findings.push(finding(PACK, file, call, migrated ? 'needs-review' : 'needs-input', (migrated || '') + msg + (caveat ? ` ${caveat}` : '')));
      continue;
    }
    const byKey = (k) => entries.find((e) => phpKey(e) === k);
    if (byKey(FIELD) || edited.has(data.arr)) continue; // ya está migrado (o ya lo editamos)

    const d = decideCondition({ docTipo: phpLiteral(byKey('DocTipo')?.value), cbteTipo: phpLiteral(byKey('CbteTipo')?.value) }, pack);
    const suggestion = `'${FIELD}' => <condición del cliente>,  // valores válidos: ${validCodesText(d, pack)}`;
    if (data.partial) {
      // Ya tiene el arreglo parcial: no se toca, pero lo que falta se sigue reportando.
      const pending = partialPending(d, pack, suggestion);
      findings.push(finding(PACK, file, call, 'needs-input', partialLeftMessage(pending), { suggestion }));
      continue;
    }
    if (d.status === 'needs-input') {
      // DocTipo no literal y $data en una variable: arreglo parcial con un if después de armar el array.
      // Con un array dentro de la llamada no hay dónde poner el if, y `null` no sirve: mandarlo antes del 1/12
      // podría generar un rechazo que hoy no existe (frente B, punto 7).
      const docTipo = byKey('DocTipo');
      const partialEdit = data.def && docTipo && phpLiteral(docTipo.value) === undefined
        && canApplyAtRuntime(d, phpLiteral(byKey('CbteTipo')?.value)) ? insertPartialIf(source, data, entries) : null;
      if (partialEdit) {
        edits.push(partialEdit.edit);
        edited.add(data.arr);
        findings.push(finding(PACK, file, call, 'needs-review', partialAppliedMessage(partialEdit.read) + (caveat ? ` ${caveat}` : ''),
          { partial: partialPending(d, pack, suggestion) }));
        continue;
      }
      findings.push(finding(PACK, file, call, 'needs-input', missingMessage(d) + (caveat ? ` ${caveat}` : ''), { suggestion }));
      continue;
    }
    const anchor = byKey('DocNro') || entries[entries.length - 1];
    edits.push(...insertAfterEntry(source, entries, anchor, { value: d.code, comment: d.comment }));
    edited.add(data.arr);
    // Con afip.php 0.x (WSDL de 2021 sin el campo) el arreglo no alcanza solo: deja de ser "automático".
    const status = caveat && d.status === 'auto' ? 'needs-review' : d.status;
    findings.push(finding(PACK, file, call, status, appliedMessage(d.status) + (caveat ? ` ${caveat}` : '')));
  }

  const soap = nearMiss ? null : soapDetection(source, file, context); // ya tiene su aviso (ver el codemod de JS)
  if (soap) { findings.push(soap.finding); usages.push(soap.usage); }

  return { output: edits.length ? applyEdits(source, edits) : null, findings, usages };
}

// Comillas de las claves del array: las que use la mayoría.
function quoteOf(source, entries) {
  const keyed = entries.filter((e) => e.key && e.key.kind === 'string');
  const doubles = keyed.filter((e) => source[e.key.loc.start.offset] === '"').length;
  return doubles > keyed.length / 2 ? '"' : "'";
}

// Arreglo parcial en PHP: después de `$data = [...];` agrega
//   if ((int) $data['DocTipo'] === 99) { $data['CondicionIVAReceptorId'] = 5; }
// en tres líneas, con la indentación del archivo. Lee DocTipo del array ya armado, así no repite la
// expresión original (puede ser una llamada). (int) y === : '99' como string también cuenta, como en JS.
// null si la asignación no termina la línea (dentro de un if, varias sentencias en una línea...).
function insertPartialIf(source, data, entries) {
  const eol = eolOf(source);
  const { def, name } = data;
  let semi = def.loc.end.offset - 1;
  if (source[semi] !== ';') {
    semi = def.loc.end.offset;
    while (semi < source.length && /[ \t]/.test(source[semi])) semi++;
    if (source[semi] !== ';') return null;
  }
  const nl = source.indexOf('\n', semi);
  const rest = source.slice(semi + 1, nl === -1 ? source.length : nl);
  if (nl === -1 || !(rest.trim() === '' || /^\s*(\/\/|#)/.test(rest))) return null;
  const lineStart = source.lastIndexOf('\n', def.loc.start.offset - 1) + 1;
  const indent = source.slice(lineStart).match(/^[ \t]*/)[0];
  // Unidad de indentación: la de las claves del array respecto de la sentencia; si no, la del archivo.
  const first = entries.find((e) => e.loc.start.line > def.loc.start.line);
  const entryIndent = first ? source.slice(source.lastIndexOf('\n', first.loc.start.offset - 1) + 1).match(/^[ \t]*/)[0] : '';
  const unit = entryIndent.startsWith(indent) && entryIndent.length > indent.length ? entryIndent.slice(indent.length)
    : indent.includes('\t') ? '\t' : '    ';
  const q = quoteOf(source, entries);
  const read = `$${name}[${q}DocTipo${q}]`;
  const text = `${indent}//${PARTIAL_COMMENT}${eol}`
    + `${indent}if ((int) ${read} === 99) {${eol}`
    + `${indent}${unit}$${name}[${q}${FIELD}${q}] = 5;${eol}`
    + `${indent}}${eol}`;
  return { edit: { offset: nl + 1, text }, read };
}

// Inserta 'CondicionIVAReceptorId' => N después de `anchor`, copiando el estilo del array:
// comillas de las claves, indentación, alineación de los =>, coma final y fin de línea.
export function insertAfterEntry(source, entries, anchor, { value, comment }) {
  const eol = eolOf(source);
  const keyed = entries.filter((e) => e.key && e.key.kind === 'string');
  const q = quoteOf(source, entries);
  const key = `${q}${FIELD}${q}`;

  const end = anchor.loc.end.offset;
  let k = end;
  while (k < source.length && /[ \t]/.test(source[k])) k++;
  const hasComma = source[k] === ',';
  const nl = source.indexOf('\n', end);
  const rest = source.slice(hasComma ? k + 1 : end, nl === -1 ? source.length : nl);
  const endsLine = nl !== -1 && (rest.trim() === '' || /^\s*(\/\/|#)/.test(rest));

  if (!endsLine) {
    // Array en una sola línea.
    return [{ offset: hasComma ? k + 1 : end, text: `${hasComma ? '' : ','} ${key} => ${value} /*${comment} */${hasComma ? ',' : ''}` }];
  }

  const lineStart = source.lastIndexOf('\n', anchor.loc.start.offset - 1) + 1;
  const indent = source.slice(lineStart).match(/^[ \t]*/)[0];
  const { before, after } = arrowSpacing(source, keyed, anchor, key.length);
  const isLast = anchor === entries[entries.length - 1];
  const trailing = hasComma || !isLast ? ',' : '';
  const out = [{ offset: nl + 1, text: `${indent}//${comment}${eol}${indent}${key}${before}=>${after}${value}${trailing}${eol}` }];
  if (!hasComma) out.push({ offset: end, text: ',' });
  return out;
}

// Espacios antes y después del => para la línea nueva. Si las claves del array están alineadas
// con espacios ('DocTipo'    => 99), se alinea igual; si no, se copia el espaciado del ancla.
function arrowSpacing(source, keyed, anchor, newKeyLength) {
  const parts = (e) => {
    const keyEnd = e.key.loc.end.offset;
    const arrow = source.indexOf('=>', keyEnd);
    return {
      width: arrow - e.key.loc.start.offset,
      before: source.slice(keyEnd, arrow),
      after: source.slice(arrow + 2, e.value.loc.start.offset),
      line: e.loc.start.line,
    };
  };
  const all = keyed.map(parts);
  const own = anchor.key && anchor.key.kind === 'string' ? parts(anchor) : { before: ' ', after: ' ' };
  const after = /^[ \t]*$/.test(own.after) && own.after ? own.after : ' ';
  const multiline = new Set(all.map((p) => p.line)).size === all.length;
  const aligned = multiline && all.length > 1 && all.every((p) => p.width === all[0].width && /^ +$/.test(p.before))
    && all.some((p) => p.before.length > 1);
  if (aligned) return { before: ' '.repeat(Math.max(1, all[0].width - newKeyLength)), after };
  return { before: /^[ \t]+$/.test(own.before) ? own.before : ' ', after };
}
