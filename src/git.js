import { execFileSync } from 'node:child_process';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

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

export function isClean(cwd) {
  return git(cwd, 'status', '--porcelain') === '';
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

export function commitAll(cwd, message, env = process.env) {
  const id = commitIdentity(cwd, env);
  git(cwd, 'add', '-A');
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

export function push(cwd, branch, remote = 'origin') {
  git(cwd, 'push', '-u', '--force', remote, branch);
}

// Descarta lo que Parche escribió en su rama (el árbol estaba limpio antes de empezar; .parche/ está excluido).
export function discardChanges(cwd) {
  git(cwd, 'reset', '--hard', '-q');
}

export function deleteBranch(cwd, name) {
  try {
    git(cwd, 'branch', '-D', name);
  } catch { /* ya no existía */ }
}
