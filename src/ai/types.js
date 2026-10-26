// Chequeo de tipos de los archivos de un aviso contra los tipos de la versión nueva de un SDK (nivel 2, 0.9.0). Todo en
// memoria, con el TypeScript que ya trae Parche y los .d.ts que baja `scan --upgrades` del registry: no instala nada, no
// lee node_modules y no ejecuta código del repo. Los archivos JS se chequean con `checkJs`, así que una llamada a algo
// que el SDK nuevo ya no tiene sale como error aunque el repo no use TypeScript.
import path from 'node:path';
import ts from 'typescript';

const ROOT = '/__repo__/';
const TYPES = '/__tipos__/';
// Lo que no dice nada del SDK: módulos que no están en memoria (otros archivos del repo, otras dependencias) y los
// globales de Node sin @types/node.
const IGNORED = new Set([2307, 7016, 2580, 2591, 2584, 2503, 2792]);
// `const OpenAI = require('openai'); new OpenAI()`: anda en Node (el build CommonJS exporta la clase), pero con tipos
// que dicen `export default` TypeScript ve el módulo entero y dice "not constructable" o "not callable". Visto el
// 26/10/2026 con openai 7.43.0. Ese error, sobre el módulo del propio SDK, no cuenta; un error de verdad ahí solo lo
// atrapan los tests.
const interop = (d, message) => (d.code === 2351 || d.code === 2349) && message.includes(`typeof import("${TYPES}`);

const norm = (f) => f.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');

// files: { 'src/a.js': texto }; pkg: el paquete; types: { files: Map(ruta → texto), entry } de registry.types().
// → { 'src/a.js': [{ code, line, message }] }
// Si los tipos del SDK tienen un `export default`, `const X = require('pkg')` se chequea como `require('pkg').default`
// (en la misma línea: no cambian los números). Sin esto, X queda como el módulo entero, `new X()` es `any` y nada de lo
// que sigue se chequea.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
export function withDefaultRequire(text, pkg, types) {
  const entry = types.files.get(types.entry) || '';
  if (!/\bexport\s+default\b|\bas\s+default\b/.test(entry)) return text;
  return text.replace(new RegExp(`(\\b(?:const|let|var)\\s+[A-Za-z_$][\\w$]*\\s*=\\s*require\\(\\s*(['"])${escape(pkg)}\\2\\s*\\))(?!\\s*\\.)`, 'g'), '$1.default');
}

export function typeCheck({ files, pkg, types }) {
  const virtual = new Map();
  for (const [rel, text] of Object.entries(files)) virtual.set(ROOT + rel, withDefaultRequire(text, pkg, types));
  const base = `${TYPES}${pkg}/`;
  for (const [rel, text] of types.files) virtual.set(base + rel, text);
  const options = {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    // TypeScript 6 prende `strict` por defecto: acá solo interesa lo que cambia con el SDK, no el estilo del repo.
    strict: false,
    noImplicitAny: false,
    skipLibCheck: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: [],
    paths: { [pkg]: [base + types.entry], [`${pkg}/*`]: [`${base}*`] },
  };
  const real = ts.createCompilerHost(options, true);
  const libDir = norm(path.dirname(ts.getDefaultLibFilePath(options)));
  const isLib = (f) => norm(f).startsWith(`${libDir}/`);
  const read = (f) => virtual.get(norm(f)) ?? (isLib(f) ? real.readFile(f) : undefined);
  const host = {
    ...real,
    getCurrentDirectory: () => ROOT,
    fileExists: (f) => virtual.has(norm(f)) || (isLib(f) && real.fileExists(f)),
    readFile: read,
    directoryExists: (d) => {
      const dir = `${norm(d).replace(/\/$/, '')}/`;
      return [...virtual.keys()].some((k) => k.startsWith(dir)) || (isLib(d) && real.directoryExists(d));
    },
    getSourceFile: (f, languageVersion) => {
      const text = read(f);
      return text === undefined ? undefined : ts.createSourceFile(f, text, languageVersion, true);
    },
    writeFile: () => {},
  };
  const program = ts.createProgram(Object.keys(files).map((rel) => ROOT + rel), options, host);
  const out = {};
  for (const rel of Object.keys(files)) {
    const sf = program.getSourceFile(ROOT + rel);
    const diags = sf ? [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)] : [];
    out[rel] = diags.filter((d) => !IGNORED.has(d.code)).map((d) => ({
      code: d.code,
      line: d.start === undefined ? null : sf.getLineAndCharacterOfPosition(d.start).line + 1,
      message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
    })).filter((d) => !interop(d, d.message));
  }
  return out;
}
