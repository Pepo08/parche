// Utilidades de AST compartidas por todos los codemods.
import jscodeshift from 'jscodeshift';
import { parse as babelParse } from '@babel/parser';
import { parsePhp, isPhp } from './php.js';

export function jFor(file) {
  const parser = /\.ts$/.test(file) ? 'ts' : 'tsx';
  return jscodeshift.withParser(parser);
}

// Estilo de comillas predominante en el archivo, para que el código nuevo combine.
export function detectQuote(source) {
  const single = (source.match(/'[^'\n]*'/g) || []).length;
  const double = (source.match(/"[^"\n]*"/g) || []).length;
  return double > single ? 'double' : 'single';
}

// Fin de línea predominante en el archivo. recast imprime con os.EOL por defecto (\r\n en
// Windows), así que hay que pasárselo siempre para no reescribir el archivo entero.
export function eolOf(source) {
  const crlf = (source.match(/\r\n/g) || []).length;
  const lf = (source.match(/\n/g) || []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

// Aplica ediciones de texto { offset, text, remove } de atrás para adelante, así no se corren los offsets.
// Sin `remove` es una inserción; con `remove`, `text` reemplaza esa cantidad de caracteres desde `offset`.
export function applyEdits(source, edits) {
  let out = source;
  for (const e of [...edits].sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, e.offset) + e.text + out.slice(e.offset + (e.remove || 0));
  }
  return out;
}

// Offset en el texto original de una posición { line, column } de recast.
// No usar node.start/node.end para editar texto: recast parsea una copia con las líneas unidas
// por os.EOL y las tabs de la indentación expandidas, así que esos offsets no coinciden con el
// archivo del cliente (en Windows quedan corridos un carácter por línea).
export function offsetAt(source, { line, column }, tabWidth = 4) {
  let k = 0;
  for (let i = 1; i < line; i++) k = source.indexOf('\n', k) + 1;
  // La indentación se mide como en recast: tab hasta el próximo múltiplo, \v \f y BOM no ocupan.
  let width = 0;
  while (width < column && /[^\S\r\n]/.test(source[k] ?? '')) {
    if (source[k] === '\t') width = (Math.floor(width / tabWidth) + 1) * tabWidth;
    else if (!'\v\f﻿'.includes(source[k])) width += 1;
    k++;
  }
  return k + (column - width);
}

export function keyName(prop) {
  if (!prop || !prop.key) return null;
  if (prop.computed) return null;
  const k = prop.key;
  if (k.type === 'Identifier') return k.name;
  if (k.type === 'StringLiteral' || (k.type === 'Literal' && typeof k.value === 'string')) return k.value;
  return null;
}

export function isPlainProp(prop) {
  return prop && (prop.type === 'ObjectProperty' || prop.type === 'Property');
}

export function hasSpread(obj) {
  return obj.properties.some((p) => p.type === 'SpreadElement' || p.type === 'SpreadProperty' || p.type === 'ObjectMethod');
}

export function getProp(obj, name) {
  return obj.properties.find((p) => isPlainProp(p) && keyName(p) === name) || null;
}

export function isQuotedKey(prop) {
  return prop.key && (prop.key.type === 'StringLiteral' || prop.key.type === 'Literal');
}

export function literalValue(node) {
  if (!node) return undefined;
  if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node.type)) return node.value;
  if (node.type === 'Literal') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return undefined;
}

export function isStringLit(node) {
  return node && (node.type === 'StringLiteral' || (node.type === 'Literal' && typeof node.value === 'string'));
}

export function lineOf(node) {
  return node && node.loc ? node.loc.start.line : null;
}

// Copia profunda de un nodo sin metadatos de posición, para poder usarlo dos veces.
export function cloneNode(node) {
  if (Array.isArray(node)) return node.map(cloneNode);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'range', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'original', 'tokens'].includes(k)) continue;
    out[k] = cloneNode(v);
  }
  return out;
}

// Cadena de propiedades de un MemberExpression no computado: result.a.b → { root: 'result', path: ['a','b'] }
export function memberChain(node) {
  const path = [];
  let cur = node;
  while (cur && (cur.type === 'MemberExpression' || cur.type === 'OptionalMemberExpression')) {
    if (cur.computed || cur.property.type !== 'Identifier') return null;
    path.unshift(cur.property.name);
    cur = cur.object;
  }
  if (!cur || cur.type !== 'Identifier') return null;
  return { root: cur.name, path };
}

