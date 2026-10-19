// Inventario de un archivo JS/TS: qué SDKs usa (y con qué operaciones), a qué hosts llama por HTTP
// y qué modelos de IA nombra. Solo lee: usa @babel/parser directo (sin recast, no hay offsets que cuidar).
//
// Límite conocido: las variables se siguen por nombre en todo el archivo, sin scopes. Alcanza para el
// inventario (aviso de nivel 1); un codemod que edita nunca debe apoyarse en esto.
import { parse } from '@babel/parser';
import { packageOf, isInternalHost } from './known.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const FETCH_PACKAGES = new Set(['node-fetch', 'cross-fetch', 'isomorphic-fetch', 'undici']);
const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'range', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'tokens']);

// IDs de modelos de IA. Prefijos inequívocos; la serie o1/o3/o4, Sora y computer-use de OpenAI solo cuentan si
// el archivo usa OpenAI.
const MODEL_PATTERNS = [
  [/^(gpt-(3\.5|4|4\.1|4o|4\.5|5|6|realtime|audio)[\w.-]*|chatgpt-[\w.-]+|text-embedding-[\w-]+|dall-e-[23]|whisper-1|tts-1(-hd)?|gpt-image-[\w.-]+)$/, 'OpenAI'],
  [/^(o[1-9](-(mini|pro|preview))?(-deep-research)?(-\d{4}-\d{2}-\d{2})?|sora-2[\w.-]*|computer-use-preview[\w.-]*)$/, 'OpenAI', { needs: 'openai' }],
  [/^claude-[\w.-]+$/, 'Anthropic'],
  [/^(gemini|gemma)-[\w.-]+$/, 'Google (Gemini)'],
  [/^(mistral|mixtral|codestral|pixtral|ministral)-[\w.-]+$/, 'Mistral'],
  [/^command-(r|a)[\w.-]*$/, 'Cohere'],
];

function parseJs(source, file) {
  const lang = /\.tsx$/.test(file) ? ['typescript', 'jsx'] : /\.(ts|mts|cts)$/.test(file) ? ['typescript'] : ['jsx'];
  const plugins = [...lang, 'decorators-legacy']; // NestJS, Angular, TypeORM
  return parse(source, {
    sourceType: 'unambiguous', plugins, errorRecovery: true,
    allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, allowImportExportEverywhere: true,
  });
}

function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit, parent); return; }
  if (typeof node.type !== 'string') return;
  visit(node, parent);
  for (const [k, v] of Object.entries(node)) if (!SKIP_KEYS.has(k)) walk(v, visit, node);
}

const isRequire = (n) => n && n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'require'
  && n.arguments[0] && n.arguments[0].type === 'StringLiteral';
const propName = (n) => (n.type === 'Identifier' ? n.name : n.type === 'StringLiteral' ? n.value : null);

// a.b.c(...) → { root: 'a', path: ['b', 'c'] }; null si la cadena no es estática.
function chainOf(node) {
  const path = [];
  let cur = node;
  while (cur && (cur.type === 'MemberExpression' || cur.type === 'OptionalMemberExpression')) {
    const name = cur.computed ? (cur.property.type === 'StringLiteral' ? cur.property.value : null) : propName(cur.property);
    if (name === null) return null;
    path.unshift(name);
    cur = cur.object;
  }
  if (cur && cur.type === 'Identifier') return { root: cur.name, path };
  // this.afip.ElectronicBilling.createVoucher → raíz "this.afip" (cliente guardado en la clase)
  if (cur && cur.type === 'ThisExpression' && path.length) return { root: `this.${path[0]}`, path: path.slice(1) };
  return null;
}

