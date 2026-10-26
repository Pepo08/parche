// El subconjunto de Mustache que usan las plantillas del resumen ({{x}}, {{{x}}}, {{#x}}…{{/x}}, {{^x}}…{{/x}},
// {{> parte}}, {{! nota}}), sin dependencias. Es el motor de `web-src/resumen/armar.mjs` del chat de página, que diseñó
// los mails (25/10/2026): se copió tal cual para que el resumen que arma Parche sea idéntico a su diseño.
import fs from 'node:fs';
import path from 'node:path';

const TAG = /\{\{(\{)?\s*([#^/!>]?)\s*([^}]*?)\s*\}?\}\}/g;

export function parse(src, nombre) {
  // Una línea que solo tiene una etiqueta de sección, de parte o un comentario no deja una línea vacía en la salida.
  src = src.replace(/^[ \t]*(\{\{[#^/!>][^}]*\}\})[ \t]*\r?\n/gm, '$1');
  const raiz = { hijos: [] };
  const pila = [raiz];
  let desde = 0;
  for (const m of src.matchAll(TAG)) {
    const hijos = pila.at(-1).hijos;
    if (m.index > desde) hijos.push(src.slice(desde, m.index));
    desde = m.index + m[0].length;
    const [, triple, sigilo, clave] = m;
    if (sigilo === '!') continue;
    if (sigilo === '#' || sigilo === '^') {
      const nodo = { tipo: sigilo, clave, hijos: [] };
      hijos.push(nodo);
      pila.push(nodo);
    } else if (sigilo === '/') {
      const abierta = pila.pop();
      if (abierta === raiz || abierta.clave !== clave) throw new Error(`${nombre}: {{/${clave}}} no cierra la sección abierta`);
    } else {
      hijos.push({ tipo: sigilo === '>' ? '>' : triple ? 'crudo' : 'var', clave });
    }
  }
  if (pila.length > 1) throw new Error(`${nombre}: falta {{/${pila.at(-1).clave}}}`);
  if (desde < src.length) raiz.hijos.push(src.slice(desde));
  return raiz.hijos;
}

function buscar(pila, clave) {
  if (clave === '.') return pila.at(-1);
  const [cabeza, ...resto] = clave.split('.');
  for (let i = pila.length - 1; i >= 0; i--) {
    const c = pila[i];
    if (c !== null && typeof c === 'object' && cabeza in c) return resto.reduce((v, k) => (v == null ? v : v[k]), c[cabeza]);
  }
  return undefined;
}

function pintar(nodos, pila, op) {
  let out = '';
  for (const n of nodos) {
    if (typeof n === 'string') { out += n; continue; }
    if (n.tipo === '>') { out += pintar(op.parte(n.clave), pila, op); continue; }
    const v = buscar(pila, n.clave);
    if (n.tipo === 'var' || n.tipo === 'crudo') {
      if (v === undefined) op.faltan.add(n.clave);
      out += v == null ? '' : n.tipo === 'crudo' ? String(v) : op.escapar(String(v));
      continue;
    }
    const vacio = !v || (Array.isArray(v) && v.length === 0);
    if (n.tipo === '^') { if (vacio) out += pintar(n.hijos, pila, op); continue; }
    if (vacio) continue;
    if (Array.isArray(v)) for (const item of v) out += pintar(n.hijos, [...pila, item], op);
    else out += pintar(n.hijos, typeof v === 'object' ? [...pila, v] : pila, op);
  }
  return out;
}

// En HTML, lo que va entre comillas invertidas sale en mono, como en los PRs de Parche. En el texto quedan las comillas.
const escaparHtml = (codigo) => (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/`([^`]+)`/g, (_, c) => `<code style="${codigo}">${c}</code>`);

// Un motor sobre una carpeta de plantillas: `render(src, ctx, { formato: 'html' | 'txt', nombre })` devuelve el texto y
// las claves que no tenían dato (`faltan`). Las partes se leen de `<dir>/partes/<parte>.<formato>`.
export function engine(dir, { codigo = '' } = {}) {
  const partes = new Map();
  const parte = (p, formato) => {
    const k = `${p}.${formato}`;
    if (!partes.has(k)) partes.set(k, parse(fs.readFileSync(path.join(dir, 'partes', k), 'utf8'), k));
    return partes.get(k);
  };
  return function render(src, ctx, { formato, nombre }) {
    const op = {
      faltan: new Set(),
      escapar: formato === 'html' ? escaparHtml(codigo) : (s) => s,
      parte: (p) => parte(p, formato),
    };
    return { texto: pintar(parse(src, nombre), [ctx], op), faltan: [...op.faltan] };
  };
}
