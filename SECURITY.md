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
| **Network** | `scan`, `fix` and `packs` make no network calls. `parche pr` calls `api.github.com` to find, open or update the PR in your own repository and pushes its branch `parche/<pack>` to your remote. It force-pushes that branch only when every commit on it is Parche's own: if someone else pushed to it, Parche leaves the branch and its PR alone and says so in the run. `parche diff` and `scan --upgrades` download package metadata and tarballs from `registry.npmjs.org`, so the registry sees which packages and versions you check. In GitHub Actions, `parche summary` (the Action's weekly summary step) calls `api.github.com` to list your repository's snapshot artifacts and its Parche PRs, and downloads the previous snapshot from the storage URL GitHub redirects to (without the token). Nothing else: the summary isn't emailed or sent anywhere. |
| **AI fixes (experimental, off by default)** | Only when you run `parche ai-upgrade` (in the Action, `ai-upgrades: 'true'`): for each npm SDK whose latest version changes calls your code uses, Parche sends to the Anthropic API (`api.anthropic.com`, with **your** `ANTHROPIC_API_KEY`) the package name, both versions, the list of API changes Parche computed from their type definitions, and the full content of the files where those calls are. Nothing else from your repository. The model only returns text (a diff) and can't run anything. Parche never sends code that its invoicing or payments packs flag, or from SDKs in those categories. Anthropic's handling of that data is governed by your agreement with Anthropic. |
| **Telemetry** | None. Parche doesn't send usage data, code, paths or repository names anywhere. `parche feedback` writes to `.parche/ledger.jsonl` in your repository and stays there. |
| **Code it runs** | `git`, and, only with `--verify`, your repository's own test command (`npm test`, `composer test` or `vendor/bin/phpunit`). Without `--verify` it doesn't execute anything from your repository: it only parses the files it changed. `parche ai-upgrade` also runs `npm install --package-lock-only --ignore-scripts` to update the lockfile and, only with `--verify`, `npm install --ignore-scripts` before your tests: never your dependencies' install scripts. Its type check runs in memory with Parche's own TypeScript and the SDK's published type definitions. |
| **Files it writes** | Your working copy (only `fix` and `pr`), `.parche/` (reports, inventory, PR bodies; added to `.git/info/exclude`) and, for `diff` / `--upgrades`, a cache in `~/.parche/cache` (`PARCHE_CACHE` to move it). In GitHub Actions, `pr` also appends a summary to the job's `$GITHUB_STEP_SUMMARY` and prints warning annotations, and the Action saves a snapshot of the run as a workflow artifact (`parche` by default): `scan.json` (the API inventory and the findings: file paths, line numbers, package names and versions, operations, hosts and Parche's messages, plus the repository name, commit and run id; no source code), `ledger.jsonl` (the PRs it opened in that run) and the weekly summary built from them (`resumen.html`, `resumen.txt` and `resumen.json`, also added to the job summary; `summary: 'false'` turns it off). All of it stays in your workflow run: anyone who can see the repository's Actions runs can download the artifact, and it's kept as long as the repository's artifact retention says. Turn the snapshot off with `snapshot: 'false'`. |
| **Tokens** | `ANTHROPIC_API_KEY`, only for `parche ai-upgrade`, sent only to `api.anthropic.com`; in the Action it reaches only that step. `GITHUB_TOKEN`, only for `parche pr`, `parche ai-upgrade` and, in GitHub Actions, `parche summary`, to call `api.github.com`; it isn't sent anywhere else. To compare with the previous week, the summary needs `actions: read` (the workflow template asks for it); without it, the summary is built without the comparison and says why. The push uses the git credentials already set up (in GitHub Actions, the ones `actions/checkout` leaves). |

## Using the GitHub Action safely

- The workflow template asks for read-only permissions by default and grants `contents: write` and `pull-requests: write` only to the Parche job.
- `Pepo08/parche@v0` moves with every 0.x release. If your organization requires pinned actions, use the commit of a release instead (`Pepo08/parche@<sha> # v0.6.7`); the commits are listed in [Releases](https://github.com/Pepo08/parche/releases).
- Releases are published from GitHub Actions with npm trusted publishing and provenance: no long-lived npm token exists for this package.

---

## En castellano

**Cómo reportar una vulnerabilidad:** no abras un issue público. Usá **Security → Report a vulnerability** en este repo o escribí a **hola@getparche.com** con "Security" en el asunto. La primera respuesta llega en **14 días como máximo**. Si se confirma, el arreglo sale en un release nuevo y el aviso te menciona, salvo que prefieras quedar anónimo. Se mantiene la última versión 0.x, que es la que usa `Pepo08/parche@v0`.

**Qué hace Parche en tu máquina o en tu runner:** lo de la tabla de arriba. En corto: `scan` y `fix` no usan la red; `pr` habla solo con `api.github.com` y pushea solo su rama `parche/<pack>`, y nunca pisa un commit que no escribió; en GitHub Actions, el resumen de la semana lee de `api.github.com` la foto anterior y los PRs de Parche, y no se manda a ningún lado; solo si prendés los arreglos con IA (a prueba), los archivos del aviso de un SDK de npm van a la API de Anthropic con tu clave, nunca código de facturación ni de pagos; `diff` y `--upgrades` bajan paquetes de `registry.npmjs.org`. No hay telemetría. Solo ejecuta tus tests si le pasás `--verify`.
