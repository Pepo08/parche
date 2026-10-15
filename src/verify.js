// Verificación: ningún PR sale sin que el código modificado parsee y, si se pide, sin que pasen los tests.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseCheck } from './ast.js';

export function verify(root, changedFiles, { runTests = false } = {}) {
  const errors = [];
  for (const rel of changedFiles) {
    try {
      parseCheck(fs.readFileSync(path.join(root, rel), 'utf8'), rel);
    } catch (e) {
      errors.push(`${rel}: ${e.message}`);
    }
  }
  const result = { parse: { ok: errors.length === 0, errors } };
  if (runTests) {
    const pkgPath = path.join(root, 'package.json');
    const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : {};
    if (!pkg.scripts || !pkg.scripts.test) {
      result.tests = { ok: true, skipped: true };
    } else {
      // En Windows npm es npm.cmd y Node solo lo ejecuta a través de un shell.
      const r = spawnSync('npm', ['test', '--silent'], { cwd: root, encoding: 'utf8', timeout: 300000, shell: process.platform === 'win32' });
      const output = (r.stdout || '') + (r.stderr || '') + (r.error ? `\n${r.error.message}` : '');
      result.tests = { ok: r.status === 0, output: output.slice(-2000) };
    }
  }
  result.ok = result.parse.ok && (!result.tests || result.tests.ok);
  return result;
}
