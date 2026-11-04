// La condición frente al IVA que sale de una regla fija (frente B, punto 29): solo detección.
// El error que más plata puede costar no es el rechazo: es un CAE válido con la condición que no es la del cliente.
// Es determinístico decir "esto es sospechoso"; no lo es decir cuál es el valor correcto, que es un dato de cada cliente.
// Por eso Parche nunca sugiere un valor ni toca el código: estos avisos salen como `detect-only`.
//
// Los codemods de JS y de PHP describen de dónde sale el valor del campo con el mismo modelo, y acá se decide:
//   { kind: 'code', code, raw }                  un valor fijo (literal, constante o miembro de una tabla, con fromTable)
//   { kind: 'dyn' }                              un dato que Parche no puede leer: está bien, no se dice nada
//   { kind: 'if', text, test, a, b }             cuitReceptor ? 1 : 5
//   { kind: 'or', text, left, right }            cliente.condicionIva || 5
//   { kind: 'rules', text, name, init, assigns } let c = 5; if (…) c = 1;   assigns: [{ value, tests }]
//   { kind: 'fn', codes }                        cond(x): los números fijos que devuelve esa función
//   { kind: 'table', name }                      MAPA[x]: los valores de la tabla se revisan aparte, donde se declara
import { PACK } from './arca-rules.js';

const FIELD = 'CondicionIVAReceptorId';
export const CONDITION_CHANGE = 'Condición frente al IVA sospechosa';
const DYN = { kind: 'dyn' };
export const dyn = () => DYN;

// Nombres de enums y tablas de condición frente al IVA: AfipCondicionIva, CONDICIONES_IVA, condFiscalIva, IvaCondition…
const NAMES = 'cond(?:icion(?:es)?)?[_-]?(?:frente[_-]?al[_-]?)?(?:iva|fiscal)|(?:iva|tax|vat)[_-]?cond|(?:iva|tax|vat)[_-]?status|receptor[_-]?iva|iva[_-]?receptor';
const NAME_RE = new RegExp(NAMES, 'i');
export const isConditionName = (name) => NAME_RE.test(String(name || ''));
// Prefiltro de los codemods: un archivo que solo declara el enum, sin nada de ARCA (agustinwalas/McLeonBack).
export const CONDITION_TABLE_HINT = new RegExp(`\\b(?:enum|const|let|var|class)\\s+\\w*(?:${NAMES})|\\$\\w*(?:${NAMES})\\w*\\s*=\\s*(?:\\[|array)`, 'i');

// Si el test de un if habla de la condición del cliente, los códigos fijos son una traducción, no una regla sobre el documento.
const ABOUT_CONDITION = /condici|\biva\b|iva[A-Z_]|_iva|monotrib|inscript|exent|responsable|fiscal|tax|vat/i;
// Un test sobre el documento: con CUIT, DocTipo 99, consumidor final. Sin documento, el 5 es correcto.
const ABOUT_DOCUMENT = /\b99\b|consumidor|\bcf\b|cuit|cuil|\bdoc|doc[A-Z_]|_doc|dni/i;

// La condición que nombra un texto (un comentario, una clave de enum), o null si no nombra ninguna de la tabla.
// `no inscripto` no existe en la tabla de ARCA: es de la numeración vieja, y vale como "ninguna de estas" (0).
const NAMED = [
  [/no[\s_-]*inscript/i, 0], [/no[\s_-]*categoriz/i, 7], [/no[\s_-]*alcanzad/i, 15],
  [/promovid|trabajador[\s_-]*independ/i, 16], [/monotrib\w*[\s_-]*social/i, 13], [/monotrib/i, 6],
  [/inscript|^ri$|[\s_-]ri$/i, 1], [/exent/i, 4], [/consumidor|^cf$/i, 5],
  [/proveedor\w*[\s_-]*(?:del[\s_-]*)?exterior/i, 8], [/cliente\w*[\s_-]*(?:del[\s_-]*)?exterior/i, 9], [/liberad|19\.?640/i, 10],
];
export function conditionNamed(text) {
  for (const [re, code] of NAMED) if (re.test(text)) return code;
  return null;
}
// Un comentario puede nombrar varias: "Consumidor Final (el receptor, no el emisor monotributista)".
const conditionsNamed = (text) => NAMED.filter(([re, code]) => code !== 0 && re.test(text)).map(([, code]) => code);

