// Verificación: ningún PR sale sin que el código modificado parsee y, si se pide, sin que pasen los tests.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseCheck } from './ast.js';
import { isPhp } from './php.js';

const readJson = (root, name) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  } catch {
    return null;
  }
};

// Tests que corresponden a los archivos modificados: `npm test` para JS/TS; para PHP,
// `composer test` o, si no hay script, vendor/bin/phpunit. Si no hay ninguno, queda el chequeo de sintaxis.
export function testCommands(root, changedFiles) {
  const cmds = [];
  const pkg = readJson(root, 'package.json');
  if (changedFiles.some((f) => !isPhp(f)) && pkg?.scripts?.test) {
    cmds.push({ label: 'npm test', cmd: 'npm', args: ['test', '--silent'] });
  }
  if (changedFiles.some(isPhp)) {
    const composer = readJson(root, 'composer.json');
    if (composer?.scripts?.test) cmds.push({ label: 'composer test', cmd: 'composer', args: ['test'] });
    else if (fs.existsSync(path.join(root, 'vendor', 'bin', 'phpunit'))) {
      cmds.push({ label: 'vendor/bin/phpunit', cmd: path.join('vendor', 'bin', 'phpunit'), args: [] });
    }
  }
  return cmds;
}

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
    const cmds = testCommands(root, changedFiles);
    if (!cmds.length) {
      result.tests = { ok: true, skipped: true, commands: [] };
    } else {
      let ok = true;
      let output = '';
      for (const c of cmds) {
        // En Windows npm, composer y phpunit son .cmd/.bat y Node solo los ejecuta a través de un shell.
        const r = spawnSync(c.cmd, c.args, { cwd: root, encoding: 'utf8', timeout: 300000, shell: process.platform === 'win32' });
        output += `$ ${c.label}\n${r.stdout || ''}${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}\n`;
        if (r.status !== 0) { ok = false; break; }
      }
      result.tests = { ok, commands: cmds.map((c) => c.label), output: output.slice(-2000) };
    }
  }
  result.ok = result.parse.ok && (!result.tests || result.tests.ok);
  return result;
}
