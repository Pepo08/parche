// Rutas y carpetas compartidas por el motor y el inventario.
import fs from 'node:fs';
import path from 'node:path';

// Carpetas que no son código del cliente: dependencias instaladas (vendor/ es donde composer instala
// las de PHP, incluida la propia librería de ARCA), builds y lo que escribe Parche.
export const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', 'dist', 'build', 'coverage', '.next', '.parche']);

// Rutas siempre con "/": van al reporte, al cuerpo del PR y al inventario.
export const toPosix = (p) => p.split(path.sep).join('/');

// Tests, mocks, fixtures y ejemplos: un PR que solo toca eso no le sirve al mantenedor, y la detección
// por texto en esos archivos es ruido (frente B, 16/10).
export function isTestFile(file) {
  return /(^|\/)(__tests__|__mocks__|tests?|specs?|mocks?|fixtures?|examples?)\//i.test(file)
    || /\.(test|spec|mock)\.[cm]?[jt]sx?$/i.test(file) || /Test\.php$/.test(file);
}

// Recorre el repo (salteando SKIP_DIRS) y devuelve las rutas relativas, con "/", de los archivos que
// cumplen `match(nombre)`.
export function findFiles(root, match) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); }
      else if (match(e.name)) out.push(toPosix(path.relative(root, path.join(dir, e.name))));
    }
  };
  walk(root);
  return out.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}
