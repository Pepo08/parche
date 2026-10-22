# Security

## Reporting a vulnerability

Please don't open a public issue. Report it privately:

- GitHub: **Security → Report a vulnerability** in this repository, or
- email **hola@getparche.com** with "Security" in the subject.

You'll get a first answer within **14 days** (usually much sooner). If the report is confirmed, the fix ships in a new release and the advisory credits you unless you'd rather stay anonymous.

Supported versions: the latest 0.x release (`npm view parche-cli version`), which is also what `Pepo08/parche@v0` points to.

## What Parche does on your machine or runner

| | |
|---|---|
| **Network** | `scan`, `fix` and `packs` make no network calls. `parche pr` calls `api.github.com` to open the PR in your own repository and pushes its branch `parche/<pack>` to your remote (with `--force`, so it only ever replaces its own previous PR). `parche diff` and `scan --upgrades` download package metadata and tarballs from `registry.npmjs.org`, so the registry sees which packages and versions you check. Nothing else. |
| **Telemetry** | None. Parche doesn't send usage data, code, paths or repository names anywhere. `parche feedback` writes to `.parche/ledger.jsonl` in your repository and stays there. |
| **Code it runs** | `git`, and, only with `--verify`, your repository's own test command (`npm test`, `composer test` or `vendor/bin/phpunit`). Without `--verify` it doesn't execute anything from your repository: it only parses the files it changed. |
| **Files it writes** | Your working copy (only `fix` and `pr`), `.parche/` (reports, inventory, PR bodies; added to `.git/info/exclude`) and, for `diff` / `--upgrades`, a cache in `~/.parche/cache` (`PARCHE_CACHE` to move it). |
| **Tokens** | `GITHUB_TOKEN`, only for `parche pr`, to call `api.github.com`; it isn't sent anywhere else. The push uses the git credentials already set up (in GitHub Actions, the ones `actions/checkout` leaves). |

## Using the GitHub Action safely

- The workflow template asks for read-only permissions by default and grants `contents: write` and `pull-requests: write` only to the Parche job.
- `Pepo08/parche@v0` moves with every 0.x release. If your organization requires pinned actions, use the commit of a release instead (`Pepo08/parche@<sha> # v0.6.7`); the commits are listed in [Releases](https://github.com/Pepo08/parche/releases).
- Releases are published from GitHub Actions with npm trusted publishing and provenance: no long-lived npm token exists for this package.

---

## En castellano

**Cómo reportar una vulnerabilidad:** no abras un issue público. Usá **Security → Report a vulnerability** en este repo o escribí a **hola@getparche.com** con "Security" en el asunto. La primera respuesta llega en **14 días como máximo**. Si se confirma, el arreglo sale en un release nuevo y el aviso te menciona, salvo que prefieras quedar anónimo. Se mantiene la última versión 0.x, que es la que usa `Pepo08/parche@v0`.

**Qué hace Parche en tu máquina o en tu runner:** lo de la tabla de arriba. En corto: `scan` y `fix` no usan la red; `pr` habla solo con `api.github.com` y pushea solo su rama `parche/<pack>`; `diff` y `--upgrades` bajan paquetes de `registry.npmjs.org`. No hay telemetría. Solo ejecuta tus tests si le pasás `--verify`.