const known = (code, pack) => Object.hasOwn(pack.codes, String(code));
const label = (code, pack) => (known(code, pack) ? `${code} (${pack.codes[String(code)]})` : String(code));
const validList = (pack) => Object.keys(pack.codes).join(', ');
const orList = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} o ${items[items.length - 1]}`);
const short = (text) => {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > 70 ? `${t.slice(0, 69)}…` : t;
};
const uniq = (list) => [...new Set(list)];

// Los valores fijos a los que puede llegar una descripción, y si además puede salir de un dato.
function leaves(d) {
  if (!d) return { codes: [], dyn: true };
  if (d.kind === 'code') return { codes: [d], dyn: false };
  if (d.kind === 'if') return merge(leaves(d.a), leaves(d.b));
  if (d.kind === 'or') return merge(leaves(d.left), leaves(d.right));
  if (d.kind === 'rules') return merge(...(d.init ? [leaves(d.init)] : []), ...d.assigns.map((x) => leaves(x.value)));
  if (d.kind === 'fn') return { codes: d.codes, dyn: true };
  return { codes: [], dyn: true };
}
function merge(...parts) {
  return { codes: parts.flatMap((p) => p.codes), dyn: parts.some((p) => p.dyn) };
}

// ¿El DocTipo de este comprobante cambia y puede ser un CUIT o un CUIL? Con DNI o sin identificar, el 5 es correcto.
export function docCouldBeCuit(d) {
  if (d.kind === 'code') return false;
  const { codes, dyn: variable } = leaves(d);
  return variable || codes.some((c) => c.code === 80 || c.code === 86);
}

const CAE_RISK = 'Es un dato de cada cliente: a uno con otra condición, ARCA le puede autorizar el comprobante igual, con un dato falso.';

function unknownMessage(codes, pack) {
  const list = uniq(codes.map((c) => c.raw));
  return `\`${FIELD}\` puede valer ${orList(list.map((r) => `\`${r}\``))}, que no ${list.length > 1 ? 'están' : 'está'} en la tabla de ARCA (\`FEParamGetCondicionIvaReceptor\`): el pedido se rechaza con el error 10242. Los códigos que existen: ${validList(pack)}.`;
}
function ruleMessage(d, codes, pack) {
  return `\`${FIELD}\` sale de \`${short(d.text)}\`${d.where || ''}: solo puede valer ${orList(uniq(codes.map((c) => c.code)).map((c) => label(c, pack)))}, según esa regla y no según el cliente. ${CAE_RISK}`;
}
function defaultMessage(d, codes, pack) {
  return `\`${FIELD}\` sale de \`${short(d.text)}\`${d.where || ''}: si no hay dato, sale como ${orList(uniq(codes.map((c) => c.code)).map((c) => label(c, pack)))} sin avisar. Si ese código no corresponde a la clase del comprobante, ARCA lo rechaza (error 10243); si corresponde, autoriza el CAE con un dato que puede ser falso.`;
}
function classMessage(code, clase, pack) {
  return `\`${FIELD}\` vale ${label(code, pack)}, que no es válido para un comprobante clase ${clase}: el pedido se rechaza con el error 10243. Los códigos de esa clase: ${pack.codes_by_class[clase].join(', ')}.`;
}
function commentMessage(code, said, pack) {
  return `\`${FIELD}\` vale ${label(code, pack)}, pero el comentario de esa línea dice "${short(said)}". Uno de los dos está mal: revisá cuál.`;
}
function fixedMessage(code, pack) {
  return `\`${FIELD}\` vale siempre ${label(code, pack)}, y \`DocTipo\` puede cambiar. ${CAE_RISK}`;
}

