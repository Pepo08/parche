// Pack arca.wsfe.condicion-iva-receptor
// Agrega CondicionIVAReceptorId a cada pedido de CAE hecho con afip.js cuando se puede inferir
// sin datos del negocio, y marca el resto para que una persona complete el dato.
import {
  jFor, detectQuote, eolOf, offsetAt, getProp, hasSpread, isQuotedKey, isPlainProp, literalValue, resolveBinding, finding,
} from '../ast.js';

const PACK = 'arca.wsfe.condicion-iva-receptor';
const VOUCHER_METHODS = new Set(['createVoucher', 'createNextVoucher']);
const CLASS = {
  A: new Set([1, 2, 3, 201, 202, 203]),
  B: new Set([6, 7, 8, 206, 207, 208]),
  C: new Set([11, 12, 13, 211, 212, 213]),
};

function classOf(cbteTipo) {
  for (const [k, set] of Object.entries(CLASS)) if (set.has(cbteTipo)) return k;
  return null;
}

function isVoucherCall(callee) {
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    VOUCHER_METHODS.has(callee.property.name) &&
    callee.object.type === 'MemberExpression' &&
    !callee.object.computed &&
    callee.object.property.name === 'ElectronicBilling'
  );
}

export function decide(obj, pack) {
  const docTipo = literalValue(getProp(obj, 'DocTipo')?.value);
  const cbteTipo = literalValue(getProp(obj, 'CbteTipo')?.value);
  const clase = typeof cbteTipo === 'number' ? classOf(cbteTipo) : null;
  if (docTipo === 99) {
    return { status: 'auto', code: 5, comment: ' parche: 5 = Consumidor Final (DocTipo 99, sin identificar)' };
  }
  if (docTipo === 96 && (clase === 'B' || clase === 'C')) {
    return { status: 'needs-review', code: 5, comment: ' parche: inferido Consumidor Final (DNI + comprobante ' + clase + ') — REVISAR' };
  }
  const valid = clase ? pack.codes_by_class[clase] : null;
  return { status: 'needs-input', clase, valid };
}

export default function transform({ source, file, pack }) {
  const j = jFor(file);
  const findings = [];
  const usages = [];
  let root;
  try {
    root = j(source);
  } catch {
    return { output: null, findings, usages };
  }
  let changed = false;
  const edits = [];

  root.find(j.CallExpression).filter((p) => isVoucherCall(p.node.callee)).forEach((p) => {
    const call = p.node;
    usages.push({ provider: 'arca', op: `ElectronicBilling.${call.callee.property.name}`, line: call.loc?.start.line });
    const arg = call.arguments[0];
    let obj = null;
    if (arg && arg.type === 'ObjectExpression') obj = arg;
    else if (arg && arg.type === 'Identifier') {
      const decl = resolveBinding(p, arg.name);
      if (decl && decl.node.init && decl.node.init.type === 'ObjectExpression') obj = decl.node.init;
    }
    if (!obj || hasSpread(obj)) {
      findings.push(finding(PACK, file, call, 'needs-input',
        'No pude leer los datos del comprobante (no es un objeto literal). Agregá CondicionIVAReceptorId a mano.'));
      return;
    }
    if (getProp(obj, 'CondicionIVAReceptorId')) return; // ya está migrado

    const d = decide(obj, pack);
    if (d.status === 'needs-input') {
      const lista = (d.valid || Object.keys(pack.codes).map(Number))
        .map((c) => `${c} (${pack.codes[String(c)]})`).join(', ');
      findings.push(finding(PACK, file, call, 'needs-input',
        `Falta CondicionIVAReceptorId y no se puede inferir sin saber la condición frente al IVA del cliente${d.clase ? ` (comprobante clase ${d.clase})` : ''}.`,
        { suggestion: `'CondicionIVAReceptorId': <condición del cliente>,  // valores válidos: ${lista}` }));
      return;
    }

    const props = obj.properties.filter(isPlainProp);
    const quoted = props.length > 0 && props.filter(isQuotedKey).length >= props.length / 2;
    const q = detectQuote(source) === 'double' ? '"' : "'";
    const keyText = quoted ? `${q}CondicionIVAReceptorId${q}` : 'CondicionIVAReceptorId';
    const anchor = getProp(obj, 'DocNro') || props[props.length - 1];
    edits.push(...insertAfterProp(source, anchor, `${keyText}: ${d.code}`, d.comment));
    changed = true;
    findings.push(finding(PACK, file, call, d.status,
      d.status === 'auto'
        ? 'Agregado CondicionIVAReceptorId: 5 (Consumidor Final): el comprobante va a un consumidor sin identificar.'
        : 'Agregado CondicionIVAReceptorId: 5 por inferencia (DNI + comprobante B/C). Confirmá que el cliente no sea exento ni no alcanzado.'));
  });

  // Integraciones SOAP propias: solo detección.
  if (/FECAESolicitar|FECAEDetRequest/.test(source) && !/CondicionIVAReceptorId/.test(source)) {
    const line = source.split('\n').findIndex((l) => /FECAESolicitar|FECAEDetRequest/.test(l)) + 1;
    findings.push({ pack: PACK, file, line, status: 'needs-input',
      message: 'Integración SOAP propia con WSFEv1 sin CondicionIVAReceptorId en el FECAEDetRequest. Hay que agregarlo al XML.' });
    usages.push({ provider: 'arca', op: 'WSFEv1 SOAP', line });
  }

  return { output: changed ? applyEdits(source, edits) : null, findings, usages };
}

// Inserta una propiedad nueva después de `prop` tocando solo el texto necesario,
// para que el diff del PR sea de una línea y respete el formato del cliente.
export function insertAfterProp(source, prop, text, comment) {
  const eol = eolOf(source);
  const end = offsetAt(source, prop.loc.end);
  let k = end;
  while (k < source.length && /[ \t]/.test(source[k])) k++;
  const hasComma = source[k] === ',';
  const nl = source.indexOf('\n', end);
  const rest = source.slice(hasComma ? k + 1 : end, nl === -1 ? source.length : nl);
  if (nl !== -1 && rest.trim() === '') {
    const lineStart = offsetAt(source, { line: prop.loc.start.line, column: 0 });
    const indent = source.slice(lineStart).match(/^[ \t]*/)[0];
    const out = [{ offset: nl + 1, text: `${indent}//${comment}${eol}${indent}${text},${eol}` }];
    if (!hasComma) out.push({ offset: end, text: ',' });
    return out;
  }
  // Objeto en una sola línea.
  return [{ offset: hasComma ? k + 1 : end, text: `${hasComma ? '' : ','} ${text} /*${comment} */${hasComma ? ',' : ''}` }];
}

function applyEdits(source, edits) {
  let out = source;
  for (const e of [...edits].sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, e.offset) + e.text + out.slice(e.offset);
  }
  return out;
}
