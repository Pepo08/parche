// Contexto del repo para los packs: lo que un archivo solo no puede saber.
// Lo arma el motor una vez, antes de correr los packs, y cada transform lo recibe como `context`.
//
//   versions:   versión instalada de cada dependencia (de los lockfiles, de node_modules o del rango declarado;
//               en Python, solo el rango de requirements.txt). Si sale del rango, `range` trae el texto declarado.
//   fieldFiles: archivos que ya usan CondicionIVAReceptorId (el repo ya empezó a migrar)
//   staleWsdl:  WSDL de WSFEv1 del repo que no tienen CondicionIVAReceptorId
//   arcaLibs:   librerías de ARCA del repo con lo que se sabe de si el campo llega a viajar
//   nearMissTypes: interfaces y types de TypeScript que declaran la clave casi bien escrita (CondicionIvaReceptorId?: number)
import fs from 'node:fs';
import path from 'node:path';
import { parse as babelParse } from '@babel/parser';
import { findFiles } from './paths.js';
import { NEAR_HINT, isNearMissKey } from './codemods/arca-rules.js';

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};
const clean = (v) => String(v || '').replace(/^v/, '');

// Versiones instaladas por ecosistema: lockfiles (en cualquier carpeta) → node_modules de la raíz → rango declarado.
export function readVersions(root, manifests) {
  const out = { npm: {}, composer: {}, pypi: {} };
  const set = (eco, name, version, source, range) => {
    if (name && version && !out[eco][name]) out[eco][name] = { version: clean(version), source, ...(range ? { range } : {}) };
  };
  for (const rel of findFiles(root, (n) => n === 'package-lock.json' || n === 'composer.lock')) {
    const lock = readJson(path.join(root, rel));
    if (!lock) continue;
    if (rel.endsWith('composer.lock')) {
      for (const p of [...(lock.packages || []), ...(lock['packages-dev'] || [])]) set('composer', p.name, p.version, rel);
    } else {
      for (const [k, v] of Object.entries(lock.packages || {})) {
        const m = k.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)$/); // solo las de primer nivel
        if (m) set('npm', m[1], v.version, rel);
      }
      for (const [name, v] of Object.entries(lock.dependencies || {})) set('npm', name, v.version, rel); // lockfile v1
    }
  }
  for (const name of Object.keys(manifests?.npm || {})) {
    const pkg = readJson(path.join(root, 'node_modules', name, 'package.json'));
    if (pkg?.version) set('npm', name, pkg.version, 'node_modules');
  }
  for (const eco of ['npm', 'composer', 'pypi']) {
    for (const [name, range] of Object.entries(manifests?.[eco] || {})) {
      const m = String(range).match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
      if (m) set(eco, name, `${m[1]}.${m[2] || 0}.${m[3] || 0}`, 'declarada', String(range));
    }
  }
  return out;
}

// ¿Un rango declarado deja instalar versiones mayores nuevas? `>=0.40`, `>0.3`, `*`, `x` o `latest` sin tope (`<`):
// una instalación nueva trae la última versión. `^0.137.0`, `~1.2`, `==1.4.0` o `~=1.2` no.
export const openRange = (range) => /^\s*(?:>=?|\*|x|latest)/i.test(range || '') && !/</.test(range || '');

