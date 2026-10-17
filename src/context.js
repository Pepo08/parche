// Contexto del repo para los packs: lo que un archivo solo no puede saber.
// Lo arma el motor una vez, antes de correr los packs, y cada transform lo recibe como `context`.
//
//   versions:   versión instalada de cada dependencia (de los lockfiles, de node_modules o del rango declarado)
//   fieldFiles: archivos que ya usan CondicionIVAReceptorId (el repo ya empezó a migrar)
//   staleWsdl:  WSDL de WSFEv1 del repo que no tienen CondicionIVAReceptorId
//   arcaLibs:   librerías de ARCA del repo con lo que se sabe de si el campo llega a viajar
import fs from 'node:fs';
import path from 'node:path';
import { findFiles } from './paths.js';

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
  const out = { npm: {}, composer: {} };
  const set = (eco, name, version, source) => { if (name && version && !out[eco][name]) out[eco][name] = { version: clean(version), source }; };
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
  for (const eco of ['npm', 'composer']) {
    for (const [name, range] of Object.entries(manifests?.[eco] || {})) {
      const m = String(range).match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
      if (m) set(eco, name, `${m[1]}.${m[2] || 0}.${m[3] || 0}`, 'declarada');
    }
  }
  return out;
}

// Qué se sabe, por librería, de si CondicionIVAReceptorId llega a ARCA (verificado en su código el 16/10/2026):
//   afip.js / afip.php ≥ 1.0: mandan JSON a la API de Afip SDK → sí.
//   0.x: arman el SOAP con un WSDL de 2021 incluido en la librería, sin el campo → no (PHP) o sin confirmar (JS).
//   fertandil87/afip.php: actualizó su WSDL (lo incluye) → sí.  eesnaola/afip.php: WSDL de 2021 → igual que 0.x.
const ARCA_LIBS = {
  npm: { '@afipsdk/afip.js': (v) => (major(v) >= 1 ? 'si' : 'sin-confirmar') },
  composer: {
    'afipsdk/afip.php': (v) => (major(v) >= 1 ? 'si' : 'no'),
    'ivanalemunioz/afip.php': (v) => (major(v) >= 1 ? 'si' : 'no'),
    'fertandil87/afip.php': () => 'si',
    'eesnaola/afip.php': () => 'no',
  },
};
const major = (v) => Number(String(v).split('.')[0]);

export function arcaLibraries(versions) {
  const out = [];
  for (const [eco, libs] of Object.entries(ARCA_LIBS)) {
    for (const [name, rule] of Object.entries(libs)) {
      const v = versions[eco]?.[name];
      if (v) out.push({ ecosystem: eco, name, version: v.version, source: v.source, travels: rule(v.version) });
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
  return { versions, fieldFiles, staleWsdl, arcaLibs: arcaLibraries(versions) };
}

export const emptyContext = () => ({ versions: { npm: {}, composer: {} }, fieldFiles: [], staleWsdl: [], arcaLibs: [] });
