# Parche — Dependabot para APIs

[![CI](https://github.com/Pepo08/parche/actions/workflows/ci.yml/badge.svg)](https://github.com/Pepo08/parche/actions/workflows/ci.yml)

Parche lee tu código y arma el inventario de **todas** las APIs de terceros que usás: SDKs (Stripe, Twilio, OpenAI, AWS, Mercado Pago, ARCA…), llamadas HTTP directas y modelos de IA. Lo cruza contra una base de **cambios de API verificados** y, cuando un proveedor cambia algo que te afecta, te avisa o abre un PR con el arreglo, explica qué cambió y por qué, y marca lo que necesita una persona. Ningún PR sale sin pasar la verificación. Las APIs de pagos y facturación de Latinoamérica son el fuerte, pero el inventario cubre cualquier API.

```
$ parche scan .
APIs del repo (6):
  SDK   Anthropic · @anthropic-ai/sdk          alta   messages.create  · con pack
  SDK   ARCA (ex AFIP) · @afipsdk/afip.js      alta   ElectronicBilling.createNextVoucher ×3  · con pack
  SDK   Mercado Pago · mercadopago             alta   Payment.create ×3, Payment.get  · con pack
  SDK   OpenAI · openai                        alta   beta.assistants.create  · con pack
  IA    Anthropic · modelos                    alta   claude-3-5-haiku-20241022  · con pack
  IA    OpenAI · modelos                       alta   gpt-4o  · con pack

■ Condición frente al IVA del receptor obligatoria en WSFEv1
  ARCA (ex AFIP) · severidad critical · vence 2026-12-01 (46 días)
  ✅ automático     src/facturacion.js:14  Agregado CondicionIVAReceptorId: 5 (Consumidor Final)…
  👀 revisar       src/facturacion.js:56  Agregado CondicionIVAReceptorId: 5 por inferencia (DNI + comprobante B/C)…
  ✋ falta un dato  src/facturacion.js:62  Falta CondicionIVAReceptorId y no se puede inferir… (comprobante clase A).

■ Modelos y endpoints de IA retirados o por retirarse
  🔎 detectado     src/ia.js:9  El modelo `claude-3-5-haiku-20241022` fue retirado el 2026-02-19: las llamadas ya fallan…
…
```

El inventario completo (con operaciones, ubicaciones y nivel de confianza) queda en `.parche/inventory.json`; el formato está en [`docs/inventario.md`](docs/inventario.md). Para ver un repo con APIs de todo tipo, desde este repo: `node bin/parche.js scan examples/saas-demo`.

## Por qué packs y no "un LLM que arregla todo"

Ya hay varios prototipos que le piden a un modelo que lea un changelog y escriba el fix. El problema es que el modelo solo sabe lo que aprendió en su entrenamiento, y una migración de pagos o de facturación no admite "casi bien". Parche separa las dos cosas:

- **El pack es dato, no prompt.** Cada cambio de API es un JSON versionado con fuente, fecha límite, reglas de detección, mapeo de campos, casos bloqueados y checklist de revisión (ver `packs/`). Un LLM puede ayudar a *redactar* un pack a partir de un changelog, pero una persona lo verifica antes de publicarlo.
- **El arreglo es determinístico.** Los codemods trabajan sobre el AST, respetan el formato del cliente (el diff de ARCA es de 2 líneas por factura) y son idempotentes.
- **Lo que no se puede inferir, no se inventa.** Si falta un dato del negocio (¿este cliente con CUIT es Responsable Inscripto o Monotributo?), el PR lo dice y muestra los valores válidos.
- **Cada PR mergeado, editado o rechazado vuelve como señal** (`.parche/ledger.jsonl`, `parche feedback`). Eso es lo que hace que la base mejore con el uso.

## Uso

Requiere Node 22 o más nuevo. El paquete de npm se llama `parche-cli`; si lo instalás (`npm i -g parche-cli`), el comando es `parche`.

```bash
npx parche-cli packs                 # cambios que Parche conoce
npx parche-cli scan .                # inventario + qué te afecta (.parche/report.md)
npx parche-cli scan . --upgrades     # + qué cambia en las versiones nuevas de tus SDKs
npx parche-cli diff <paquete> --from <v> --to <v>   # qué cambia en la API de un paquete
npx parche-cli fix .                 # aplica los arreglos en tu working copy
npx parche-cli pr . --verify         # una rama + commit + PR por cambio
npx parche-cli feedback . --pack <id> --outcome merged|edited|rejected
```

`parche pr` abre el PR por la API de GitHub si hay `GITHUB_TOKEN` y un remote `origin` en github.com; si no (o con `--dry-run`), deja la rama, el commit y el cuerpo del PR en `.parche/pr-<pack>.md`. Si hay ítems para revisar, el PR se abre como borrador.

- **Desde un fork:** `parche pr . --push-remote fork` pushea la rama al remote `fork` (tu fork, con tus credenciales de git) y abre el PR contra `origin`.
- **Nunca deja el repo sucio:** si la verificación falla, descarta lo que escribió y borra su rama. Si no hay cambios de código, o solo cambiarían tests o mocks, no abre PR: deja el texto como issue en `.parche/`.

### Qué cambia en las versiones nuevas de tus SDKs

`--upgrades` compara, para cada SDK de npm que usás, la versión instalada con la última publicada. Lee los tipos (`.d.ts`) de las dos versiones y te dice qué operaciones **de tu código** desaparecen, piden parámetros nuevos, cambian de tipo o pasan a deprecadas. Solo avisa: no toca código.

```
$ npx parche-cli scan . --upgrades
…
Versiones nuevas de tus SDKs de npm:
  openai                 3.3.0 → 7.34.0       ⚠ 2 de tus operaciones cambian o desaparecen
      OpenAIApi.createChatCompletion  (src/asistente.js:8)
        `OpenAIApi` ya no existe.
      OpenAIApi.createEmbedding  (src/asistente.js:16)
        `OpenAIApi` ya no existe.
  stripe                 17.0.0 → 23.0.0      ✓ lo que usás no cambia (22 cambios en el SDK)
```

Y para un paquete cualquiera, sin repo: `npx parche-cli diff stripe --from 17 --to latest` (acepta versiones parciales y `latest`; `--all` para ver todo, `--json` para procesarlo). Los tarballs quedan en `~/.parche/cache` (cambiable con `PARCHE_CACHE`); con `PARCHE_OFFLINE=1` usa solo el caché.

### En GitHub Actions

Para que corra todas las semanas, copiá [`templates/github-workflow.yml`](templates/github-workflow.yml) a `.github/workflows/parche.yml`. El paso clave es:

```yaml
- uses: Pepo08/parche@v0
  with:
    verify: 'true'     # corre tu npm test antes de abrir cada PR
    # pack: arca.wsfe.condicion-iva-receptor   # opcional: un solo pack
    # dry-run: 'true'                          # opcional: armar las ramas sin abrir PRs
```

El workflow necesita `permissions: contents: write` y `pull-requests: write`.

### Desarrollo

```bash
npm install
npm test                         # el CI los corre en Linux y Windows
bash demo.sh                     # demo completa sobre examples/tienda-demo (JS)
node bin/parche.js scan examples/tienda-php   # ejemplo PHP con afip.php
node bin/parche.js scan examples/saas-demo    # SaaS con Stripe, Twilio, OpenAI y HTTP directo
node bin/parche.js scan examples/legacy-ia --upgrades   # OpenAI v3: qué se rompe al actualizar (usa la red)
```

#### Sacar una versión

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

## Estados de cada hallazgo

| Estado | Qué significa |
|---|---|
| ✅ automático | El arreglo es seguro y queda aplicado. |
| 👀 revisar | Se aplicó, pero hay una decisión que confirmar (va en el PR, que sale como borrador). |
| ✋ falta un dato | No se puede arreglar sin información del negocio. El PR dice qué agregar y con qué valores. |
| ⛔ bloqueado | Migrarlo rompería algo (ej. `application_fee` en Orders). No se toca. |
| 🔎 detectado | Solo aviso: cambiarlo cambia el comportamiento (ej. modelo de IA retirado). |

## Packs incluidos

| Pack | Proveedor | Tipo | Fecha límite | Arreglo |
|---|---|---|---|---|
| `arca.wsfe.condicion-iva-receptor` | ARCA | rompe | 2026-12-01 | sí, en JS (`afip.js`) y PHP (`afipsdk/afip.php` y forks): consumidor final y DNI B/C; con `DocTipo` en una variable, consumidor final al ejecutarse (PR parcial) |
| `mercadopago.payments-to-orders` | Mercado Pago | migración | — | sí (creación de pagos en SDK Node v2) |
| `ai.model-retirements` | Anthropic, OpenAI | retiro | varias | solo detección (también modelos fine-tuned de OpenAI, `ft:…`). De OpenAI, los modelos que su página de deprecaciones apaga desde 2026: texto, código, imagen, video, voz, transcripción y realtime; y los productos que cierran: Assistants API, prompts reutilizables (`pmpt_…`, `v1/prompts`), la plataforma de Evals, ChatKit con un workflow de Agent Builder y la Videos API (cerrada el 24/9/2026) |

## Verificación

Antes de commitear, Parche parsea **siempre** cada archivo modificado (JS/TS o PHP): eso no ejecuta nada del repo. Con `--verify`, además corre los tests del repo que correspondan a lo que cambió: `npm test` para JS/TS; para PHP, `composer test` o `vendor/bin/phpunit`. Si no hay tests, queda el chequeo de sintaxis y el PR lo dice. Sin `--verify` (por ejemplo, en un PR a un repo de terceros, donde no se ejecuta su código), el PR dice que Parche no corrió los tests y nombra los workflows del repo que los corren en cada pull request. Si algo falla, no hay PR. El commit lleva la versión del pack que lo generó, para poder rastrear qué regla produjo cada cambio.

**Quién firma el commit:** `--author "Nombre <email>"` si lo pasás; si no, `PARCHE_GIT_NAME` y `PARCHE_GIT_EMAIL` si están; si no, tu identidad de git (`user.name` y `user.email`, también la que configure tu workflow); en GitHub Actions sin identidad, `github-actions[bot]`, el mismo que abre el PR. Si no hay ninguna, `parche pr` frena antes de tocar el repo. Antes de pushear, si el email no es un noreply de GitHub, avisa: va a quedar público en el commit del PR.

**Copias de respaldo:** Parche no lee ni edita carpetas `BAK/`, `backup/`, `old/`, `_old/` y `deprecated/`, ni archivos como `factura copy.php`, `factura - Copy.js`, `factura.bak.php` o `factura-old.php`. El scan dice cuáles saltó, por si alguno es código que corre.

## ARCA en PHP

Para `afipsdk/afip.php` y sus forks (`fertandil87/afip.php`, `ivanalemunioz/afip.php`, `eesnaola/afip.php`), Parche busca `$afip->ElectronicBilling->CreateVoucher($data)` y `CreateNextVoucher($data)` (también en minúsculas: PHP no distingue) y agrega una línea por factura:

```php
            'DocNro'     => 0,
            // parche: 5 = Consumidor Final (DocTipo 99, sin identificar)
            'CondicionIVAReceptorId' => 5,
```

- Lee el array cuando está en la llamada (`array(...)` o `[...]`) o en una variable definida una sola vez, antes de la llamada y en la misma función. Si los datos llegan de otro lado, se reasignan o se completan en varios pasos (`$data['DocTipo'] = ...`), lo reporta como "falta un dato" y no toca nada.
- Copia el estilo del array: comillas de las claves, indentación (espacios o tabs), alineación de los `=>`, coma final y fin de línea (LF o CRLF).
- Saltea `vendor/`.

**La versión de la librería importa.** Con `afip.js`/`afip.php` 0.x (y `eesnaola/afip.php`) el pedido se arma con un WSDL de 2021 que no tiene `CondicionIVAReceptorId`: aunque el campo esté en el código, no llega a ARCA. Parche lee la versión instalada (`composer.lock`, `package-lock.json`, `node_modules`) y, en esos casos, el arreglo sale como **"revisar"** con el aviso de actualizar a 1.x. También avisa si el repo tiene un `.wsdl` de WSFEv1 sin el campo.

**Otros lenguajes:** en Python, C#, Java, Go y VB.NET, Parche detecta integraciones SOAP propias y clientes SOAP generados sin el campo (no los reescribe).

## ARCA con `DocTipo` en una variable: PR parcial

Cuando `DocTipo` no es un número fijo (`DocTipo: docTipo`), Parche no puede saber la condición frente al IVA de cada cliente. Lo único que se sabe sin datos del negocio es que **99 (consumidor final sin identificar) va con 5**, así que aplica esa regla **al ejecutarse** y, con cualquier otro `DocTipo`, el pedido sale exactamente igual que hoy:

```js
    DocNro: docNro,
    // parche: 5 = Consumidor Final solo si DocTipo es 99; con otro DocTipo falta la condición frente al IVA del cliente
    ...(Number(docTipo) === 99 ? { CondicionIVAReceptorId: 5 } : {}),
```

```php
        );
        // parche: 5 = Consumidor Final solo si DocTipo es 99; con otro DocTipo falta la condición frente al IVA del cliente
        if ((int) $data['DocTipo'] === 99) {
            $data['CondicionIVAReceptorId'] = 5;
        }
```

- El PR sale **borrador**, con "(parcial: consumidor final)" en el título. En "Lo que este PR NO resuelve" dice qué falta: los comprobantes con otro `DocTipo` (CUIT, DNI y otros) siguen sin el campo y desde el 1/12/2026 ARCA los va a rechazar. Ahí también están los códigos válidos para la clase del comprobante.
- Con otro `DocTipo` la clave ni existe (no queda en `undefined` ni en `null`): el pedido no depende de cómo lo serialice la librería y no aparece un rechazo que hoy no existe.
- `Number(...)` y `(int)` hacen que `'99'` como texto también cuente.
- En JS solo se aplica si `DocTipo` se puede releer sin efectos (`docTipo`, `cliente.docTipo`, `this.datos['DocTipo']`), no si es una llamada o un `await`. En PHP se lee del array ya armado, así que sirve cualquier expresión, pero el array tiene que estar en una variable (`$data = [...]`): con el array dentro de la llamada no hay dónde poner el `if`.
- No se aplica a facturas A ni a otras clases conocidas que no sean B o C.
- Si se vuelve a correr después del merge, no cambia nada y sigue avisando lo que falta.

## Límites del MVP

- JS/TS (ESM y CommonJS) y, para ARCA, PHP. Siguen Python y Java.
- ARCA: cubre `@afipsdk/afip.js` y `afipsdk/afip.php` (con sus forks). Las integraciones SOAP propias (en cualquier lenguaje) se detectan pero no se reescriben.
- Mercado Pago: migra la creación de pagos con el SDK v2. Las consultas, capturas y reembolsos de pagos existentes se dejan a propósito en Payments API, como indica la guía oficial.
- Se distribuye como CLI (`npx parche-cli`) + GitHub Action (`Pepo08/parche@v0`). La GitHub App (instalación en un click, PRs automáticos al publicarse un pack nuevo) es el próximo paso.
- La capa de LLM (redactar packs desde changelogs y resolver casos "falta un dato" leyendo el modelo de datos del cliente) todavía no está incluida; cuando entre, va a pasar por la misma verificación.