// Qué se sabe, por librería, de si CondicionIVAReceptorId llega a ARCA (verificado en su código el 16/10/2026):
//   afip.js / afip.php ≥ 1.0: mandan JSON a la API de Afip SDK → sí.
//   0.x: arman el SOAP con un WSDL de 2021 incluido en la librería, sin el campo → no (PHP) o sin confirmar (JS).
//   fertandil87/afip.php: actualizó su WSDL (lo incluye) → sí.  eesnaola/afip.php: WSDL de 2021 → igual que 0.x.
//   ts-afip-ws: fork de afip.js 0.x (frente B, punto 14: los repos de jretondo). Su última versión, la 1.3.2 de 2023,
//   trae wsfe.wsdl y wsfe-production.wsdl sin el campo (leído en el paquete de npm el 24/10/2026) → sin confirmar.
const ARCA_LIBS = {
  npm: {
    '@afipsdk/afip.js': (v) => (major(v) >= 1 ? 'si' : 'sin-confirmar'),
    'ts-afip-ws': () => 'sin-confirmar',
  },
  composer: {
    'afipsdk/afip.php': (v) => (major(v) >= 1 ? 'si' : 'no'),
    'ivanalemunioz/afip.php': (v) => (major(v) >= 1 ? 'si' : 'no'),
    'fertandil87/afip.php': () => 'si',
    'eesnaola/afip.php': () => 'no',
  },
};
const major = (v) => Number(String(v).split('.')[0]);
// Qué hacer para que el campo viaje, cuando no es "actualizar la librería a 1.x" (los forks no tienen 1.x).
const FIXES = {
  'ts-afip-ws': 'pasar a @afipsdk/afip.js 1.x o actualizar el WSDL que trae la librería',
  'eesnaola/afip.php': 'pasar a afipsdk/afip.php 1.x o actualizar el WSDL que trae la librería',
};

export function arcaLibraries(versions) {
  const out = [];
  for (const [eco, libs] of Object.entries(ARCA_LIBS)) {
    for (const [name, rule] of Object.entries(libs)) {
      const v = versions[eco]?.[name];
      if (v) out.push({ ecosystem: eco, name, version: v.version, source: v.source, travels: rule(v.version), ...(FIXES[name] ? { fix: FIXES[name] } : {}) });
    }
  }
  return out;
}

// files: rutas relativas (con "/") de los archivos que el motor va a recorrer.
export function buildContext(root, files, manifests) {
  const versions = readVersions(root, manifests);
  const fieldFiles = [];
  for (const rel of files) {
    try {
      if (fs.readFileSync(path.join(root, rel), 'utf8').includes('CondicionIVAReceptorId')) fieldFiles.push(rel);
    } catch { /* archivo ilegible: lo reporta el pack que lo lea */ }
  }
  const staleWsdl = findFiles(root, (n) => /\.wsdl$/i.test(n)).filter((rel) => {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    return /FECAESolicitar|FECAEDetRequest/.test(text) && !text.includes('CondicionIVAReceptorId');
  });
  return { versions, fieldFiles, staleWsdl, arcaLibs: arcaLibraries(versions), nearMissTypes: nearMissTypes(root, files) };
}

// Frente B, punto 23: si un tipo declara la clave mal escrita, renombrarla solo en el objeto rompe el tipado
// (TS2353) y el chequeo de sintaxis no lo ve. El codemod de JS no renombra cuando la encuentra acá.
export function nearMissTypes(root, files) {
  const out = [];
  for (const rel of files.filter((f) => /\.[cm]?tsx?$/.test(f))) {
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    if (!NEAR_HINT.test(text)) continue;
    let ast;
    try {
      ast = babelParse(text, { sourceType: 'unambiguous', plugins: ['typescript', 'decorators-legacy', ...(/x$/.test(rel) ? ['jsx'] : [])], errorRecovery: true });
    } catch { continue; }
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.type === 'TSPropertySignature') {
        const key = n.key && (n.key.type === 'Identifier' ? n.key.name : n.key.type === 'StringLiteral' ? n.key.value : null);
        if (isNearMissKey(key)) out.push({ file: rel, line: n.loc.start.line, key });
      }
      for (const k of Object.keys(n)) if (k !== 'loc' && k !== 'start' && k !== 'end') walk(n[k]);
    };
    walk(ast.program);
  }
  return out;
}

export const emptyContext = () => ({ versions: { npm: {}, composer: {}, pypi: {} }, fieldFiles: [], staleWsdl: [], arcaLibs: [], nearMissTypes: [] });
