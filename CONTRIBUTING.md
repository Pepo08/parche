# Cómo contribuir

Gracias por querer sumar. Parche abre PRs en código de facturación y pagos de otras personas, así que las reglas son pocas pero estrictas.

## Qué sirve más

- **Un falso positivo o un aviso que no salió:** abrí un issue con la plantilla "Falso positivo o aviso que falta". Con un fragmento mínimo de código (sin datos reales) alcanza.
- **Un cambio de API con fecha que Parche no conoce:** abrí un issue con la plantilla "Pedido de pack", con el link a la fuente oficial (changelog, página de deprecaciones, resolución). Sin fuente oficial no hay pack.
- **Código:** un PR chico, con tests. Si es grande, abrí antes un issue para hablarlo.

## Reglas para el código

1. **Cero inventos.** Lo que no se puede saber con certeza se reporta como `needs-input` o como aviso (`detect-only`). Nunca se completa un dato del negocio "por las dudas".
2. **Diffs mínimos e idempotentes.** Correr un codemod dos veces no cambia nada. Se respetan las comillas, la indentación y el fin de línea del archivo (CRLF y tabs incluidos).
3. **Tests por cambio, con fixtures y sin red.** `npm test` tiene que pasar en Linux y en Windows (la CI corre los dos). Los fixtures son código inventado: nunca código o datos de un repo real.
4. **Dependencias mínimas.** Cualquier dependencia nueva se justifica en el PR.
5. **Rutas con `/`** en todo lo que ve el usuario (reporte, PR, inventario).
6. **Idioma:** el código y los identificadores, en inglés. Lo que ve quien usa Parche (salida de la CLI, cuerpos de PR, avisos), en castellano; el bloque inicial del README y los packs globales, también en inglés.
7. **Un pack nuevo** cita sus fuentes oficiales y tiene `last_verified` (ver los campos obligatorios en `src/packs.js`).

## Cómo correrlo

```bash
npm install
npm test
node bin/parche.js scan examples/tienda-demo
bash demo.sh        # en Windows, con Git Bash
```

## Sacar una versión (mantenedores)

Las versiones se publican solas desde GitHub Actions ([`release.yml`](.github/workflows/release.yml)) con [trusted publishing](https://docs.npmjs.com/trusted-publishers): npm confía en este repo y en ese workflow, sin tokens ni 2FA a mano. Desde `main` actualizado:

```bash
npm version 0.1.2 --no-git-tag-version            # cambia package.json y package-lock.json
git commit -am "Parche 0.1.2"
git tag -a v0.1.2 -m "Parche 0.1.2: qué cambió"   # el mensaje del tag es el texto del GitHub Release
git push origin main v0.1.2
```

Con el tag, el workflow corre los tests, controla que la versión de `package.json` coincida con el tag y que el commit esté en `main`, publica `parche-cli` en npm (con provenance), mueve `v0` a esta versión (es la que usan los workflows con `Pepo08/parche@v0`) y crea el GitHub Release. Para notas largas, `git tag -a v0.1.2 -F notas.md`.

- Solo dispara con versiones estables (`vX.Y.Z`); un tag como `v0.2.0-beta.1` no hace nada.
- Si falla un paso después de publicar, "Re-run failed jobs" retoma: lo que ya está hecho se saltea.
- Requiere, una sola vez, el Trusted Publisher en npmjs.com: `parche-cli` → Settings → Trusted publishing → GitHub Actions, con `Pepo08` / `parche` / `release.yml` y permiso para `npm publish`.

## Convivencia

Este proyecto sigue el [código de conducta](CODE_OF_CONDUCT.md). Las vulnerabilidades no van en issues públicos: ver [`SECURITY.md`](SECURITY.md).

Al mandar un PR, aceptás que tu aporte se publique con la licencia del proyecto ([MIT](LICENSE)).
