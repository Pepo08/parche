// Pack arca.wsfe.condicion-iva-receptor (PHP: afipsdk/afip.php y sus forks)
// Mismas reglas que el codemod de JS: agrega CondicionIVAReceptorId a cada
// $afip->ElectronicBilling->CreateVoucher($data) / CreateNextVoucher($data) cuando se puede inferir
// sin datos del negocio, y marca el resto para que una persona complete el dato.
// Edita con inserciones de texto mínimas sobre los offsets exactos de php-parser (ver src/php.js).
import { eolOf, applyEdits, finding } from '../ast.js';
import { parsePhp, walkPhp, phpLiteral, phpKey } from '../php.js';
import { PACK, decideCondition, validCodesText, missingMessage, appliedMessage, soapDetection } from './arca-rules.js';

// En PHP los nombres de método no distinguen mayúsculas: createVoucher también es válido.
// El inventario usa el nombre oficial, así un mismo método no aparece dos veces.
const VOUCHER_METHODS = new Map([['createvoucher', 'CreateVoucher'], ['createnextvoucher', 'CreateNextVoucher']]);
// Claves que cambian la decisión: si se tocan fuera del array literal, no se puede inferir.
const DECISION_KEYS = new Set(['DocTipo', 'CbteTipo', 'DocNro']);
const FIELD = 'CondicionIVAReceptorId';

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

// Asignaciones por scope: $var = ... y $var['Clave'] = ...
function collect(ast) {
  const scopes = new Map();
  const calls = [];
  const info = (scope) => {
    if (!scopes.has(scope)) scopes.set(scope, { assigns: new Map(), offsets: new Map() });
    return scopes.get(scope);
  };
  const push = (map, name, value) => map.set(name, [...(map.get(name) || []), value]);
  walkPhp(ast, (node, scope) => {
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
  const s = scopes.get(scope) || { assigns: new Map(), offsets: new Map() };
  const defs = s.assigns.get(arg.name) || [];
  const v = `$${arg.name}`;
  if (defs.length === 0) return { reason: `${v} no se define en esta función` };
  if (defs.length > 1) return { reason: `${v} se asigna más de una vez` };
  const def = defs[0];
  if (def.operator !== '=' || def.right.kind !== 'array') return { reason: `${v} no es un array literal` };
  if (def.loc.start.offset > call.loc.start.offset) return { reason: `${v} se define después de la llamada` };
  const offsets = s.offsets.get(arg.name) || [];
  if (offsets.some((o) => o.key === FIELD)) return { migrated: true };
  if (offsets.some((o) => o.key === undefined || DECISION_KEYS.has(o.key))) return { reason: `${v} se completa en varios pasos` };
  return { arr: def.right };
}

export default function transform({ source, file, pack }) {
  const findings = [];
  const usages = [];
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
  for (const { node: call, scope, method } of calls) {
    usages.push({ provider: 'arca', op: `ElectronicBilling->${method}`, line: call.loc.start.line });
    const data = resolveData(call.arguments[0], scope, call, scopes);
    if (data.migrated) continue;
    const entries = data.arr ? data.arr.items.filter((it) => it && it.kind === 'entry') : null;
    if (!entries || entries.some((e) => e.unpack || e.byRef)) {
      findings.push(finding(PACK, file, call, 'needs-input',
        `No pude leer los datos del comprobante (${data.reason || 'el array usa ...$otro o referencias'}). Agregá ${FIELD} a mano.`));
      continue;
    }
    const byKey = (k) => entries.find((e) => phpKey(e) === k);
    if (byKey(FIELD)) continue; // ya está migrado

    const d = decideCondition({ docTipo: phpLiteral(byKey('DocTipo')?.value), cbteTipo: phpLiteral(byKey('CbteTipo')?.value) }, pack);
    if (d.status === 'needs-input') {
      findings.push(finding(PACK, file, call, 'needs-input', missingMessage(d),
        { suggestion: `'${FIELD}' => <condición del cliente>,  // valores válidos: ${validCodesText(d, pack)}` }));
      continue;
    }
    const anchor = byKey('DocNro') || entries[entries.length - 1];
    edits.push(...insertAfterEntry(source, entries, anchor, { value: d.code, comment: d.comment }));
    findings.push(finding(PACK, file, call, d.status, appliedMessage(d.status)));
  }

  const soap = soapDetection(source, file);
  if (soap) { findings.push(soap.finding); usages.push(soap.usage); }

  return { output: edits.length ? applyEdits(source, edits) : null, findings, usages };
}

// Inserta 'CondicionIVAReceptorId' => N después de `anchor`, copiando el estilo del array:
// comillas de las claves, indentación, alineación de los =>, coma final y fin de línea.
export function insertAfterEntry(source, entries, anchor, { value, comment }) {
  const eol = eolOf(source);
  const keyed = entries.filter((e) => e.key && e.key.kind === 'string');
  const doubles = keyed.filter((e) => source[e.key.loc.start.offset] === '"').length;
  const q = doubles > keyed.length / 2 ? '"' : "'";
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
