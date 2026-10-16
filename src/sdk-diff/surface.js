// Superficie pública de una versión de un SDK, leída de sus .d.ts con el compiler API de TypeScript.
//
// Devuelve dos mapas de ruta → entrada, con la misma forma que las operaciones del inventario (hito B):
//   default: miembros de la instancia del export por defecto  → "chat.completions.create"
//   exports: exports con nombre y sus miembros                 → "OpenAIApi.createChatCompletion"
// Cada entrada: { kind, deprecated (texto o null), signatures: [{ params: [{ name, optional, rest, type }] }] }.
//
// TypeScript (24 MB) se carga recién acá, para que `parche scan` común no lo pague.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let tsModule = null;
const loadTs = () => (tsModule ||= require('typescript'));

const MAX_PROPS = 400;
const TYPE_MAX = 400;

export function extractSurface({ files, entry, pkgName, maxDepth = 4 }) {
  const ts = loadTs();
  const options = {
    noEmit: true, skipLibCheck: true, types: [], strict: false,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  };
  // Sistema de archivos virtual: el paquete vive en /node_modules/<pkg>/; las libs de TypeScript, en disco.
  const base = `/node_modules/${pkgName}/`;
  const virtual = new Map([...files].map(([p, c]) => [base + p, c]));
  const norm = (f) => f.replace(/\\/g, '/');
  const libDir = norm(path.dirname(ts.getDefaultLibFilePath(options)));
  const isLib = (f) => norm(f).startsWith(libDir);
  const dirs = new Set();
  for (const p of virtual.keys()) for (let d = path.posix.dirname(p); d !== '/'; d = path.posix.dirname(d)) dirs.add(d);
  const host = {
    fileExists: (f) => virtual.has(norm(f)) || (isLib(f) && fs.existsSync(f)),
    readFile: (f) => virtual.get(norm(f)) ?? (isLib(f) && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined),
    getSourceFile: (f, lang) => {
      const text = host.readFile(f);
      return text === undefined ? undefined : ts.createSourceFile(f, text, lang, true);
    },
    directoryExists: (d) => dirs.has(norm(d).replace(/\/$/, '')) || isLib(d),
    getDirectories: () => [],
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    writeFile: () => {},
  };
  const entryPath = base + entry;
  const program = ts.createProgram({ rootNames: [entryPath], options, host });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(entryPath);
  const surface = { default: new Map(), exports: new Map() };
  if (!sf) return surface;

  // El módulo: el archivo de entrada o, si declara `declare module 'pkg' { ... }`, ese módulo ambiental.
  let mod = checker.getSymbolAtLocation(sf);
  if (!mod) mod = checker.getAmbientModules().find((m) => m.name.replace(/^["']|["']$/g, '') === pkgName);
  if (!mod) return surface;

  const resolve = (sym) => (sym && sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym);
  const declOf = (sym) => sym.valueDeclaration || (sym.declarations && sym.declarations[0]);
  const typeStr = (type) => checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation).replace(/\s+/g, ' ').slice(0, TYPE_MAX);
  const deprecatedOf = (sym) => {
    const tag = sym.getJsDocTags(checker).find((t) => t.name === 'deprecated');
    return tag ? (ts.displayPartsToString(tag.text) || 'deprecado').trim() : null;
  };
  const isHidden = (sym) => {
    const name = sym.getName();
    if (name.startsWith('#') || name.startsWith('_') || name.startsWith('__@')) return true;
    const d = declOf(sym);
    return !!(d && ts.getCombinedModifierFlags(d) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected));
  };
  const signaturesOf = (sigs) => sigs.map((sig) => ({
    params: sig.getParameters().map((p) => {
      const d = p.valueDeclaration;
      const rest = !!(d && d.dotDotDotToken);
      const optional = rest || !!(d && (d.questionToken || d.initializer)) || (d && ts.isParameter(d) && checker.isOptionalParameter(d));
      return { name: p.getName(), optional: !!optional, rest, type: d ? typeStr(checker.getTypeOfSymbolAtLocation(p, d)) : 'any' };
    }),
  }));
  // Tipos de la librería estándar (Promise, Array, Map...): no son parte del SDK, no se baja por ellos.
  const isLibType = (type) => {
    const s = type.aliasSymbol || type.getSymbol();
    const decls = s && s.declarations;
    return !!(decls && decls.length && decls.every((d) => isLib(d.getSourceFile().fileName)));
  };
  // ¿Es un "recurso"? Tiene métodos, o propiedades que a su vez tienen métodos (openai.chat → chat.completions.create).
  const hasMethods = (type, depth = 2) => {
    if (isLibType(type)) return false;
    const props = checker.getPropertiesOfType(type);
    if (props.length > MAX_PROPS) return false;
    return props.some((p) => {
      if (isHidden(p)) return false;
      const d = declOf(p);
      if (!d) return false;
      const t = checker.getTypeOfSymbolAtLocation(p, d);
      if (t.getCallSignatures().length > 0) return true;
      return depth > 1 && !!(t.flags & ts.TypeFlags.Object) && hasMethods(t, depth - 1);
    });
  };

  // Miembros de un tipo (recursivo en "recursos": objetos que a su vez tienen métodos).
  function addMembers(map, prefix, type, depth, stack) {
    if (depth > maxDepth || stack.has(type)) return;
    const props = checker.getPropertiesOfType(type);
    if (props.length > MAX_PROPS) return;
    stack.add(type);
    for (const p of props) {
      if (isHidden(p)) continue;
      const d = declOf(p);
      if (!d) continue;
      const pathName = prefix ? `${prefix}.${p.getName()}` : p.getName();
      const pType = checker.getTypeOfSymbolAtLocation(p, d);
      const sigs = pType.getCallSignatures();
      if (sigs.length) map.set(pathName, { kind: 'method', deprecated: deprecatedOf(p), signatures: signaturesOf(sigs) });
      else map.set(pathName, { kind: 'property', deprecated: deprecatedOf(p) });
      // Recursos (también los invocables, como client.messages(sid) que además tiene messages.create).
      if (pType.flags & ts.TypeFlags.Object && hasMethods(pType)) addMembers(map, pathName, pType, depth + 1, stack);
    }
    stack.delete(type);
  }

  // Un símbolo exportado: clase (sus miembros de instancia), función, u objeto/namespace con miembros.
  function addSymbol(map, prefix, rawSym) {
    const sym = resolve(rawSym);
    if (!sym) return;
    const d = declOf(sym);
    if (sym.flags & ts.SymbolFlags.Class) {
      if (prefix) map.set(prefix, { kind: 'class', deprecated: deprecatedOf(sym) });
      addMembers(map, prefix, checker.getDeclaredTypeOfSymbol(sym), 1, new Set());
      return;
    }
    if (!d || !(sym.flags & ts.SymbolFlags.Value)) return; // solo tipos: no se pueden llamar
    const type = checker.getTypeOfSymbolAtLocation(sym, d);
    const sigs = type.getCallSignatures();
    if (sigs.length && prefix) map.set(prefix, { kind: 'function', deprecated: deprecatedOf(sym), signatures: signaturesOf(sigs) });
    else if (prefix) map.set(prefix, { kind: 'property', deprecated: deprecatedOf(sym) });
    if (type.flags & ts.TypeFlags.Object && hasMethods(type)) addMembers(map, prefix, type, 1, new Set());
    // Fábricas: const client = twilio(sid, token) → los miembros del cliente que devuelve, en la misma ruta.
    for (const sig of sigs.slice(0, 1)) {
      const ret = checker.getReturnTypeOfSignature(sig);
      if (ret.flags & ts.TypeFlags.Object && hasMethods(ret)) addMembers(map, prefix, ret, 1, new Set());
    }
  }

  const exported = checker.getExportsOfModule(mod);
  for (const sym of exported) {
    const name = sym.getName();
    if (name === 'default') continue;
    addSymbol(surface.exports, name, sym);
  }
  // Export por defecto: `export default X` o `export = X` (CommonJS).
  const defaultSym = exported.find((s) => s.getName() === 'default')
    || (mod.exports && mod.exports.get('export=') ? checker.resolveExternalModuleSymbol(mod) : null);
  if (defaultSym && defaultSym !== mod) addSymbol(surface.default, '', defaultSym);
  return surface;
}
