// Condición frente al IVA sospechosa en JS/TS (las reglas, en arca-condition-rules.js). Solo lee: no edita nada.
// Las rutas de lectura usan `loc` y `offsetAt`, nunca node.start/node.end (ver src/ast.js).
import { getProp, isPlainProp, keyName, literalValue, offsetAt } from '../ast.js';
import { classOf, isNearMissKey, isVoucherDetail } from './arca-rules.js';
import { addTo, collect, docCouldBeCuit, dyn, reviewCondition, tableFindings } from './arca-condition-rules.js';

const FIELD = 'CondicionIVAReceptorId';
const WRAPPERS = new Set(['TSAsExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSSatisfiesExpression', 'ParenthesizedExpression']);
const CASTS = new Set(['Number', 'parseInt', 'parseFloat', 'String']);
const MEMBERS = new Set(['MemberExpression', 'OptionalMemberExpression']);
const FUNCTIONS = /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassMethod|ObjectMethod)$/;
const MAX_DEPTH = 5;

// Lo que no cambia el valor: casts de TS, paréntesis, Number(x), parseInt(x, 10), +x y `${x}`.
function unwrap(node) {
  let n = node;
  for (;;) {
    if (!n) return n;
    if (WRAPPERS.has(n.type)) n = n.expression;
    else if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && CASTS.has(n.callee.name) && n.arguments[0]) n = n.arguments[0];
    else if (n.type === 'UnaryExpression' && n.operator === '+') n = n.argument;
    else if (n.type === 'TemplateLiteral' && n.expressions.length === 1 && !n.quasis.some((q) => q.value.cooked)) n = n.expressions[0];
    else return n;
  }
}

const memberName = (m) => (!m.computed && m.property.type === 'Identifier' ? m.property.name
  : m.computed && ['StringLiteral', 'NumericLiteral', 'Literal'].includes(m.property.type) ? String(m.property.value) : null);

function bindingOf(p, name) {
  const scope = p.scope && p.scope.lookup(name);
  const paths = scope && scope.getBindings()[name];
  return paths && paths.length ? { scope, path: paths[0] } : null;
}

const numeric = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v);
const deprecated = (n) => (n.comments || n.leadingComments || []).some((c) => /@deprecated/.test(c.value));

// Los enums de TS y los objetos de números de este archivo. Sin claves calculadas ni spreads.
function tablesOf(j, root) {
  const tables = new Map();
  const add = (name, line, entries) => {
    // Solo números: un objeto con otras claves (el comprobante mismo) no es una tabla.
    if (entries.length >= 2 && entries.every((e) => typeof e.value === 'number') && !tables.has(name)) tables.set(name, { name, line, entries, usedAt: null });
  };
  root.find(j.TSEnumDeclaration).forEach((p) => {
    const members = p.node.members || p.node.body?.members || [];
    let next = 0;
    const entries = [];
    for (const m of members) {
      const key = m.id.name ?? m.id.value;
      const init = m.initializer ? numeric(literalValue(m.initializer)) : next;
      if (typeof init === 'number') next = init + 1;
      entries.push({ key, value: init, deprecated: deprecated(m) });
    }
    add(p.node.id.name, p.node.id.loc?.start.line ?? p.node.loc?.start.line, entries); // `export enum` no trae loc propio
  });
  root.find(j.VariableDeclarator).forEach((p) => {
    if (p.node.id.type !== 'Identifier') return;
    let init = unwrap(p.node.init);
    if (init && init.type === 'CallExpression' && init.callee.type === 'MemberExpression' && init.callee.object.name === 'Object' && init.callee.property.name === 'freeze') init = unwrap(init.arguments[0]);
    if (!init || init.type !== 'ObjectExpression' || !init.properties.every(isPlainProp)) return;
    const entries = init.properties.map((pr) => ({ key: keyName(pr), value: numeric(literalValue(unwrap(pr.value))), deprecated: deprecated(pr) }));
    if (entries.some((e) => e.key === null)) return;
    add(p.node.id.name, p.node.loc?.start.line, entries);
  });
  return tables;
}

