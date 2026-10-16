// Lectura de PHP con php-parser (glayzzle).
// A diferencia de recast, php-parser lee el texto original: loc.start.offset y loc.end.offset son
// posiciones exactas en el archivo del cliente, también con CRLF, tabs y acentos (lo cubren los tests).
// Por eso acá se edita con esos offsets y no con offsetAt(), que corrige las particularidades de recast.
import PhpParser from 'php-parser';

const engine = new PhpParser.Engine({
  parser: { php8: true, suppressErrors: false, extractDoc: false },
  ast: { withPositions: true, withSource: false },
});

export function parsePhp(source, file = 'archivo.php') {
  return engine.parseCode(source, file);
}

const SCOPE_KINDS = new Set(['function', 'method', 'closure', 'arrowfunc']);

// Recorre el AST y llama visit(node, scope), donde scope es la función, el método, la closure
// o el programa que contiene al nodo (en PHP las variables no cruzan esos límites).
export function walkPhp(node, visit, scope = node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walkPhp(n, visit, scope);
    return;
  }
  if (!node.kind) return;
  visit(node, scope);
  const inner = SCOPE_KINDS.has(node.kind) ? node : scope;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
    walkPhp(v, visit, inner);
  }
}

// Valor de un literal: número (también '99' entre comillas, que PHP convierte), string o booleano.
// undefined si no es un literal (constante, variable, llamada...).
export function phpLiteral(node) {
  if (!node) return undefined;
  if (node.kind === 'number') return Number(node.value);
  if (node.kind === 'string') return /^-?\d+$/.test(node.value) ? Number(node.value) : node.value;
  if (node.kind === 'boolean') return node.value;
  return undefined;
}

// Clave de un elemento de array si es un string literal ('DocTipo' => ...); null si no.
export function phpKey(entry) {
  return entry && entry.key && entry.key.kind === 'string' ? entry.key.value : null;
}

export function isPhp(file) {
  return /\.php$/i.test(file);
}