// Lo que hay para decir de un valor. `site`: { docTipo, docVaries, clase, comment, guarded }, lo que se lee al lado del campo.
export function reviewCondition(d, site, pack) {
  const out = [];
  const say = (rule, message) => out.push({ rule, message });
  // Un miembro de una tabla fuera de la tabla de ARCA se avisa una vez, donde se declara la tabla.
  const unknown = leaves(d).codes.filter((c) => !known(c.code, pack) && !c.fromTable);
  if (unknown.length) say('fuera-de-tabla', unknownMessage(unknown, pack));
  const walk = (v) => {
    if (!v) return;
    if (v.kind === 'or') {
      const right = leaves(v.right);
      const fixed = right.dyn ? [] : right.codes.filter((c) => known(c.code, pack));
      // { DocTipo: 99, CondicionIVAReceptorId: x || 5 }: sin identificar, Consumidor Final es lo correcto.
      if (fixed.length && !(site.docTipo === 99 && fixed.every((c) => c.code === 5))) say('default-fijo', defaultMessage(v, fixed, pack));
      walk(v.left);
    } else if (v.kind === 'if') {
      const a = leaves(v.a);
      const b = leaves(v.b);
      if (!a.dyn && !b.dyn && [...a.codes, ...b.codes].every((c) => known(c.code, pack))) {
        const codes = [...a.codes, ...b.codes];
        // Tres códigos o más según la condición del cliente: es una traducción, no una regla fija.
        if (!(ABOUT_CONDITION.test(v.test) && uniq(codes.map((c) => c.code)).length > 2)) say('regla-fija', ruleMessage(v, codes, pack));
      } else {
        walk(v.a);
        walk(v.b);
      }
    } else if (v.kind === 'rules') {
      const before = out.length;
      for (const x of v.assigns) if (x.value.kind === 'or' || x.value.kind === 'if') walk(x.value);
      if (out.length === before) reviewRules(v, say, pack);
    }
  };
  walk(d);
  // Un valor fijo y conocido: solo se dice algo si se contradice con lo que está al lado.
  if (d.kind === 'code' && known(d.code, pack)) {
    const valid = site.clase ? pack.codes_by_class[site.clase] : null;
    const said = site.comment ? conditionsNamed(site.comment) : [];
    if (valid && !valid.includes(d.code)) say('clase', classMessage(d.code, site.clase, pack));
    else if (said.length && !said.includes(d.code)) say('comentario', commentMessage(d.code, site.comment, pack));
    else if (site.docVaries && !site.guarded) say('siempre-igual', fixedMessage(d.code, pack));
  }
  return out;
}

// let c = 5; if (…) c = 1; else c = 6; o let c = cliente.iva; if (!c) c = 5;
function reviewRules(v, say, pack) {
  const init = v.init ? leaves(v.init) : null;
  const initCode = init && !init.dyn ? init.codes[0] : null;
  const isFixed = (x) => !leaves(x.value).dyn;
  const codeOf = (x) => leaves(x.value).codes[0];
  const fixed = v.assigns.filter(isFixed);
  const variable = v.assigns.filter((x) => !isFixed(x));
  if (!variable.length) {
    if (init?.dyn) {
      // let c = cliente.iva; if (!c) c = 5; → un valor por defecto. if (docTipo === 99) c = 5; → está bien.
      const itself = new RegExp(`(?<![\\w$])${v.name.replace(/\$/g, '\\$')}(?![\\w$])`);
      const onItself = fixed.filter((x) => x.tests.some((t) => itself.test(t)));
      if (onItself.length) say('default-fijo', defaultMessage(v, onItself.map(codeOf), pack));
      return;
    }
    const codes = [...(initCode ? [initCode] : []), ...fixed.map(codeOf)];
    if (!codes.every((c) => known(c.code, pack))) return; // ya se dijo que el código no existe
    if (!v.assigns.flatMap((x) => x.tests).some((t) => ABOUT_CONDITION.test(t))) say('regla-fija', ruleMessage(v, codes, pack));
    else if (initCode) say('default-fijo', defaultMessage(v, [initCode], pack));
    return;
  }
  // Una parte sale del dato y otra es fija: el valor fijo es el "por defecto", salvo que dependa del documento.
  if (initCode && known(initCode.code, pack)) {
    if (initCode.code === 5 && variable.every((x) => x.tests.some((t) => ABOUT_DOCUMENT.test(t)))) return;
    say('default-fijo', defaultMessage(v, [initCode], pack));
    return;
  }
  const other = fixed.filter((x) => known(codeOf(x).code, pack) && !(codeOf(x).code === 5 && x.tests.some((t) => ABOUT_DOCUMENT.test(t))));
  if (other.length) say('default-fijo', defaultMessage(v, other.map(codeOf), pack));
}

