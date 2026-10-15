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

export function commitAll(cwd, message) {
  git(cwd, 'add', '-A');
  git(cwd, '-c', 'user.name=Parche', '-c', 'user.email=bot@parche.dev', 'commit', '-q', '-m', message);
  return git(cwd, 'rev-parse', '--short', 'HEAD');
}

export function checkout(cwd, branch) {
  git(cwd, 'checkout', '-q', branch);
}

export function originUrl(cwd) {
  try {
    return git(cwd, 'remote', 'get-url', 'origin');
  } catch {
    return null;
  }
}

export function push(cwd, branch) {
  git(cwd, 'push', '-u', '--force', 'origin', branch);
}
