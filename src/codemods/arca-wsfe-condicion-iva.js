// Pack arca.wsfe.condicion-iva-receptor (JavaScript/TypeScript, afip.js)
// Agrega CondicionIVAReceptorId a cada pedido de CAE hecho con afip.js cuando se puede inferir
// sin datos del negocio, y marca el resto para que una persona complete el dato.
import {
  jFor, detectQuote, eolOf, offsetAt, applyEdits, getProp, hasSpread, isQuotedKey, isPlainProp, literalValue, resolveBinding, finding,
} from '../ast.js';
import {
  PACK, decideCondition, validCodesText, missingMessage, appliedMessage, soapDetection, ARCA_HINT, libraryCaveat, alreadyMigratedPrefix,
} from './arca-rules.js';
import { emptyContext } from '../context.js';

const VOUCHER_METHODS = new Set(['createVoucher', 'createNextVoucher']);
const WRAPPERS = new Set(['TSAsExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSSatisfiesExpression', 'ParenthesizedExpression']);

// (afip.ElectronicBilling as any) → afip.ElectronicBilling
const unwrap = (n) => {
  while (n && WRAPPERS.has(n.type)) n = n.expression;
  return n;
};
const isEBMember = (n) => !!(n && n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier' && n.property.name === 'ElectronicBilling');

// ¿`node` es `<algo>.ElectronicBilling`? También con casts de TS y con un alias en el mismo scope
// (`const eb = afip.ElectronicBilling; eb.createVoucher(...)`): los dos aparecieron en repos reales.
function isElectronicBilling(node, p) {
  const n = unwrap(node);
  if (isEBMember(n)) return true;
  if (n && n.type === 'Identifier') {
    const decl = resolveBinding(p, n.name);
    return isEBMember(unwrap(decl && decl.node.init));
  }
  return false;
}

function voucherCallee(p) {
  const callee = unwrap(p.node.callee);
  if (!callee || callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return null;
  if (!VOUCHER_METHODS.has(callee.property.name) || !isElectronicBilling(callee.object, p)) return null;
  return callee;
}

export function decide(obj, pack) {
  return decideCondition({
    docTipo: literalValue(getProp(obj, 'DocTipo')?.value),
    cbteTipo: literalValue(getProp(obj, 'CbteTipo')?.value),
  }, pack);
}

export default function transform({ source, file, pack, context = emptyContext() }) {
  const findings = [];
  const usages = [];
  if (!ARCA_HINT.test(source)) return { output: null, findings, usages };
  const caveat = libraryCaveat(context, 'npm');
  const migrated = alreadyMigratedPrefix(context);
  const j = jFor(file);
  let root;
  try {
    root = j(source);
  } catch (err) {
    // Antes se descartaba en silencio: un archivo de ARCA que no parsea es justo el que hay que mirar.
    findings.push({ pack: PACK, file, line: err.loc?.line || null, status: 'needs-input',
      message: `No pude analizar este archivo (${err.message.split('\n')[0]}). Revisá a mano las llamadas a ElectronicBilling.` });
    return { output: null, findings, usages };
  }
  let changed = false;
  const edits = [];
  // Objetos ya editados: el mismo `payload` puede ir a dos llamadas (lo vimos en un repo real). Como se edita
  // texto y el árbol no se entera, sin esto se insertaba dos veces → clave duplicada y TypeScript no compila.
  const edited = new Set();

  root.find(j.CallExpression).filter((p) => voucherCallee(p) !== null).forEach((p) => {
    const call = p.node;
    usages.push({ provider: 'arca', op: `ElectronicBilling.${voucherCallee(p).property.name}`, line: call.loc?.start.line });
    const arg = call.arguments[0];
    let obj = null;
    if (arg && arg.type === 'ObjectExpression') obj = arg;
    else if (arg && arg.type === 'Identifier') {
      const decl = resolveBinding(p, arg.name);
      if (decl && decl.node.init && decl.node.init.type === 'ObjectExpression') obj = decl.node.init;
    }
    if (!obj || hasSpread(obj)) {
      // Si el repo ya usa el campo en otro lado, lo más probable es que el builder ya lo ponga: "revisar".
      findings.push(finding(PACK, file, call, migrated ? 'needs-review' : 'needs-input', (migrated || '') + unreadableMessage(j, root, p, arg, obj)));
      return;
    }
    if (getProp(obj, 'CondicionIVAReceptorId') || edited.has(obj)) return; // ya está migrado (o ya lo editamos)

    const d = decide(obj, pack);
    if (d.status === 'needs-input') {
      findings.push(finding(PACK, file, call, 'needs-input', missingMessage(d) + (caveat ? ` ${caveat}` : ''),
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
    edited.add(obj);
    changed = true;
    // Con librería vieja o WSDL viejo el arreglo no alcanza solo: deja de ser "automático".
    const status = caveat && d.status === 'auto' ? 'needs-review' : d.status;
    findings.push(finding(PACK, file, call, status, appliedMessage(d.status) + (caveat ? ` ${caveat}` : '')));
  });

  const soap = soapDetection(source, file, context);
  if (soap) { findings.push(soap.finding); usages.push(soap.usage); }

  return { output: changed ? applyEdits(source, edits) : null, findings, usages };
}

// Cuando no se puede leer el comprobante, decir DÓNDE hay que agregar el dato: la función que lo arma
// (y de qué módulo viene) o que llega como parámetro. Lo encontrado en repos reales: payload = buildVoucherPayload(...).
function unreadableMessage(j, root, p, arg, obj) {
  const tail = 'con la condición frente al IVA del cliente.';
  if (obj) return `No pude leer los datos del comprobante (el objeto usa ...spread). Agregá CondicionIVAReceptorId a mano, ${tail}`;
  if (arg && arg.type === 'Identifier') {
    const decl = resolveBinding(p, arg.name);
    let init = decl && decl.node.init;
    if (init && init.type === 'AwaitExpression') init = init.argument;
    if (init && init.type === 'CallExpression') {
      const fn = init.callee.type === 'Identifier' ? init.callee.name
        : init.callee.type === 'MemberExpression' && !init.callee.computed && init.callee.property.type === 'Identifier' ? init.callee.property.name : null;
      if (fn) {
        const from = importSourceOf(j, root, fn);
        return `Los datos del comprobante los arma \`${fn}()\`${from ? ` (de \`${from}\`)` : ''}: agregá CondicionIVAReceptorId ahí, ${tail}`;
      }
    }
    if (!decl) return `Los datos del comprobante llegan en \`${arg.name}\` desde afuera de esta función: agregá CondicionIVAReceptorId donde se arma ese objeto, ${tail}`;
  }
  return `No pude leer los datos del comprobante (no es un objeto literal). Agregá CondicionIVAReceptorId a mano, ${tail}`;
}

// De qué módulo viene `name`: import estático, require o import() dinámico con desestructuración.
function importSourceOf(j, root, name) {
  let src = null;
  root.find(j.ImportDeclaration).forEach((ip) => {
    if (ip.node.specifiers.some((s) => s.local && s.local.name === name)) src = ip.node.source.value;
  });
  if (src) return src;
  root.find(j.VariableDeclarator).forEach((vp) => {
    const { id } = vp.node;
    let init = vp.node.init;
    if (!init || id.type !== 'ObjectPattern') return;
    if (init.type === 'AwaitExpression') init = init.argument;
    const isImportCall = init.type === 'CallExpression' && (init.callee.type === 'Import' || (init.callee.type === 'Identifier' && init.callee.name === 'require'));
    const source = init.type === 'ImportExpression' ? init.source : isImportCall ? init.arguments[0] : null;
    if (!source || typeof source.value !== 'string') return;
    if (id.properties.some((pr) => pr.value && pr.value.type === 'Identifier' && pr.value.name === name)) src = source.value;
  });
  return src;
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