// table.entries: [{ key, value }]. Valores fuera de la tabla y claves que dicen otra cosa que el código.
export function reviewTable(table, pack) {
  const unknown = table.entries.filter((e) => !known(e.value, pack));
  const wrong = table.entries.filter((e) => known(e.value, pack) && conditionNamed(String(e.key)) !== null && conditionNamed(String(e.key)) !== e.value);
  return { unknown, wrong };
}

const firstFew = (items) => (items.length > 5 ? `${items.slice(0, 5).join(', ')} y ${items.length - 5} más` : items.join(', '));

export function tableMessage(table, { unknown, wrong }, pack) {
  const parts = [];
  if (unknown.length) parts.push(`${firstFew(unknown.map((e) => `\`${e.key} = ${e.value}\``))} no ${unknown.length > 1 ? 'están' : 'está'} en la tabla de ARCA`);
  if (wrong.length) parts.push(firstFew(wrong.map((e) => `\`${e.key} = ${e.value}\`: en la tabla, ${e.value} es ${pack.codes[String(e.value)]}`)));
  const consequence = table.usedAt
    ? `\`${FIELD}\` sale de acá (línea ${table.usedAt}): con esos valores, el pedido se rechaza (error 10242) o sale con otra condición.`
    : `Si esos valores llegan a \`${FIELD}\` tal cual, el pedido se rechaza (error 10242) o sale con otra condición.`;
  return `\`${table.name}\` parece una numeración de la condición frente al IVA que no es la de ARCA: ${parts.join('; ')}. ${consequence} Los códigos de \`FEParamGetCondicionIvaReceptor\`: ${validList(pack)}.`;
}

// Las tablas de un archivo que se avisan: las que alimentan el campo y, en un repo que factura con ARCA, las que se llaman
// como una condición frente al IVA, aunque el campo no salga de ellas todavía.
export function tableFindings(tables, file, pack, context) {
  const out = [];
  for (const table of tables.values()) {
    if (!table.usedAt && !(context?.arcaRepo && isConditionName(table.name))) continue;
    const bad = reviewTable(table, pack);
    if (bad.unknown.length || bad.wrong.length) out.push(suspect(file, table.line, 'tabla', tableMessage(table, bad, pack)));
  }
  return out;
}

// Un error de este detector no puede frenar el arreglo del archivo: se dice y sigue.
export function safely(file, source, check) {
  try {
    return check();
  } catch (err) {
    return source.includes(FIELD) ? [suspect(file, null, 'error', `No pude revisar de dónde sale \`${FIELD}\` en este archivo (${String(err.message).split('\n')[0]}): revisá a mano que sea la condición de cada cliente.`)] : [];
  }
}

export const suspect = (file, line, rule, message) => ({ pack: PACK, file, line, status: 'detect-only', rule, message, due: null, change: CONDITION_CHANGE });

// El mismo mensaje en varios lugares del archivo es un aviso, con sus líneas.
export function collect(out) {
  return [...out.entries()].map(([message, { rule, file, line, also }]) => {
    const others = [...new Set(also)].filter((l) => l !== line);
    return suspect(file, line, rule, others.length ? `${message} También en la${others.length > 1 ? 's' : ''} línea${others.length > 1 ? 's' : ''} ${others.join(', ')}.` : message);
  });
}
export function addTo(out, results, file, line) {
  for (const { rule, message } of results) {
    const prior = out.get(message);
    if (prior) prior.also.push(line);
    else out.set(message, { rule, file, line, also: [] });
  }
}
