// Pack arca.wsfe.condicion-iva-receptor (JavaScript/TypeScript, afip.js)
// Agrega CondicionIVAReceptorId a cada pedido de CAE hecho con afip.js cuando se puede inferir
// sin datos del negocio, y marca el resto para que una persona complete el dato.
import {
  jFor, detectQuote, eolOf, offsetAt, applyEdits, getProp, hasSpread, isQuotedKey, isPlainProp, literalValue, resolveBinding, finding,
} from '../ast.js';
import { PACK, decideCondition, validCodesText, missingMessage, appliedMessage, soapDetection } from './arca-rules.js';

const VOUCHER_METHODS = new Set(['createVoucher', 'createNextVoucher']);

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
  return decideCondition({
    docTipo: literalValue(getProp(obj, 'DocTipo')?.value),
    cbteTipo: literalValue(getProp(obj, 'CbteTipo')?.value),
  }, pack);
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
      findings.push(finding(PACK, file, call, 'needs-input', missingMessage(d),
        { suggestion: `'CondicionIVAReceptorId': <condición del cliente>,  // valores válidos: ${validCodesText(d, pack)}` }));
      return;
    }

    const props = obj.properties.filter(isPlainProp);
    const quoted = props.length > 0 && props.filter(isQuotedKey).length >= props.length / 2;
    const q = detectQuote(source) === 'double' ? '"' : "'";
    const keyText = quoted ? `${q}CondicionIVAReceptorId${q}` : 'CondicionIVAReceptorId';
    const anchor = getProp(obj, 'DocNro') || props[props.length - 1];
    const isLast = anchor === obj.properties[obj.properties.length - 1];
    edits.push(...insertAfterProp(source, anchor, `${keyText}: ${d.code}`, d.comment, { isLast }));
    changed = true;
    findings.push(finding(PACK, file, call, d.status, appliedMessage(d.status)));
  });

  const soap = soapDetection(source, file);
  if (soap) { findings.push(soap.finding); usages.push(soap.usage); }

  return { output: changed ? applyEdits(source, edits) : null, findings, usages };
}

// Inserta una propiedad nueva después de `prop` tocando solo el texto necesario,
// para que el diff del PR sea de una línea y respete el formato del cliente.
// Si `prop` es la última y no tenía coma final, la nueva tampoco la lleva.
export function insertAfterProp(source, prop, text, comment, { isLast = false } = {}) {
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
    const trailing = hasComma || !isLast ? ',' : '';
    const out = [{ offset: nl + 1, text: `${indent}//${comment}${eol}${indent}${text}${trailing}${eol}` }];
    if (!hasComma) out.push({ offset: end, text: ',' });
    return out;
  }
  // Objeto en una sola línea.
  return [{ offset: hasComma ? k + 1 : end, text: `${hasComma ? '' : ','} ${text} /*${comment} */${hasComma ? ',' : ''}` }];
}
