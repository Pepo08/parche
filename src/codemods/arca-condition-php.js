// Condición frente al IVA sospechosa en PHP (las reglas, en arca-condition-rules.js). Solo lee: no edita nada.
// php-parser da los offsets exactos del archivo (ver src/php.js).
import { phpKey, phpLiteral } from '../php.js';
import { classOf, isNearMissKey, isVoucherDetail } from './arca-rules.js';
import { addTo, collect, docCouldBeCuit, dyn, reviewCondition, tableFindings } from './arca-condition-rules.js';

const FIELD = 'CondicionIVAReceptorId';
const SCOPES = new Set(['function', 'method', 'closure', 'arrowfunc']);
const CASTS = new Set(['intval', 'floatval', 'strval']);
const MAX_DEPTH = 5;

// Como walkPhp, sumando las pruebas de los if, ternarios y switch que rodean a cada nodo.
function scan(node, visit, scope = node, tests = []) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) scan(n, visit, scope, tests);
    return;
  }
  if (!node.kind) return;
  visit(node, scope, tests);
  const fresh = SCOPES.has(node.kind);
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
    const guarded = (node.kind === 'if' || node.kind === 'retif' || node.kind === 'switch') && k !== 'test';
    scan(v, visit, fresh ? node : scope, fresh ? [] : guarded ? [...tests, node.test] : tests);
  }
}

const entriesOf = (arr) => arr.items.filter((it) => it && it.kind === 'entry');
const nameOf = (n) => (typeof n === 'string' ? n : n?.name ?? null);

