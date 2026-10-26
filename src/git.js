import { execFileSync } from 'node:child_process';

// En Windows, sin core.longpaths, git ve modificado un archivo con ruta de más de 260 caracteres, y `parche pr`
// frenaba con "Hay cambios sin commitear" en un clon recién hecho (frente B, punto 20).
export const gitArgs = (args, platform = process.platform) => (platform === 'win32' ? ['-c', 'core.longpaths=true', ...args] : args);
const git = (cwd, ...args) => execFileSync('git', gitArgs(args), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function isRepo(cwd) {
  try {
    return git(cwd, 'rev-parse', '--is-inside-work-tree') === 'true';
  } catch {
    return false;
  }
}

export function currentBranch(cwd) {
  return git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
}

// `.parche/` es lo que Parche escribe en cada corrida (reportes, inventario, registro, cuerpos de PR). No cuenta para
// "repo limpio" y nunca entra en un PR, aunque alguien lo haya commiteado: pasó copiando una carpeta ya escaneada a un
// repo nuevo, y `scan` lo modificaba y `pr` frenaba con "Hay cambios sin commitear". Todo el repo (`:/`) menos
// `.parche/` de la carpeta que se revisa (las rutas de exclusión son relativas a `cwd`, que es donde vive `.parche/`).
const OUTSIDE_PARCHE = ['--', ':/', ':(exclude).parche'];

export function isClean(cwd) {
  return git(cwd, 'status', '--porcelain', ...OUTSIDE_PARCHE) === '';
}

// ¿`.parche/` está commiteado? Solo para avisarlo: Parche funciona igual.
export function tracksParcheDir(cwd) {
  return git(cwd, 'ls-files', '--', '.parche') !== '';
}

export function checkoutNewBranch(cwd, name, base) {
  try {
    git(cwd, 'checkout', base);
    git(cwd, 'branch', '-D', name);
  } catch { /* la rama no existía */ }
  git(cwd, 'checkout', '-b', name);
}

// Quién firma los commits de Parche. Nunca una dirección de un dominio que no controlamos: antes era
// bot@parche.dev, y parche.dev lo tiene registrado otra persona. En orden:
// 1. PARCHE_GIT_NAME y PARCHE_GIT_EMAIL, si están.
// 2. La identidad de git de quien lo corre (en su compu, o la que configuró su workflow).
// 3. En GitHub Actions sin identidad: el bot de Actions, el mismo que abre el PR con el GITHUB_TOKEN.
// Si no hay ninguna, error: no se inventa un autor.
export const ACTIONS_BOT = { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' };

export function commitIdentity(cwd, env = process.env) {
  if (env.PARCHE_GIT_NAME && env.PARCHE_GIT_EMAIL) return { name: env.PARCHE_GIT_NAME, email: env.PARCHE_GIT_EMAIL };
  const get = (key) => {
    try {
      return execFileSync('git', ['config', key], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch { return ''; }
  };
  const name = get('user.name');
  const email = get('user.email');
  if (name && email) return { name, email };
  if (env.GITHUB_ACTIONS === 'true') return ACTIONS_BOT;
  throw new Error('No hay una identidad de git para firmar el commit: configurá `git config user.name` y `git config user.email`, o PARCHE_GIT_NAME y PARCHE_GIT_EMAIL.');
}

// --author "Nombre <email>": quién firma, sin tocar la configuración de git de la máquina (frente B, punto 20:
// la identidad global de la compu era otra persona con un mail personal).
export function parseAuthor(text) {
  const m = /^\s*(.+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(typeof text === 'string' ? text : '');
  if (!m) throw new Error('--author tiene que ser "Nombre <email>", por ejemplo --author "Ana Pérez <ana@users.noreply.github.com>".');
  return { PARCHE_GIT_NAME: m[1], PARCHE_GIT_EMAIL: m[2] };
}

// El email del commit queda público en el PR: si no es un noreply de GitHub, `parche pr` avisa antes de pushear.
export const isNoreply = (email) => /@users\.noreply\.github\.com$/i.test(email || '');

export function commitAll(cwd, message, env = process.env) {
  const id = commitIdentity(cwd, env);
  git(cwd, 'add', '-A');
  // `.parche/` nunca entra en el commit. Si no está commiteado, `add` ya no lo toma (está en .git/info/exclude); si lo
  // está, se saca del índice lo que `add` tomó de ahí. No va como pathspec de exclusión en `add`: git sale con error
  // cuando una pathspec nombra una carpeta ignorada, aunque sea para excluirla.
  if (tracksParcheDir(cwd)) git(cwd, 'reset', '-q', 'HEAD', '--', '.parche');
  git(cwd, '-c', `user.name=${id.name}`, '-c', `user.email=${id.email}`, 'commit', '-q', '-m', message);
  return git(cwd, 'rev-parse', '--short', 'HEAD');
}

export function checkout(cwd, branch) {
  git(cwd, 'checkout', '-q', branch);
}

export function remoteUrl(cwd, remote = 'origin') {
  try {
    return git(cwd, 'remote', 'get-url', remote);
  } catch {
    return null;
  }
}

export const originUrl = (cwd) => remoteUrl(cwd, 'origin');

// Con `--force`: reemplaza el commit anterior de Parche en su rama. Quien llama se fija antes que la rama remota no
// tenga commits de otra persona (src/publish.js, P9).
export function push(cwd, branch, remote = 'origin') {
  git(cwd, 'push', '-u', '--force', remote, branch);
}

// El commit de la rama `branch` en `remote`, o null si no existe. No toca las ramas locales.
export function fetchBranch(cwd, remote, branch) {
  try {
    git(cwd, 'fetch', '-q', '--no-tags', remote, `refs/heads/${branch}`);
    return git(cwd, 'rev-parse', 'FETCH_HEAD');
  } catch {
    return null;
  }
}

// Los commits de `to` que no están en `from`, con su mensaje completo.
export function commitsBetween(cwd, from, to) {
  return git(cwd, 'log', '--format=%H%x00%B%x1e', `${from}..${to}`)
    .split('\x1e').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [sha, ...rest] = s.split('\0'); return { sha, message: rest.join('\0').trim() }; });
}

// Un identificador del cambio que hace `to` desde donde se separó de `from`, sin contar números de línea ni espacios
// (`git patch-id`). Dos ramas con el mismo arreglo sobre bases distintas dan el mismo; sin cambios, ''.
export function patchId(cwd, from, to) {
  const diff = execFileSync('git', gitArgs(['diff', `${from}...${to}`]), { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (!diff.trim()) return '';
  return execFileSync('git', gitArgs(['patch-id', '--stable']), { cwd, input: diff, encoding: 'utf8' }).trim().split(/\s+/)[0] || '';
}

// Descarta lo que Parche escribió en su rama (el árbol estaba limpio antes de empezar). Antes era `reset --hard`, que
// con un `.parche/` commiteado también borraba el registro de esta corrida; los codemods solo modifican archivos que
// ya existen, así que alcanza con volver todo, menos `.parche/`, a lo que hay en HEAD.
export function discardChanges(cwd) {
  git(cwd, 'checkout', '-q', 'HEAD', ...OUTSIDE_PARCHE);
}

export function deleteBranch(cwd, name) {
  try {
    git(cwd, 'branch', '-D', name);
  } catch { /* ya no existía */ }
}
