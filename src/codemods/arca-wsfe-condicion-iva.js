// Pack arca.wsfe.condicion-iva-receptor (JavaScript/TypeScript, afip.js)
// Agrega CondicionIVAReceptorId a cada pedido de CAE hecho con afip.js cuando se puede inferir
// sin datos del negocio, y marca el resto para que una persona complete el dato.
import {
  jFor, detectQuote, eolOf, offsetAt, applyEdits, getProp, isQuotedKey, isPlainProp, keyName, literalValue, resolveBinding, finding, fileLine,
} from '../ast.js';
import {
  PACK, decideCondition, validCodesText, missingMessage, appliedMessage, soapDetection, ARCA_HINT, libraryCaveat, alreadyMigratedPrefix,
  canApplyAtRuntime, PARTIAL_COMMENT, partialAppliedMessage, partialPending, partialLeftMessage,
  NEAR_HINT, isNearMissKey, isVoucherDetail, nearMissMessage, nearMissBothMessage, nearMissUnsureMessage, nearMissTypedMessage,
  LOOSE_EOL, looseEolMessage,
} from './arca-rules.js';
import { emptyContext } from '../context.js';
import { isTestFile } from '../paths.js';

const VOUCHER_METHODS = new Set(['createVoucher', 'createNextVoucher']);
const WRAPPERS = new Set(['TSAsExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSSatisfiesExpression', 'ParenthesizedExpression']);