export function conditionFindingsPhp({ ast, source, file, pack, context }) {
  const text = (n) => source.slice(n.loc.start.offset, n.loc.end.offset);
  const assigns = new Map(); // scope → nombre → [{ node, tests }]
  const tables = new Map(); // nombre → { name, line, entries, usedAt }
  const addTable = (name, line, entries) => {
    // Solo números: un array con otras claves (el comprobante mismo) no es una tabla.
    if (entries.length >= 2 && entries.every((e) => typeof e.value === 'number') && !tables.has(name)) tables.set(name, { name, line, entries, usedAt: null });
  };
  const arrayEntries = (arr) => entriesOf(arr).map((e) => ({ key: phpKey(e), value: phpLiteral(e.value) })).filter((e) => e.key !== null);

  scan(ast, (node, scope, tests) => {
    if (node.kind === 'assign' && node.left.kind === 'variable' && typeof node.left.name === 'string') {
      if (!assigns.has(scope)) assigns.set(scope, new Map());
      const byName = assigns.get(scope);
      byName.set(node.left.name, [...(byName.get(node.left.name) || []), { node, tests }]);
      if (node.operator === '=' && node.right.kind === 'array') addTable(node.left.name, node.loc.start.line, arrayEntries(node.right));
    }
    // const CONDICION = [...], class CondicionIva { const EXENTO = 2; }, enum CondicionIva: int { case EXENTO = 2; }
    if (node.kind === 'constantstatement' || node.kind === 'classconstant') {
      for (const c of node.constants || []) {
        if (c.value?.kind === 'array') addTable(nameOf(c.name), c.loc.start.line, arrayEntries(c.value));
      }
    }
    if ((node.kind === 'class' || node.kind === 'enum') && nameOf(node.name)) {
      const entries = [];
      for (const member of node.body || []) {
        if (member.kind === 'classconstant') for (const c of member.constants || []) entries.push({ key: nameOf(c.name), value: phpLiteral(c.value) });
        if (member.kind === 'enumcase' && member.value) entries.push({ key: nameOf(member.name), value: phpLiteral(member.value) });
      }
      addTable(nameOf(node.name), node.loc.start.line, entries);
    }
  });

  function describe(node, scope, line, depth = 0) {
    if (!node || depth > MAX_DEPTH) return dyn();
    const lit = phpLiteral(node);
    if (typeof lit === 'number' || (typeof lit === 'string' && node.kind === 'string')) return { kind: 'code', code: lit, raw: text(node) };
    if (node.kind === 'cast') return describe(node.expr, scope, line, depth + 1);
    if (node.kind === 'call' && CASTS.has(nameOf(node.what)) && node.arguments[0]) return describe(node.arguments[0], scope, line, depth + 1);
    if (node.kind === 'retif') {
      const b = describe(node.falseExpr, scope, line, depth + 1);
      if (!node.trueExpr) return { kind: 'or', text: text(node), left: describe(node.test, scope, line, depth + 1), right: b };
      return { kind: 'if', text: text(node), test: text(node.test), a: describe(node.trueExpr, scope, line, depth + 1), b };
    }
    if (node.kind === 'bin' && node.type === '??') {
      return { kind: 'or', text: text(node), left: describe(node.left, scope, line, depth + 1), right: describe(node.right, scope, line, depth + 1) };
    }
    if (node.kind === 'variable' && typeof node.name === 'string') return describeVariable(node.name, scope, line, depth);
    if (node.kind === 'offsetlookup') return describeLookup(node, scope, line, depth);
    if (node.kind === 'staticlookup') return describeConstant(node, line);
    if (node.kind === 'propertylookup' && nameOf(node.offset) === 'value' && node.what?.kind === 'staticlookup') return describeConstant(node.what, line);
    return dyn();
  }

  function describeVariable(name, scope, line, depth) {
    const defs = assigns.get(scope)?.get(name) || [];
    const v = `$${name}`;
    if (!defs.length) {
      // function f($cond = 5): un valor por defecto.
      const param = (scope.arguments || []).find((a) => a.kind === 'parameter' && nameOf(a.name) === name);
      if (param?.value) return { kind: 'or', text: `${v} = ${text(param.value)}`, left: dyn(), right: describe(param.value, scope, line, depth + 1) };
      return dyn();
    }
    if (defs.length === 1 && !defs[0].tests.length && defs[0].node.operator === '=') return describe(defs[0].node.right, scope, line, depth + 1);
    const first = defs[0].tests.length ? null : defs[0];
    const rest = first ? defs.slice(1) : defs;
    const lines = [...new Set(defs.map((d) => d.node.loc.start.line))];
    return {
      kind: 'rules',
      name: v,
      text: v,
      where: lines.length > 1 ? ` (líneas ${lines.slice(0, -1).join(', ')} y ${lines[lines.length - 1]})` : ` (línea ${lines[0]})`,
      init: first ? describe(first.node.right, scope, line, depth + 1) : null,
      assigns: rest.map((d) => ({
        value: describe(d.node.right, scope, line, depth + 1),
        tests: d.node.operator === '=' ? d.tests.map(text) : [v],
      })),
    };
  }

  // $mapa[$x], self::MAPA[$x]: la tabla, si está en este archivo.
  function describeLookup(node, scope, line) {
    const name = node.what?.kind === 'variable' ? node.what.name : node.what?.kind === 'staticlookup' ? nameOf(node.what.offset) : null;
    const table = name ? tables.get(name) : null;
    if (!table) return dyn();
    const key = phpLiteral(node.offset);
    const entry = key === undefined ? null : table.entries.find((e) => String(e.key) === String(key));
    if (key === undefined || entry) table.usedAt ??= line;
    if (key === undefined) return { kind: 'table', name };
    return entry ? { kind: 'code', code: entry.value, raw: text(node), fromTable: true } : dyn();
  }

  // CondicionIva::EXENTO, self::EXENTO: la constante, si la clase está en este archivo.
  function describeConstant(node, line) {
    const key = nameOf(node.offset);
    const owner = nameOf(node.what);
    const table = owner && tables.get(owner);
    const entry = table?.entries.find((e) => e.key === key);
    if (entry) table.usedAt ??= line;
    return entry ? { kind: 'code', code: entry.value, raw: text(node), fromTable: true } : dyn();
  }

  const siteOf = (arrEntries, scope, value, tests) => {
    const read = (key) => {
      const e = arrEntries?.find((x) => phpKey(x) === key);
      if (!e) return { present: false };
      const d = describe(e.value, scope, 0, 3);
      return { present: true, d, code: d.kind === 'code' && typeof d.code === 'number' ? d.code : undefined };
    };
    const doc = read('DocTipo');
    const cbte = read('CbteTipo');
    const nl = source.indexOf('\n', value.loc.end.offset);
    const rest = source.slice(value.loc.end.offset, nl === -1 ? source.length : nl);
    const comment = rest.match(/(?:\/\/|#|\/\*)\s*([^*]+)/)?.[1]?.trim() || null;
    return { docTipo: doc.code, docVaries: doc.present && docCouldBeCuit(doc.d), guarded: tests.length > 0, clase: cbte.code === undefined ? null : classOf(cbte.code), comment };
  };

  const out = new Map();
  const review = (value, site, scope, line) => addTo(out, reviewCondition(describe(value, scope, line), site, pack), file, line);

  scan(ast, (node, scope, tests) => {
    if (node.kind === 'array') {
      const entries = entriesOf(node);
      const entry = entries.find((e) => phpKey(e) === FIELD)
        || entries.find((e) => isNearMissKey(phpKey(e)) && isVoucherDetail(entries.map(phpKey)));
      if (entry) review(entry.value, siteOf(entries, scope, entry.value, tests), scope, entry.loc.start.line);
    }
    if (node.kind === 'assign') {
      const { left } = node;
      const isField = (left.kind === 'offsetlookup' && left.offset && phpLiteral(left.offset) === FIELD)
        || ((left.kind === 'propertylookup' || left.kind === 'nullsafepropertylookup') && nameOf(left.offset) === FIELD);
      if (!isField) return;
      const defs = left.what?.kind === 'variable' ? assigns.get(scope)?.get(left.what.name) : null;
      const arr = defs?.length === 1 && defs[0].node.right.kind === 'array' ? entriesOf(defs[0].node.right) : null;
      review(node.right, siteOf(arr, scope, node.right, tests), scope, node.loc.start.line);
    }
  });

  return [...collect(out), ...tableFindings(tables, file, pack, context)];
}