export function buildMember(j, rootName, parts) {
  let expr = j.identifier(rootName);
  for (const part of parts) {
    if (typeof part === 'number') expr = j.memberExpression(expr, j.numericLiteral(part), true);
    else expr = j.memberExpression(expr, j.identifier(part));
  }
  return expr;
}

// ¿Este Identifier es una referencia real (no una clave de objeto ni una propiedad de member)?
export function isReference(path) {
  const parent = path.parent && path.parent.node;
  if (!parent) return true;
  if ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && parent.property === path.node && !parent.computed) return false;
  if ((parent.type === 'ObjectProperty' || parent.type === 'Property') && parent.key === path.node && !parent.computed && !parent.shorthand) return false;
  if (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier') return false;
  if (parent.type === 'VariableDeclarator' && parent.id === path.node) return false;
  if (parent.type === 'TSPropertySignature' || parent.type === 'TSQualifiedName') return false;
  const grand = path.parent.parent && path.parent.parent.node;
  if ((parent.type === 'ObjectProperty' || parent.type === 'Property') && grand && grand.type === 'ObjectPattern') return false;
  return true;
}

// Nodo armado desde texto: recast lo imprime tal cual, sin reformatear.
export function snippet(j, code, type) {
  return j(code).find(j[type]).paths()[0].node;
}

// Resuelve un Identifier a la inicialización de su declaración (const x = {...}) usando el scope.
export function resolveBinding(path, name) {
  const scope = path.scope && path.scope.lookup(name);
  if (!scope) return null;
  const bindings = scope.getBindings()[name];
  if (!bindings || !bindings.length) return null;
  const declPath = bindings[0].parent;
  if (declPath && declPath.node.type === 'VariableDeclarator' && declPath.node.id.type === 'Identifier') return declPath;
  return null;
}

// Chequeo de sintaxis del resultado, usado por verify y por los tests.
export function parseCheck(source, file) {
  if (isPhp(file)) {
    parsePhp(source, file);
    return true;
  }
  // decorators-legacy: NestJS, Angular y TypeORM usan decoradores (@Injectable()); sin el plugin, el chequeo
  // de sintaxis fallaba y --verify frenaba el PR en esos repos.
  const plugins = ['jsx', 'decorators-legacy'];
  if (/\.(ts|tsx)$/.test(file)) plugins.push('typescript');
  if (/\.ts$/.test(file)) plugins.splice(plugins.indexOf('jsx'), 1);
  babelParse(source, { sourceType: 'unambiguous', plugins, allowAwaitOutsideFunction: true });
  return true;
}

export function finding(pack, file, node, status, message, extra = {}) {
  return { pack, file, line: lineOf(node), status, message, ...extra };
}

// Recast agrega líneas en blanco alrededor de propiedades multilínea que reimprime.
// Esto saca SOLO las líneas en blanco nuevas (las que no estaban en el original),
// usando un diff de líneas, así el PR muestra el cambio y nada más.
export function tidy(original, output) {
  const a = original.split('\n');
  const b = output.split('\n');
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let k = m - 1; k >= 0; k--) {
      dp[i][k] = a[i] === b[k] ? dp[i + 1][k + 1] + 1 : Math.max(dp[i + 1][k], dp[i][k + 1]);
    }
  }
  const keep = [];
  let i = 0;
  let k = 0;
  while (k < m) {
    // Una línea en blanco que también puede emparejarse más adelante se toma como nueva: así lo
    // insertado con insertAfter queda pegado a la línea anterior (el import nuevo junto a los otros
    // imports) y la línea en blanco original queda después.
    if (i < n && a[i] === b[k] && b[k].trim() === '' && dp[i][k + 1] === dp[i][k]) { k++; continue; }
    if (i < n && a[i] === b[k]) { keep.push(b[k]); i++; k++; continue; }
    if (i < n && dp[i + 1][k] >= dp[i][k + 1]) { i++; continue; }
    if (b[k].trim() !== '') keep.push(b[k]); // línea nueva con contenido: se queda
    k++;
  }
  return keep.join('\n');
}