export function scanJs(source, file) {
  const result = { sdk: [], http: [], unresolved: [], models: [], imports: new Set() };
  let ast;
  try {
    ast = parseJs(source, file);
  } catch {
    return result;
  }
  const bindings = new Map(); // nombre → { pkg, kind: 'module'|'named'|'client'|'http', imported?, prefix?, base? }
  const constants = new Map(); // nombre → string resuelto (para armar URLs)
  const bind = (name, info) => { if (name) bindings.set(name, info); };

  // Texto estático de una expresión: literales, plantillas y constantes del archivo; '{}' donde no se sabe.
  const staticText = (expr) => {
    if (!expr) return null;
    if (expr.type === 'StringLiteral') return expr.value;
    if (expr.type === 'TemplateLiteral') {
      return expr.quasis.map((q, i) => q.value.cooked + (i < expr.expressions.length ? (staticText(expr.expressions[i]) ?? '{}') : '')).join('');
    }
    if (expr.type === 'Identifier' && constants.has(expr.name)) return constants.get(expr.name);
    if (expr.type === 'BinaryExpression' && expr.operator === '+') {
      const l = staticText(expr.left);
      const r = staticText(expr.right);
      return (l ?? '{}') + (r ?? '{}');
    }
    return null;
  };
  const objProp = (obj, name) => obj && obj.type === 'ObjectExpression'
    && obj.properties.find((p) => (p.type === 'ObjectProperty' || p.type === 'Property') && !p.computed && propName(p.key) === name);
  const objString = (obj, name) => { const p = objProp(obj, name); return p ? staticText(p.value) : null; };

  // Instancias: new Stripe(key), twilio(sid, token), new Payment(client), axios.create({ baseURL }).
  // → binding nuevo, o null si la expresión no crea un cliente de un SDK conocido en el archivo.
  const instanceBinding = (expr) => {
    let init = expr;
    if (init && init.type === 'AwaitExpression') init = init.argument;
    if (!init || (init.type !== 'NewExpression' && init.type !== 'CallExpression')) return null;
    if (init.callee.type === 'Identifier' && bindings.has(init.callee.name)) {
      const b = bindings.get(init.callee.name);
      if (b.kind === 'named') return { pkg: b.pkg, kind: 'client', prefix: b.imported };
      return { pkg: b.pkg, kind: 'client', prefix: b.prefix || '' };
    }
    const ch = init.callee.type === 'MemberExpression' ? chainOf(init.callee) : null;
    if (ch && bindings.has(ch.root)) {
      const b = bindings.get(ch.root);
      const last = ch.path[ch.path.length - 1];
      if ((b.pkg === 'axios' && last === 'create') || (b.pkg === 'got' && last === 'extend')) {
        const cfg = init.arguments[0];
        return { pkg: b.pkg, kind: 'http', base: objString(cfg, 'baseURL') ?? objString(cfg, 'prefixUrl') };
      }
      if (init.type === 'NewExpression') return { pkg: b.pkg, kind: 'client', prefix: [b.prefix, ...ch.path].filter(Boolean).join('.') };
    }
    return null;
  };

  // 1) Imports, require, constantes e instancias (en orden de aparición).
  walk(ast, (node) => {
    // Cliente guardado en una clase: `private afip = new Afip(...)` o `this.afip = new Afip(...)` en el constructor.
    if ((node.type === 'ClassProperty' || node.type === 'PropertyDefinition') && !node.computed && node.key.type === 'Identifier' && node.value) {
      const b = instanceBinding(node.value);
      if (b) bind(`this.${node.key.name}`, b);
      return;
    }
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && node.left.object.type === 'ThisExpression'
      && !node.left.computed && node.left.property.type === 'Identifier') {
      const b = instanceBinding(node.right);
      if (b) bind(`this.${node.left.property.name}`, b);
      return;
    }
    if (node.type === 'ImportDeclaration' && node.importKind !== 'type') {
      const pkg = packageOf(node.source.value);
      if (!pkg) return;
      result.imports.add(pkg);
      for (const s of node.specifiers) {
        if (s.importKind === 'type') continue;
        if (s.type === 'ImportSpecifier') bind(s.local.name, { pkg, kind: 'named', imported: propName(s.imported) });
        else bind(s.local.name, { pkg, kind: 'module' });
      }
      return;
    }
    if (node.type !== 'VariableDeclarator' || !node.init) return;
    let init = node.init;
    if (init.type === 'AwaitExpression') init = init.argument;
    const id = node.id;
    // const BASE = 'https://...'
    if (id.type === 'Identifier' && (init.type === 'StringLiteral' || init.type === 'TemplateLiteral' || init.type === 'BinaryExpression')) {
      const t = staticText(init);
      if (t !== null) constants.set(id.name, t);
      return;
    }
    // require('x'), require('x').Y y require('x')(...)
    if (isRequire(init) || (init.type === 'MemberExpression' && isRequire(init.object)) || (init.type === 'CallExpression' && isRequire(init.callee))) {
      const req = isRequire(init) ? init : init.type === 'MemberExpression' ? init.object : init.callee;
      const pkg = packageOf(req.arguments[0].value);
      if (!pkg) return;
      result.imports.add(pkg);
      if (init.type === 'CallExpression' && init !== req) return bind(id.name, { pkg, kind: 'client', prefix: '' });
      if (init.type === 'MemberExpression') return bind(id.name, { pkg, kind: 'named', imported: propName(init.property) });
      if (id.type === 'Identifier') return bind(id.name, { pkg, kind: 'module' });
      if (id.type === 'ObjectPattern') {
        for (const p of id.properties) {
          if (p.type === 'ObjectProperty' && p.value.type === 'Identifier') bind(p.value.name, { pkg, kind: 'named', imported: propName(p.key) });
        }
      }
      return;
    }
    if (id.type !== 'Identifier') return;
    const b = instanceBinding(init);
    if (b) bind(id.name, b);
  });

  const usesOpenAI = result.imports.has('openai');

  const recordHttp = (client, method, urlExpr, line, base = null) => {
    let url = staticText(urlExpr);
    if (url !== null && base && !/^https?:\/\//i.test(url)) url = base.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '');
    if (url === null || url.startsWith('{}')) {
      result.unresolved.push({ kind: 'http', client, line, reason: 'URL dinámica: no se puede saber a qué host va' });
      return;
    }
    const m = url.match(/^https?:\/\/([^/?#{}]+)(\/[^?#]*)?/i);
    if (!m) return; // ruta relativa: es el backend propio, no una API de terceros
    // Sin el puerto, también cuando es dinámico: http://localhost:${PORT} → "localhost:" → "localhost".
    const host = m[1].toLowerCase().replace(/:.*$/, '');
    if (isInternalHost(host)) return;
    result.http.push({ client, method: (method || 'GET').toUpperCase(), host, path: (m[2] || '/').replace(/\{\}[^/]*/g, '{}'), line });
  };

  // 2) Llamadas.
  walk(ast, (node) => {
    if (node.type === 'StringLiteral' || (node.type === 'TemplateLiteral' && node.expressions.length === 0)) {
      const value = node.type === 'StringLiteral' ? node.value : node.quasis[0].value.cooked;
      for (const [re, provider, opts] of MODEL_PATTERNS) {
        if (re.test(value) && (!opts || (opts.needs === 'openai' && usesOpenAI))) {
          result.models.push({ id: value, provider, line: node.loc.start.line });
          break;
        }
      }
      return;
    }
    if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return;
    const line = node.loc.start.line;
    const callee = node.callee;
    const [a0, a1] = node.arguments;

    // fetch global, o importado de node-fetch / undici / cross-fetch
    if (callee.type === 'Identifier') {
      const b = bindings.get(callee.name);
      if ((!b && callee.name === 'fetch') || (b && FETCH_PACKAGES.has(b.pkg) && (b.kind === 'module' || b.imported === 'fetch'))) {
        return recordHttp(b ? b.pkg : 'fetch', objString(a1, 'method'), a0, line);
      }
      if (b && b.pkg === 'undici' && b.imported === 'request') return recordHttp('undici', objString(a1, 'method'), a0, line);
      if (b && (b.pkg === 'axios' || b.pkg === 'got') && (b.kind === 'module' || b.kind === 'http')) {
        if (a0 && a0.type === 'ObjectExpression') return recordHttp(b.pkg, objString(a0, 'method'), objProp(a0, 'url')?.value, line, objString(a0, 'baseURL') ?? b.base);
        return recordHttp(b.pkg, objString(a1, 'method'), a0, line, b.base);
      }
      if (b && b.kind === 'named') result.sdk.push({ pkg: b.pkg, op: b.imported, line });
      return;
    }
    const ch = chainOf(callee);
    if (!ch || !bindings.has(ch.root)) return;
    const b = bindings.get(ch.root);
    const method = ch.path[ch.path.length - 1];
    if (['axios', 'got', 'ky', 'superagent'].includes(b.pkg) || b.kind === 'http') {
      if (ch.path.length === 1 && HTTP_METHODS.includes(method)) return recordHttp(b.pkg, method, a0, line, b.base);
      if (ch.path.length === 1 && method === 'request' && a0 && a0.type === 'ObjectExpression') {
        return recordHttp(b.pkg, objString(a0, 'method'), objProp(a0, 'url')?.value, line, objString(a0, 'baseURL') ?? b.base);
      }
      return;
    }
    if (FETCH_PACKAGES.has(b.pkg)) return;
    const op = [b.kind === 'named' ? b.imported : b.prefix, ...ch.path].filter(Boolean).join('.');
    if (op) result.sdk.push({ pkg: b.pkg, op, line });
  });
  return result;
}
