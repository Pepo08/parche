# Instalar Parche en GitHub Actions

Un archivo en tu repo y un ajuste de GitHub. Desde ese momento, cada lunes Parche revisa tu código contra su base de cambios de API verificados y te abre un PR por cada cambio que te afecta. Lo que no puede arreglar solo te lo deja escrito en la corrida.

[In English, below](#in-english).

## 1. Qué vas a tener

- **Una corrida por semana** (los lunes a las 8:17 de Argentina), más las que lances a mano.
- **Un PR por cada cambio que te afecta.** Sale como borrador si algo necesita que lo mire una persona, y nunca se mergea solo. Si ya hay un PR de Parche abierto, la corrida siguiente no abre otro (ver [la sección 7](#7-qué-recibís)).
- **El resumen de cada corrida** en la pestaña Actions: los PRs, lo que quedó sin PR porque falta un dato de tu negocio y los avisos de los cambios que Parche detecta pero no cambia solo (por ejemplo, un modelo de IA que se retira).
- **La foto de la corrida** como artifact: el inventario de las APIs que usás y los avisos, en JSON, sin código.

Tu código no sale del runner, salvo el PR que se abre en tu propio repo. Qué hace Parche en el runner, qué red usa y qué escribe: [SECURITY.md](../SECURITY.md).

## 2. Antes de empezar

- El repo tiene que estar en GitHub, público o privado ([la sección 6](#6-repos-privados) dice qué cambia en uno privado).
- Para agregar el workflow alcanza con permiso de escritura en el repo. Para el ajuste de la sección 4 hace falta ser admin del repo (o de la organización, si el repo es de una).
- No hace falta instalar nada en tu proyecto: la Action instala Parche en el runner. Anda en proyectos de Node y de PHP.

## 3. El workflow

Copiá [`templates/github-workflow.yml`](../templates/github-workflow.yml) a `.github/workflows/parche.yml` y commitealo **en la rama por defecto** del repo (`main`, casi siempre). GitHub solo muestra el botón para correrlo a mano si el archivo está en esa rama.

Qué hace cada parte:

| Parte | Qué hace | Cuándo cambiarla |
|---|---|---|
| `schedule: cron: "17 11 * * 1"` | Corre los lunes a las 11:17 UTC, que son las 8:17 de Argentina | Si querés otro día u otra hora. El `cron` va siempre en UTC |
| `workflow_dispatch` | Te deja correrlo a mano desde la pestaña Actions | No la saques: es como se hace la primera corrida |
| `permissions` | Todo el workflow queda en solo lectura, y el job de Parche pide lo justo para abrir PRs (sección 4) | No hace falta |
| `actions/checkout` con `fetch-depth: 0` | Baja toda la historia del repo. Parche la usa para ver si su rama ya tiene un PR abierto y si alguien le sumó commits | Dejala en `0`. Con menos historia, Parche no puede ver si la rama es solo suya y no actualiza su PR |
| `actions/setup-node` | El Node con el que corre Parche (24) | Si tus tests piden otra versión de Node, cambiala acá |
| "Instalar dependencias de Node" y "de PHP" | `npm ci` si hay `package-lock.json` y `composer install` si hay `composer.json`, para que corran tus tests antes de cada PR | Si tu proyecto necesita otros pasos para instalarse (un registro privado, otra versión de PHP), agregalos acá, igual que en tu CI |
| `uses: Pepo08/parche@v0` | Corre Parche. `@v0` toma solo cada versión 0.x nueva, con los packs nuevos | Para fijar una versión, usá el commit de ese release: `Pepo08/parche@<sha> # v0.7.6` ([Releases](https://github.com/Pepo08/parche/releases)) |

Las opciones de la Action (`verify`, `pack`, `dry-run`, `token`, `snapshot` y `snapshot-name`) están en la [tabla del README](../README.md#github-action-quick-start).

## 4. Los permisos

Son tres cosas:

1. **Los permisos del job.** La plantilla le da al job de Parche `contents: write`, para pushear su rama `parche/<pack>`, y `pull-requests: write`, para abrir el PR. Nada más.
2. **El ajuste que deja que GitHub Actions abra PRs.** En **Settings → Actions → General → Workflow permissions**, prendé **"Allow GitHub Actions to create and approve pull requests"** y guardá. Viene apagado en los repos personales nuevos y en las organizaciones nuevas, y el repo de una organización hereda lo que diga la organización: en ese caso, lo prende un admin en la configuración de la organización. Si está apagado, la corrida termina con "GitHub no deja que GitHub Actions abra PRs en este repo".
3. **El token.** Por defecto, la Action usa el `GITHUB_TOKEN` del workflow. Con ese token, GitHub deja esperando los workflows del PR que abre Parche (tu CI, por ejemplo) hasta que alguien con permiso de escritura toca **Approve workflows to run**; el cuerpo del PR lo avisa. Si querés que corran solos, pasale a la Action un token de una GitHub App o uno personal, con permiso de escritura en `contents` y `pull-requests`. Con uno de esos tokens, el ajuste del punto 2 no hace falta:

   ```yaml
   - uses: Pepo08/parche@v0
     with:
       token: ${{ secrets.PARCHE_TOKEN }}
   ```

## 5. La primera corrida

No esperes al lunes: en la pestaña **Actions** del repo, elegí **Parche** a la izquierda y tocá **Run workflow**. O desde la terminal, con la [CLI de GitHub](https://cli.github.com):

```bash
gh workflow run parche.yml
```

Tarda unos minutos, según lo que tarden en instalarse tus dependencias y en correr tus tests. Cuando termine, mirá:

- **El resumen del job**, al entrar a la corrida: los PRs que abrió, lo que quedó sin PR y los avisos.
- **Los PRs**, en la pestaña Pull requests: uno por cada cambio de API que te afecta, con rama `parche/<pack>`.
- **El artifact `parche`**, al pie de la corrida: la foto con el inventario y los avisos.

"Ninguno de los packs verificados tiene cambios que te afecten hoy" también es un resultado: Parche corrió y no encontró nada para hacer. Va a seguir mirando cada lunes.

Si querés ver qué haría antes de que abra PRs, la primera vez corré con `dry-run: 'true'`: arma las ramas y los cuerpos de los PRs sin abrirlos, y el resumen del job muestra todo.

## 6. Repos privados

Parche anda igual en un repo privado. Lo que cambia es lo que cobra GitHub, y no Parche, que es gratis:

- **Los minutos de Actions.** En un repo público, los runners estándar de GitHub no se cobran. En uno privado, la corrida usa los minutos de tu cuenta: el plan gratis de GitHub trae 2.000 minutos por mes (documentación de GitHub, verificado el 25/10/2026). Una corrida por semana gasta lo que tarden en instalarse tus dependencias y en correr tus tests, en un runner de Linux.
- **El espacio de los artifacts.** La foto de cada corrida ocupa el espacio de artifacts de tu cuenta: el plan gratis trae 500 MB. La foto es un JSON chico, pero si no la querés, poné `snapshot: 'false'`. Por defecto, GitHub la borra a los 90 días; en un repo privado podés poner entre 1 y 400 días en **Settings → Actions → General**.
- **Las dependencias privadas.** Si tu proyecto instala paquetes de un registro privado, agregá su token como ya lo hacés en tu CI, antes de "Instalar dependencias".
- **Runners propios** (self-hosted). Necesitan llegar a `registry.npmjs.org`, para instalar Parche, y a `api.github.com`, para abrir el PR. Tu código no sale del runner.

## 7. Qué recibís

| Qué | Dónde | Cómo te enterás |
|---|---|---|
| Un PR por cada cambio que te afecta | Pull requests, rama `parche/<pack>` | Con las notificaciones de GitHub de siempre: te llega si mirás el repo (Watch; GitHub lo prende solo para quien tiene permiso de escritura, salvo que lo haya apagado en su configuración). Para que le llegue a alguien en particular, pedile revisión en el PR |
| Lo que quedó sin PR y los avisos | El resumen del job, y como anotaciones con el archivo y la línea (GitHub muestra las primeras 10; el resumen las tiene todas) | Entrando a la corrida, en la pestaña Actions |
| La foto de la corrida (`scan.json` y `ledger.jsonl`) | El artifact `parche` de la corrida | Se baja desde la corrida o con `gh run download <id> -n parche` |

**Si ya hay un PR de Parche abierto,** la corrida siguiente no abre otro:

- si el arreglo es el mismo, no lo toca;
- si cambió (por ejemplo, salió una versión nueva del pack) y el PR tiene solo el commit de Parche, lo actualiza;
- si alguien le sumó un commit, no lo pisa: lo deja como está y lo dice en el resumen del job.

## 8. Si algo falla

| Lo que ves | Qué pasa | Qué hacer |
|---|---|---|
| "GitHub no deja que GitHub Actions abra PRs en este repo" | Está apagado el ajuste de la sección 4, punto 2 | Prendelo (en el repo o en la organización), o usá un token de GitHub App o personal. La rama ya quedó pusheada: la corrida siguiente abre el PR |
| "La verificación falló para `<pack>`" | Con el arreglo, tus tests no pasaron. Parche no abre ese PR y deja el repo como estaba; los demás packs corren igual | Mirá el detalle en el log de la corrida. Para reproducirlo en tu máquina: `npx parche-cli fix . --pack <pack>` y después tus tests |
| "Hay cambios sin commitear" | Un paso anterior del workflow modificó archivos del repo (un build, por ejemplo) | Poné Parche antes de ese paso, o ignorá en git lo que genera |
| "La rama `parche/<pack>` tiene commits de otra persona" | Alguien le sumó un commit a la rama de Parche, y Parche no la pisa | Si querés que Parche la rehaga, cerrá el PR y borrá la rama |
| No aparece el botón **Run workflow** | El workflow no está en la rama por defecto | Mergealo a la rama por defecto |
| Los checks del PR de Parche dicen que esperan aprobación | Es el `GITHUB_TOKEN` (sección 4, punto 3) | Tocá **Approve workflows to run**, o usá un token de GitHub App o personal |
| Falla "Instalar dependencias" | Tu proyecto necesita algo más para instalarse | Agregá los mismos pasos que usa tu CI antes de ese paso |
| "No se pudo armar la foto de la corrida" | Falló el armado del artifact | Los PRs y el resumen del job no cambian. Si se repite, avisanos (abajo) |
| Dejó de correr los lunes | En un repo público sin actividad, GitHub apaga solos los workflows programados después de 60 días (documentación de GitHub, verificado el 25/10/2026) | Volvé a prenderlo en la pestaña Actions, en el workflow Parche |

## 9. Desinstalar

Borrá `.github/workflows/parche.yml`. Las ramas `parche/*` y sus PRs quedan hasta que los cierres o los borres. Los artifacts vencen solos, según la retención del repo.

## 10. Ayuda

- Por qué te llegó un PR de Parche y qué revisar: [¿Por qué recibí este PR?](por-que-recibi-este-pr.md).
- Un error o una duda: un [issue](https://github.com/Pepo08/parche/issues) o un mail a hola@getparche.com.
- Una vulnerabilidad: por privado, como dice [SECURITY.md](../SECURITY.md).

---

## In English

1. Copy [`templates/github-workflow.yml`](../templates/github-workflow.yml) to `.github/workflows/parche.yml` on your **default branch** (the manual "Run workflow" button only shows up for workflows on that branch). Keep `fetch-depth: 0`: Parche uses the history to tell whether its branch already has an open PR and whether someone else pushed to it.
2. In **Settings → Actions → General → Workflow permissions**, turn on **"Allow GitHub Actions to create and approve pull requests"**. It's off by default for new personal repositories and new organizations, and an organization's repositories inherit the organization's setting. Without it, the run ends with "GitHub no deja que GitHub Actions abra PRs en este repo". With a GitHub App token or a personal token in the `token` input you don't need it, and your CI also runs on Parche's PRs without someone approving it.
3. Run it once by hand: **Actions → Parche → Run workflow**, or `gh workflow run parche.yml`. Check the job summary, the PRs (branches `parche/<pack>`) and the `parche` artifact.

Private repositories work the same; runs use your account's Actions minutes (2,000 per month and 500 MB of artifact storage on GitHub Free, per GitHub's docs, checked on October 25, 2026). If an open Parche PR already exists, the next run updates it only when it holds nothing but Parche's own commit, and never force-pushes over someone else's commits. PR bodies and the job output are in Spanish for now.
