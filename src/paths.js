// Rutas y carpetas compartidas por el motor y el inventario.
import fs from 'node:fs';
import path from 'node:path';

// Carpetas que no son código del cliente: dependencias instaladas (vendor/ es donde composer instala
// las de PHP, incluida la propia librería de ARCA), builds y lo que escribe Parche.
export const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', 'dist', 'build', 'coverage', '.next', '.parche']);

// Rutas siempre con "/": van al reporte, al cuerpo del PR y al inventario.
export const toPosix = (p) => p.split(path.sep).join('/');

// Scripts sueltos para probar a mano (probar-arca.js, prueba.php, test-afip.js, ejemplo-factura.js): no son el
// código que corre. Un PR que solo toca eso se lee como ruido aunque el cuerpo lo diga (Elitali1/proyectoPaginaWeb,
// PR #16, cerrado por el mantenedor el 5/11: "El sistema ya informa CondicionIVAReceptorId según el receptor").
// Va por el nombre del archivo, sin la extensión: "probar", "probando", "prueba(s)", "testear" y "ejemplo(s)", solos o
// seguidos de - _ o .; "test", "demo", "scratch" y "playground", solo con guion. Así "test_data.js", "testimonios.js",
// "contest.js" y "demo.js" siguen siendo código.
const PROBE_STEM = /^(probar|probando|prueba|pruebas|testear|ejemplo|ejemplos)([-_.].*)?$|^(test|demo|scratch|playground)-.+$/i;
export function isProbeScript(file) {
  return PROBE_STEM.test(file.split('/').pop().replace(/\.[^.]+$/, ''));
}

// Tests, mocks, fixtures, ejemplos y scripts de prueba: un PR que solo toca eso no le sirve al mantenedor, y la
// detección por texto en esos archivos es ruido (frente B, 16/10). También en los lenguajes de solo detección
// (x_test.go, test_x.py, XTests.cs, proyecto.Tests/) y los helpers de tests (x.test.helpers.ts, frente B, punto 24).
export function isTestFile(file) {
  return /(^|\/)(__tests__|__mocks__|tests?|specs?|mocks?|fixtures?|examples?)\//i.test(file)
    || /(^|\/)[^/]*\.tests?\//i.test(file)
    || /\.(test|spec|mock)(\.[\w-]+)*\.[cm]?[jt]sx?$/i.test(file)
    || /Tests?\.(php|cs|java|vb)$/.test(file)
    || /_test\.(go|py)$/.test(file) || /(^|\/)test_[^/]*\.py$/.test(file)
    || isProbeScript(file);
}

// Copias de respaldo: no es el código que corre. Un PR sobre BAK/ o sobre "factura copy.php" no le sirve al
// mantenedor (frente B, 17/10: axel-tecnosoul/facturador ya usaba el campo en los archivos vigentes).
// Carpetas BAK, backup(s), old, _old y deprecated; archivos "x copy.php", "x - Copy.js", "x copia.php",
// "x.bak.php", "x-old.js", "x_old.php" y "x.old.php". No cuentan "deep_copy.js" ni "gold.js".
const BACKUP_DIR = /^(bak|backups?|old|_old|deprecated)$/i;
export const isBackupDir = (name) => BACKUP_DIR.test(name);
export function isBackupFile(name) {
  return /\s(-\s)?(copy|copia)(\s\(?\d+\)?)?\.[^.]+$/i.test(name) || /\.bak\.[^.]+$/i.test(name) || /[-_.]old\.[^.]+$/i.test(name);
}

// Recorre el repo (salteando SKIP_DIRS y las copias de respaldo) y devuelve las rutas relativas, con "/",
// de los archivos que cumplen `match(nombre)`. Lo salteado por ser respaldo va a `skipped`, si se pasa.
export function findFiles(root, match, skipped = null) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = () => toPosix(path.relative(root, path.join(dir, e.name)));
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (isBackupDir(e.name)) { skipped?.push(`${rel()}/`); continue; }
        walk(path.join(dir, e.name));
      } else if (match(e.name)) {
        if (isBackupFile(e.name)) skipped?.push(rel());
        else out.push(rel());
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}