// (afip.ElectronicBilling as any) → afip.ElectronicBilling
const unwrap = (n) => {
  while (n && WRAPPERS.has(n.type)) n = n.expression;
  return n;
};
// afip.ElectronicBilling (afip.js) o arca.electronicBillingService (@arcasdk/core): las dos reciben el mismo
// comprobante, con las claves de WSFEv1 (tipos de @arcasdk/core 2.0.2, leídos en su paquete de npm el 24/10/2026).
const BILLING_MEMBERS = new Set(['ElectronicBilling', 'electronicBillingService']);
const isEBMember = (n) => !!(n && n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier' && BILLING_MEMBERS.has(n.property.name));

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

// Para el inventario: `ElectronicBilling` o `electronicBillingService`, también si la llamada pasa por un alias.
function billingName(node, p) {
  let n = unwrap(node);
  if (n && n.type === 'Identifier') n = unwrap(resolveBinding(p, n.name)?.node.init);
  return isEBMember(n) ? n.property.name : 'ElectronicBilling';
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

// Un valor que se puede volver a leer sin efectos: docTipo, cliente.docTipo, this.doc?.tipo, datos['DocTipo'].
// El arreglo parcial repite esa expresión; una llamada o un await no se repiten.
function isPureRead(node, top = true) {
  const n = unwrap(node);
  if (!n) return false;
  if (n.type === 'Identifier') return n.name !== 'undefined';
  if (n.type === 'ThisExpression') return !top;
  if (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') {
    if (n.computed && !['StringLiteral', 'NumericLiteral', 'Literal'].includes(n.property.type)) return false;
    return isPureRead(n.object, false);
  }
  return false;
}

// ...(cond ? { CondicionIVAReceptorId: N } : {}): 'partial' si para el otro caso no hay valor (el arreglo
// parcial de Parche, o uno igual escrito a mano), 'full' si los dos lados ponen el campo.
function conditionSpread(prop) {
  if (prop.type !== 'SpreadElement' && prop.type !== 'SpreadProperty') return null;
  const c = unwrap(prop.argument);
  if (!c || c.type !== 'ConditionalExpression') return null;
  const sets = (o) => { const x = unwrap(o); return !!(x && x.type === 'ObjectExpression' && getProp(x, 'CondicionIVAReceptorId')); };
  if (!sets(c.consequent) && !sets(c.alternate)) return null;
  return sets(c.consequent) && sets(c.alternate) ? 'full' : 'partial';
}
const otherSpread = (obj) => obj.properties.some((p) => (p.type === 'SpreadElement' || p.type === 'SpreadProperty' || p.type === 'ObjectMethod') && !conditionSpread(p));

const textOf = (source, node) => source.slice(offsetAt(source, node.loc.start), offsetAt(source, node.loc.end));

// Nombre de la propiedad de un acceso: voucher.Campo o voucher['Campo'].
const memberName = (m) => (!m.computed && m.property.type === 'Identifier' ? m.property.name
  : m.computed && (m.property.type === 'StringLiteral' || m.property.type === 'Literal') ? m.property.value : null);

// ¿El objeto de la variable `name` (declarada en `decl`) recibe el campo después de armarse?
// voucher.CondicionIVAReceptorId = …, voucher['CondicionIVAReceptorId'] = …, (voucher as any).CondicionIVAReceptorId = …
// u Object.assign(voucher, { CondicionIVAReceptorId: … }). Cuenta como migrado, igual que en PHP
// (frente B, punto 18: tometh04/vibook-services lo asigna en un if y Parche agregaba el arreglo parcial igual).
// Solo cuenta si es la misma variable: otra con el mismo nombre en otra función no.
function fieldAssignedLater(j, root, decl, name) {
  const same = (p) => resolveBinding(p, name)?.node === decl.node;
  const isVar = (n) => { const x = unwrap(n); return !!(x && x.type === 'Identifier' && x.name === name); };
  const assigned = root.find(j.AssignmentExpression).filter((p) => {
    const left = unwrap(p.node.left);
    return left && left.type === 'MemberExpression' && isVar(left.object) && memberName(left) === 'CondicionIVAReceptorId' && same(p);
  }).size() > 0;
  if (assigned) return true;
  return root.find(j.CallExpression).filter((p) => {
    const c = unwrap(p.node.callee);
    const isAssign = c && c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'Object'
      && c.property.type === 'Identifier' && c.property.name === 'assign';
    if (!isAssign || !isVar(p.node.arguments[0]) || !same(p)) return false;
    return p.node.arguments.slice(1).some((a) => { const o = unwrap(a); return o && o.type === 'ObjectExpression' && !!getProp(o, 'CondicionIVAReceptorId'); });
  }).size() > 0;
}

// La clave nueva copia el estilo del objeto: con comillas si la mayoría de las claves las tiene, y las
// mismas comillas que esas claves. Las del resto del archivo solo desempatan: en un repo real las claves
// iban con ' y el archivo usaba " en el resto, y la clave nueva salía distinta a sus vecinas.
function keyTextFor(source, obj) {
  const props = obj.properties.filter(isPlainProp);
  const quotedKeys = props.filter(isQuotedKey);
  if (!props.length || quotedKeys.length < props.length / 2) return 'CondicionIVAReceptorId';
  const raw = (k) => (k.extra?.raw ?? k.raw ?? source[offsetAt(source, k.loc.start)])[0];
  const doubles = quotedKeys.filter((p) => raw(p.key) === '"').length;
  const singles = quotedKeys.length - doubles;
  const q = doubles === singles ? (detectQuote(source) === 'double' ? '"' : "'") : doubles > singles ? '"' : "'";
  return `${q}CondicionIVAReceptorId${q}`;
}

const suggestionFor = (d, pack) => `'CondicionIVAReceptorId': <condición del cliente>,  // valores válidos: ${validCodesText(d, pack)}`;

export default function transform({ source, file, pack, context = emptyContext() }) {
  const findings = [];
  const usages = [];
  const arcaFile = ARCA_HINT.test(source);
  if (!arcaFile && !NEAR_HINT.test(source)) return { output: null, findings, usages };
  const caveat = libraryCaveat(context, 'npm');
  const migrated = alreadyMigratedPrefix(context);
  const j = jFor(file);
  let root;
  try {
    root = j(source);
  } catch (err) {
    // Antes se descartaba en silencio: un archivo de ARCA que no parsea es justo el que hay que mirar.
    if (arcaFile) {
      findings.push({ pack: PACK, file, line: err.loc?.line || null, status: 'needs-input',
        message: `No pude analizar este archivo (${err.message.split('\n')[0]}). Revisá a mano las llamadas a ElectronicBilling.` });
    }
    return { output: null, findings, usages };
  }
  let changed = false;
  const edits = [];
  // Objetos ya editados: el mismo `payload` puede ir a dos llamadas (lo vimos en un repo real). Como se edita
  // texto y el árbol no se entera, sin esto se insertaba dos veces → clave duplicada y TypeScript no compila.
  const edited = new Set();
  // Cada cambio, con cómo hacerlo a mano: si el archivo tiene \r sueltos no se edita y se dice eso (punto 22).
  const applied = [];
  const apply = (f, manual) => { findings.push(f); applied.push({ f, manual }); };
  // Punto 23: si un tipo del repo declara la clave mal escrita, renombrarla solo acá rompe el tipado.
  const typedConflict = (key) => (/\.[cm]?tsx?$/.test(file) ? (context.nearMissTypes || []).find((t) => t.key === key) : null);

  // Punto 13 del frente B: la clave casi bien escrita se renombra; el nombre correcto lo fija el WSDL.
  // Va antes que las llamadas, así el comprobante renombrado no recibe además un CondicionIVAReceptorId nuevo.
  let nearMiss = false; // el archivo ya tiene un aviso de la clave: el de SOAP sin el campo sobra
  if (!isTestFile(file)) {
    root.find(j.ObjectExpression).forEach((p) => {
      const obj = p.node;
      const props = obj.properties.filter(isPlainProp);
      const near = props.find((pr) => isNearMissKey(keyName(pr)));
      if (!near || !isVoucherDetail(props.map(keyName))) return;
      edited.add(obj);
      nearMiss = true;
      if (getProp(obj, 'CondicionIVAReceptorId')) {
        findings.push(finding(PACK, file, near, 'needs-review', nearMissBothMessage(keyName(near))));
        return;
      }
      const typed = typedConflict(keyName(near));
      if (typed) {
        findings.push(finding(PACK, file, near, 'needs-review', nearMissTypedMessage(keyName(near), typed, pack)));
        return;
      }
      edits.push(renameKey(source, near));
      changed = true;
      apply(finding(PACK, file, near, 'needs-review', nearMissMessage(keyName(near), pack) + (caveat ? ` ${caveat}` : '')),
        `renombrá \`${keyName(near)}\` a \`CondicionIVAReceptorId\``);
    });

    // Punto 25: la misma clave en una asignación aparte (det.CondicionIVAReceptor = x, det['CondicionIVAReceptor'] = x),
    // como en el informe de CAEA de un repo real. Se renombra si `det` es, en el mismo scope, un objeto literal con
    // claves de WSFEv1. Si no se puede confirmar que sea el comprobante, se avisa sin tocar nada.
    root.find(j.AssignmentExpression).forEach((p) => {
      const left = unwrap(p.node.left);
      if (!left || left.type !== 'MemberExpression') return;
      const key = memberName(left);
      if (!isNearMissKey(key)) return;
      const target = unwrap(left.object);
      const decl = target && target.type === 'Identifier' ? resolveBinding(p, target.name) : null;
      const obj = unwrap(decl && decl.node.init);
      if (!obj || obj.type !== 'ObjectExpression' || !isVoucherDetail(obj.properties.filter(isPlainProp).map(keyName))) {
        // Solo con la grafía de WSFEv1 (con mayúscula): `cliente.condicionIvaReceptor = …` es un campo propio.
        if (arcaFile && /^Condicion/.test(key)) {
          const shown = target && target.type === 'Identifier' ? `${target.name}.${key}` : textOf(source, left);
          findings.push(finding(PACK, file, p.node, 'needs-review', nearMissUnsureMessage(shown, key)));
          nearMiss = true;
        }
        return;
      }
      edited.add(obj);
      nearMiss = true;
      if (getProp(obj, 'CondicionIVAReceptorId') || fieldAssignedLater(j, root, decl, target.name)) {
        findings.push(finding(PACK, file, p.node, 'needs-review', nearMissBothMessage(key)));
        return;
      }
      const typed = typedConflict(key);
      if (typed) {
        findings.push(finding(PACK, file, p.node, 'needs-review', nearMissTypedMessage(key, typed, pack)));
        return;
      }
      edits.push(renameMember(source, left));
      changed = true;
      apply(finding(PACK, file, p.node, 'needs-review', nearMissMessage(key, pack) + (caveat ? ` ${caveat}` : '')),
        `renombrá \`${target.name}.${key}\` a \`${target.name}.CondicionIVAReceptorId\``);
    });
  }

  root.find(j.CallExpression).filter((p) => voucherCallee(p) !== null).forEach((p) => {
    const call = p.node;
    const callee = voucherCallee(p);
    usages.push({ provider: 'arca', op: `${billingName(callee.object, p)}.${callee.property.name}`, line: call.loc?.start.line });
    const arg = call.arguments[0];
    let obj = null;
    let binding = null;
    if (arg && arg.type === 'ObjectExpression') obj = arg;
    else if (arg && arg.type === 'Identifier') {
      const decl = resolveBinding(p, arg.name);
      if (decl && decl.node.init && decl.node.init.type === 'ObjectExpression') { obj = decl.node.init; binding = decl; }
    }
    if (!obj || otherSpread(obj)) {
      // Si el repo ya usa el campo en otro lado, lo más probable es que el builder ya lo ponga: "revisar".
      // El aviso de librería vieja también va acá (frente B, punto 14: en los repos de jretondo los datos llegan de afuera).
      findings.push(finding(PACK, file, call, migrated ? 'needs-review' : 'needs-input',
        (migrated || '') + unreadableMessage(j, root, p, arg, obj) + (caveat ? ` ${caveat}` : '')));
      return;
    }
    if (getProp(obj, 'CondicionIVAReceptorId') || edited.has(obj)) return; // ya está migrado (o ya lo editamos)
    if (binding && fieldAssignedLater(j, root, binding, arg.name)) return; // lo completa después: también migrado
    const spreads = obj.properties.map(conditionSpread);
    if (spreads.includes('full')) return;

    const d = decide(obj, pack);
    const props = obj.properties.filter(isPlainProp);
    const keyText = keyTextFor(source, obj);
    const anchor = getProp(obj, 'DocNro') || props[props.length - 1];
    const isLast = anchor === obj.properties[obj.properties.length - 1];
    if (spreads.includes('partial')) {
      // Ya tiene el arreglo parcial: no se toca, pero lo que falta se sigue reportando.
      const pending = partialPending(d, pack, suggestionFor(d, pack));
      findings.push(finding(PACK, file, call, 'needs-input', partialLeftMessage(pending), { suggestion: pending.suggestion }));
      return;
    }
    if (d.status === 'needs-input') {
      const docTipo = getProp(obj, 'DocTipo')?.value;
      const expr = docTipo && anchor && literalValue(docTipo) === undefined && isPureRead(docTipo) ? textOf(source, docTipo) : null;
      if (expr && !expr.includes('\n') && canApplyAtRuntime(d, literalValue(getProp(obj, 'CbteTipo')?.value))) {
        // Spread y no `CondicionIVAReceptorId: x === 99 ? 5 : undefined`: con otro DocTipo la clave ni existe,
        // así el pedido queda idéntico al de hoy sin depender de cómo serialice la librería (decisión D52).
        edits.push(...insertAfterProp(source, anchor, `...(Number(${expr}) === 99 ? { ${keyText}: 5 } : {})`, PARTIAL_COMMENT, { isLast }));
        edited.add(obj);
        changed = true;
        apply(finding(PACK, file, call, 'needs-review', partialAppliedMessage(expr) + (caveat ? ` ${caveat}` : ''),
          { partial: partialPending(d, pack, suggestionFor(d, pack)) }),
          'agregá `CondicionIVAReceptorId: 5` al comprobante cuando DocTipo es 99 (consumidor final); con otro DocTipo falta la condición frente al IVA del cliente');
        return;
      }
      findings.push(finding(PACK, file, call, 'needs-input', missingMessage(d) + (caveat ? ` ${caveat}` : ''),
        { suggestion: suggestionFor(d, pack) }));
      return;
    }

    edits.push(...insertAfterProp(source, anchor, `${keyText}: ${d.code}`, d.comment, { isLast }));
    edited.add(obj);
    changed = true;
    // Con librería vieja o WSDL viejo el arreglo no alcanza solo: deja de ser "automático".
    const status = caveat && d.status === 'auto' ? 'needs-review' : d.status;
    apply(finding(PACK, file, call, status, appliedMessage(d.status) + (caveat ? ` ${caveat}` : '')),
      `agregá \`CondicionIVAReceptorId: ${d.code}\` al comprobante`);
  });

  // Punto 22: con \r sueltos (\r\r\n) las líneas del parser no son las del archivo: se informan las de git.
  const looseEol = LOOSE_EOL.test(source);
  if (looseEol) for (const x of [...findings, ...usages]) if (x.line) x.line = fileLine(source, x.line);

  // Con la clave renombrada (o avisada) el archivo ya tiene su aviso: el de SOAP sin CondicionIVAReceptorId sobra.
  const soap = nearMiss ? null : soapDetection(source, file, context);
  if (soap) { findings.push(soap.finding); usages.push(soap.usage); }

  // Y la edición caía en otro lado (una vez, dentro de un comentario y con "Sintaxis OK"). No se edita: cada cambio
  // pasa a "revisar" con lo que hay que hacer a mano.
  if (changed && looseEol) {
    for (const { f, manual } of applied) {
      f.status = 'needs-review';
      f.message = looseEolMessage(manual);
      delete f.partial;
    }
    return { output: null, findings, usages };
  }

  return { output: changed ? applyEdits(source, edits) : null, findings, usages };
}

// det.CondicionIVAReceptor → det.CondicionIVAReceptorId; det['CondicionIVAReceptor'] → det['CondicionIVAReceptorId'] (mismas comillas).
function renameMember(source, member) {
  const start = offsetAt(source, member.property.loc.start);
  const end = offsetAt(source, member.property.loc.end);
  return member.computed ? { offset: start + 1, remove: end - start - 2, text: 'CondicionIVAReceptorId' }
    : { offset: start, remove: end - start, text: 'CondicionIVAReceptorId' };
}

// `CondicionIVAReceptor: x` → `CondicionIVAReceptorId: x`, con las mismas comillas y sin tocar el valor.
// Si era abreviada (`{ CondicionIVAReceptor }`), queda `CondicionIVAReceptorId: CondicionIVAReceptor`.
function renameKey(source, prop) {
  const start = offsetAt(source, prop.key.loc.start);
  const end = offsetAt(source, prop.key.loc.end);
  if (prop.shorthand) return { offset: start, remove: end - start, text: `CondicionIVAReceptorId: ${keyName(prop)}` };
  const q = isQuotedKey(prop) ? source[start] : '';
  return { offset: start, remove: end - start, text: `${q}CondicionIVAReceptorId${q}` };
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