export function conditionFindings({ j, root, source, file, pack, context }) {
  const tables = tablesOf(j, root);
  const text = (n) => source.slice(offsetAt(source, n.loc.start), offsetAt(source, n.loc.end));
  // Las pruebas de los if, ternarios y switch que rodean a `p`, hasta llegar a la función.
  const testsAround = (p) => {
    const out = [];
    for (let c = p; c && c.parent; c = c.parent) {
      const parent = c.parent.node;
      if (FUNCTIONS.test(parent.type)) break;
      if ((parent.type === 'IfStatement' || parent.type === 'ConditionalExpression') && c.node !== parent.test) out.push(text(parent.test));
      if (parent.type === 'SwitchStatement') out.push(text(parent.discriminant));
    }
    return out;
  };

  function describe(node, p, line, depth = 0) {
    const n = unwrap(node);
    if (!n || depth > MAX_DEPTH) return dyn();
    const lit = literalValue(n);
    if (typeof lit === 'number' || typeof lit === 'string') return { kind: 'code', code: numeric(lit), raw: text(n) };
    if (n.type === 'ConditionalExpression') {
      return { kind: 'if', text: text(n), test: text(n.test), a: describe(n.consequent, p, line, depth + 1), b: describe(n.alternate, p, line, depth + 1) };
    }
    if (n.type === 'LogicalExpression' && (n.operator === '||' || n.operator === '??')) {
      return { kind: 'or', text: text(n), left: describe(n.left, p, line, depth + 1), right: describe(n.right, p, line, depth + 1) };
    }
    if (n.type === 'Identifier') return describeVariable(n.name, p, line, depth);
    if (MEMBERS.has(n.type)) return describeMember(n, p, line, depth);
    if (n.type === 'CallExpression') return describeCall(n, p, line, depth);
    return dyn();
  }

  function describeVariable(name, p, line, depth) {
    if (name === 'undefined') return dyn();
    const found = bindingOf(p, name);
    if (!found) return dyn();
    const parent = found.path.parent?.node;
    // function f(cond = 5), const { cond = 5 } = x: un valor por defecto.
    if (parent?.type === 'AssignmentPattern' && parent.left === found.path.node) {
      return { kind: 'or', text: `${name} = ${text(parent.right)}`, left: dyn(), right: describe(parent.right, found.path, line, depth + 1) };
    }
    if (parent?.type !== 'VariableDeclarator' || parent.id !== found.path.node) return dyn();
    const later = root.find(j.AssignmentExpression).filter((a) => {
      const left = a.node.left;
      return left.type === 'Identifier' && left.name === name && ['=', '||=', '??='].includes(a.node.operator) && a.scope.lookup(name) === found.scope;
    }).paths();
    if (!later.length) return parent.init ? describe(parent.init, found.path, line, depth + 1) : dyn();
    const init = parent.init ? describe(parent.init, found.path, line, depth + 1) : null;
    const lines = [...new Set([parent.loc?.start.line, ...later.map((a) => a.node.loc?.start.line)])].filter(Boolean);
    return {
      kind: 'rules',
      name,
      text: name,
      where: ` (líneas ${lines.slice(0, -1).join(', ')} y ${lines[lines.length - 1]})`,
      init,
      assigns: later.map((a) => ({
        value: describe(a.node.right, a, line, depth + 1),
        tests: a.node.operator === '=' ? testsAround(a) : [name],
      })),
    };
  }

  // ENUM.EXENTO o MAPA[x], si la tabla está en este archivo. Una tabla de otro archivo no se lee: se revisa donde se declara.
  function describeMember(n, p, line) {
    const obj = unwrap(n.object);
    if (!obj || obj.type !== 'Identifier') return dyn();
    const table = tables.get(obj.name);
    if (!table) return dyn();
    const key = memberName(n);
    const entry = key === null ? null : table.entries.find((e) => String(e.key) === key);
    if (key === null || entry) table.usedAt ??= line;
    if (key === null) return { kind: 'table', name: obj.name };
    return entry ? { kind: 'code', code: entry.value, raw: `${obj.name}.${key}`, fromTable: true } : dyn();
  }

  // cond(x): si la función está en este archivo y devuelve números fijos, importan los que no existen en la tabla.
  // Que devuelva un número fijo por cada condición del cliente está bien: es una traducción.
  function describeCall(n, p) {
    const callee = unwrap(n.callee);
    let fn = null;
    if (callee.type === 'Identifier') {
      const found = bindingOf(p, callee.name);
      const parent = found?.path.parent?.node;
      if (parent?.type === 'FunctionDeclaration') fn = found.path.parent;
      else if (parent?.type === 'VariableDeclarator' && FUNCTIONS.test(parent.init?.type || '')) fn = found.path.parent.get('init');
    } else if (MEMBERS.has(callee.type) && callee.object.type === 'ThisExpression' && !callee.computed) {
      const name = callee.property.name;
      const methods = root.find(j.ClassMethod).filter((m) => keyName(m.node) === name).paths();
      if (methods.length === 1) [fn] = methods;
    }
    if (!fn) return dyn();
    const codes = [];
    j(fn).find(j.ReturnStatement).forEach((r) => {
      const arg = unwrap(r.node.argument);
      const lit = arg ? literalValue(arg) : undefined;
      if (typeof lit === 'number') codes.push({ kind: 'code', code: lit, raw: text(arg) });
    });
    return codes.length ? { kind: 'fn', codes } : dyn();
  }

  const siteOf = (obj, p, valueNode) => {
    const read = (key) => {
      const prop = obj ? getProp(obj, key) : null;
      if (!prop) return { present: false };
      const d = describe(prop.value, p, 0, 3);
      return { present: true, d, code: d.kind === 'code' && typeof d.code === 'number' ? d.code : undefined };
    };
    const doc = read('DocTipo');
    const cbte = read('CbteTipo');
    const nl = source.indexOf('\n', offsetAt(source, valueNode.loc.end));
    const rest = source.slice(offsetAt(source, valueNode.loc.end), nl === -1 ? source.length : nl);
    const comment = rest.match(/(?:\/\/|\/\*)\s*([^*]+)/)?.[1]?.trim() || null;
    return { docTipo: doc.code, docVaries: doc.present && docCouldBeCuit(doc.d), guarded: testsAround(p).length > 0, clase: cbte.code === undefined ? null : classOf(cbte.code), comment };
  };

  const out = new Map();
  const review = (value, site, line) => addTo(out, reviewCondition(describe(value, site.path, line), site, pack), file, line);

  root.find(j.ObjectProperty).forEach((p) => {
    const key = keyName(p.node);
    const obj = p.parent.node;
    if (key !== FIELD && !(isNearMissKey(key) && isVoucherDetail(obj.properties.filter(isPlainProp).map(keyName)))) return;
    review(p.node.value, { ...siteOf(obj, p, p.node.value), path: p }, p.node.loc?.start.line);
  });

  root.find(j.AssignmentExpression).forEach((p) => {
    const left = p.node.left;
    if (!MEMBERS.has(left.type) || memberName(left) !== FIELD) return;
    const target = unwrap(left.object);
    const found = target && target.type === 'Identifier' ? bindingOf(p, target.name) : null;
    const decl = found?.path.parent?.node;
    const init = decl?.type === 'VariableDeclarator' ? unwrap(decl.init) : null;
    review(p.node.right, { ...siteOf(init?.type === 'ObjectExpression' ? init : null, p, p.node.right), path: p }, p.node.loc?.start.line);
  });

  // XML en un template: <ar:CondicionIVAReceptorId>${x}</ar:CondicionIVAReceptorId>
  root.find(j.TemplateLiteral).forEach((p) => {
    p.node.quasis.forEach((q, i) => {
      if (!/<(?:\w+:)?CondicionIVAReceptorId>\s*$/.test(q.value.raw) || !p.node.expressions[i]) return;
      const value = p.node.expressions[i];
      review(value, { docTipo: undefined, docVaries: false, clase: null, comment: null, path: p }, value.loc?.start.line);
    });
  });

  // Un armador de XML: tag('ar:CondicionIVAReceptorId', x)
  root.find(j.CallExpression).forEach((p) => {
    const [name, value] = p.node.arguments;
    if (!value || typeof literalValue(name) !== 'string' || !/^(?:\w+:)?CondicionIVAReceptorId$/.test(literalValue(name))) return;
    review(value, { docTipo: undefined, docVaries: false, clase: null, comment: null, path: p }, value.loc?.start.line);
  });

  return [...collect(out), ...tableFindings(tables, file, source, pack, context)];
}
