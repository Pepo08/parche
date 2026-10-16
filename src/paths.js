// Rutas y carpetas compartidas por el motor y el inventario.
import path from 'node:path';

// Carpetas que no son código del cliente: dependencias instaladas (vendor/ es donde composer instala
// las de PHP, incluida la propia librería de ARCA), builds y lo que escribe Parche.
export const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', 'dist', 'build', 'coverage', '.next', '.parche']);

// Rutas siempre con "/": van al reporte, al cuerpo del PR y al inventario.
export const toPosix = (p) => p.split(path.sep).join('/');
