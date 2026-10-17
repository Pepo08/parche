# Arquitectura de Parche

Qué hace cada parte del código, cómo fluye un `scan` o un `pr`, y **por qué** se hizo así. Sirve para cambiar o afinar algo sabiendo qué se toca y qué se puede romper.

**Regla:** cada hito actualiza este documento: módulos nuevos, decisiones nuevas (sección 4) y límites conocidos (sección 6).

---

## 1. El flujo, de punta a punta

```
parche scan|fix|pr <repo>
        │
        ▼
bin/parche.js ──► engine.run(repo)
                    │  listFiles: todos los .js/.ts/.php, salteando node_modules, vendor, .git…
                    │  readManifests: package.json + composer.json + requirements.txt
                    │
                    ├─ por cada archivo JS/TS: scanJs(original) → SDKs y operaciones, HTTP, modelos de IA
                    │     (inventario de CUALQUIER API, nivel 1; se hace antes de que un pack lo modifique)
                    │
                    ├─ por cada archivo, por cada pack:
                    │     transformFor(pack, archivo)  ← elige la versión JS o PHP del pack
                    │     transform({ source, file, pack }) → { output, findings, usages }
                    │        output:   el archivo arreglado, o null si no cambia
                    │        findings: hallazgos con estado (auto, needs-review, needs-input, blocked, detect-only)
                    │        usages:   qué API se usa y dónde (el inventario)
                    │
                    └─► buildInventory(...) → { inventory, findings, changed }
        │
        ├─ scan: escribe .parche/inventory.json y .parche/report.md
        │        con --upgrades: checkUpgrades (abajo) y suma la sección al reporte
        ├─ fix:  escribe los archivos arreglados
        └─ pr:   por cada pack con arreglo: rama parche/<pack> → escribe → verify → commit
                 → cuerpo del PR (report.prBody) → push + PR en GitHub (si hay token) → ledger

parche diff <paquete> --from <v> --to <v>      y      parche scan --upgrades
        │
        ▼
registry: metadata y tarball de cada versión (integridad sha512, caché en ~/.parche/cache)
        → tar.extractTypes: solo los .d.ts y el package.json
        → surface.extractSurface (TypeScript): rutas públicas con sus firmas y @deprecated
        → compare.diffSurfaces: qué desaparece, qué pide más parámetros, qué cambia de tipo, qué se depreca
        → (scan --upgrades) compare.affectedOperations: cruza con las operaciones del inventario
          → "openai 3.3.0 → 7.34.0: OpenAIApi.createChatCompletion (src/asistente.js:8): `OpenAIApi` ya no existe."
```

## 2. Conceptos

| Concepto | Qué es | Dónde |
|---|---|---|
| **Pack** | Un cambio de API escrito como **datos**: fuente, fecha, qué detectar, códigos válidos, checklist. Es el producto. | `packs/*.json` |
| **Transform** | El código que aplica un pack a un archivo: un *codemod* (arregla) o un *detector* (solo avisa). | `src/codemods/`, `src/detectors/` |
| **Finding** | Un hallazgo: archivo, línea, estado y mensaje en castellano. | lo devuelve cada transform |
| **Usage** | Un uso de una API (proveedor, operación, línea). Sumados, son el inventario. | lo devuelve cada transform |
| **Ledger** | Registro de lo que hizo Parche y de lo que pasó con cada PR (mergeado, editado, rechazado). | `.parche/ledger.jsonl` en el repo del cliente |

**El contrato de un transform:** `transform({ source, file, pack, today }) → { output, findings, usages }`. Es una función pura: no lee ni escribe archivos ni usa la red.
*Por qué:* así cada pack se prueba con fixtures, el resultado es determinístico y el motor es el único que escribe.

## 3. Módulos

### `bin/parche.js`: la CLI
- `main()`: comandos `packs`, `scan`, `fix`, `pr`, `feedback`.
- `pr`: exige un repo git limpio. Por cada pack con arreglo: corre una vista previa; si hay hallazgos, crea la rama `parche/<pack>`, escribe, verifica (sintaxis siempre en `--dry-run`/`--verify`; tests solo con `--verify`), arma el cuerpo, commitea, y abre el PR solo si hay `GITHUB_TOKEN`, un remote de GitHub y no es `--dry-run`. El PR sale como **borrador** si hay algo para revisar, un dato que falta o algo bloqueado. Al final vuelve a la rama base.
- `ensureLocalDir()`: crea `.parche/` y lo agrega a `.git/info/exclude`. *Por qué:* Parche no tiene que ensuciar el repo del cliente.
- `feedback`: registra en el ledger si un PR se mergeó, se editó o se rechazó.

### `src/engine.js`: el motor
- `listFiles()`: recorre el repo. Saltea `node_modules`, `vendor`, `.git`, `dist`, `build`, `coverage`, `.next` y `.parche`. *Por qué:* las dependencias instaladas no son código del cliente (en `vendor/` está la propia librería de ARCA). Ordena por la ruta con `/` para que el orden sea el mismo en Windows y Linux.
- Las dependencias se leen con `readManifests()` (de `src/inventory/index.js`): `package.json`, `composer.json` y `requirements.txt`.
- `run()`: arma el inventario de cada archivo JS/TS (sobre el original) y corre los packs archivo por archivo. **Encadena** las salidas: si dos packs tocan el mismo archivo, el segundo recibe lo que dejó el primero. Si un pack revienta en un archivo, eso se convierte en un hallazgo `needs-input` y el scan sigue. Las rutas siempre van con `/`.

### `src/inventory/`: inventario de cualquier API (nivel 1)
El esquema del resultado y sus límites están en [`docs/inventario.md`](inventario.md).
- `known.js`: `classifyPackage(ecosistema, nombre)` dice si un paquete es el SDK de una API (con proveedor, rubro y confianza), un cliente HTTP o ninguna de las dos cosas, según `data/known-sdks.json` y una heurística sobre el nombre (`api`, `sdk`, `client`). También tiene `packageOf()` (`'openai/resources'` → `openai`), `providerForHost()` (por sufijo) e `isInternalHost()`.
- `js-scan.js`: `scanJs(source, archivo)` lee un archivo JS/TS con `@babel/parser` y devuelve:
  - `sdk`: operaciones de SDKs. Sigue imports, `require`, `require('x')(...)`, instancias (`new Stripe(key)`, `twilio(sid, token)`, `new Payment(client)`) y arma la cadena de miembros (`stripe.paymentIntents.create`);
  - `http`: método, host y ruta de `fetch`, `axios` (incluido `axios.create({ baseURL })`), `got`, `undici` y `node-fetch`, resolviendo literales, plantillas y constantes del archivo;
  - `unresolved`: llamadas HTTP cuya URL llega de afuera;
  - `models`: IDs de modelos de IA en strings.
- `index.js`: `readManifests()` (npm, composer, pypi), `parseRequirements()`, `buildInventory()` (junta todo, agrupa operaciones con conteo y ubicaciones, ajusta la confianza) y `apiLabel()`.

### `src/sdk-diff/`: qué cambia entre versiones de un SDK de npm (hito C)
- `tar.js`: `extractTypes(tgz)` descomprime el tarball (con `zlib`) y lee el formato tar (ustar, pax, GNU) quedándose solo con `package.json` y los `.d.ts`.
- `registry.js`: `createRegistry({ cacheDir, fetch, offline })` → `metadata(pkg)`, `tarball(pkg, versión)` (verifica la integridad sha512 contra lo que publica npm) y `types(pkg, versión)`, que devuelve los archivos de tipos y su entrada; si el paquete no trae tipos, usa `@types/<pkg>` de la misma versión mayor. `typesEntry()` y `typesInExports()` encuentran la entrada en `types`, `typings` o `exports`, aunque esté anidada en condiciones como en Stripe 23. También están `compareVersions()` y el caché (`PARCHE_CACHE`, `PARCHE_OFFLINE=1`).
- `surface.js`: `extractSurface({ files, entry, pkgName })` arma un programa de TypeScript sobre un sistema de archivos virtual y recorre lo exportado. Devuelve dos mapas de ruta → `{ kind, deprecated, signatures }`: `default` (miembros de la instancia del export por defecto: `chat.completions.create`) y `exports` (exports con nombre: `OpenAIApi.createChatCompletion`). Baja por recursos (objetos con métodos, también invocables), por la instancia de las clases y por lo que devuelven las fábricas (`twilio(sid, token)`). Saltea lo privado y los tipos de la librería estándar.
- `compare.js`: `diffSurfaces(viejo, nuevo)` → cambios `removed`, `new-required`, `param-removed`, `type-changed` y `deprecated`. `affectedOperations()` y `unverifiedOperations()` cruzan con las operaciones del repo. `dedupeChanges()` saca los repetidos para mostrar.
- `upgrades.js`: `installedVersion()` (de `node_modules`, del lock o de la base del rango declarado), `resolveSpec()` (`latest`, `4`, `4.1`), `diffVersions()`, `checkUpgrades(inventario, repo, registry)` y `upgradeFindings()` (hallazgos `detect-only`).

### `data/known-sdks.json`: la lista curada
Paquete → proveedor y rubro (npm, composer, pypi), prefijos de familias (`@aws-sdk/client-`), clientes HTTP, lo que no es una API (tooling y frameworks) y hosts conocidos. Es **dato, no código**: sumar una entrada sube una detección a confianza alta sin tocar nada más.

### `src/packs.js`: registro de packs
- `TRANSFORMS`: para cada pack, su versión por lenguaje (`{ js, php }`). Si un pack no tiene versión para un lenguaje, no corre sobre esos archivos (Mercado Pago, por ejemplo, solo existe para JS).
- `languageOf()`, `transformFor(pack, archivo)`, `loadPacks()` (ordenados por fecha límite) y `validatePack()` (los campos obligatorios de `REQUIRED_FIELDS`).

### `src/ast.js`: utilidades de JavaScript/TypeScript
- `jFor()`: jscodeshift con el parser `ts` para `.ts` y `tsx` para el resto.
- `offsetAt(source, { line, column })`: convierte una posición de recast al offset real del archivo. **Imprescindible** para editar texto con recast (decisión D3).
- `eolOf()`: fin de línea predominante (LF o CRLF). `applyEdits()`: aplica inserciones de atrás para adelante, así no se corren los offsets.
- `parseCheck()`: chequeo de sintaxis (Babel para JS/TS, php-parser para PHP). Lo usan `verify` y los tests.
- `tidy()`: después de reimprimir con recast, saca solo las líneas en blanco nuevas, con un diff de líneas (LCS). Ver D5.
- Además: `getProp`, `literalValue`, `resolveBinding`, `memberChain`, `isReference` y `cloneNode`, para leer y armar nodos.

### `src/php.js`: utilidades de PHP
- `parsePhp()`: php-parser (glayzzle) en modo PHP 8, que también lee código PHP 5/7.
- `walkPhp(node, visit)`: recorre el árbol y le pasa a cada nodo su **scope** (función, método, closure o programa). *Por qué:* en PHP una variable no cruza esos límites, y el codemod solo confía en `$data` si está definida en el mismo scope.
- `phpLiteral()`: valor de un literal (`'99'` cuenta como 99, porque PHP lo convierte). `phpKey()`: clave string de un elemento de array.

### `src/verify.js`: verificación
- `testCommands(root, archivos)`: qué tests corresponden a lo que cambió. `npm test` si cambió JS/TS; para PHP, `composer test` o `vendor/bin/phpunit`. Si no hay ninguno, solo queda el chequeo de sintaxis.
- `verify()`: sintaxis de cada archivo modificado y, con `runTests`, los tests. Si algo falla, no hay PR.

### `src/report.js`: lo que ve el cliente
- `scanReport()`: el reporte de `scan`. `prBody()`: el cuerpo del PR, con qué cambió, qué hace el PR, **lo que el PR no resuelve**, la verificación, el checklist para mergear y las fuentes.
- La verificación dice la verdad: si no hubo tests, el PR lo dice y no muestra "✅ pasan".

### `src/git.js`, `src/github.js`, `src/ledger.js`
- `git.js`: envoltorios mínimos de git. `commitAll()` firma como `Parche <bot@parche.dev>` con `-c`. *Por qué:* no depende de la configuración de git del cliente (en los runners de CI no hay usuario configurado) y no lleva atribución de herramientas (D13).
- `github.js`: abre el PR por la API REST, sin dependencias.
- `ledger.js`: agrega eventos a `.parche/ledger.jsonl`. *Por qué:* es la señal para promover arreglos de nivel 2 a nivel 3.

### Codemods y detectores

| Archivo | Qué hace |
|---|---|
| `codemods/arca-rules.js` | Las reglas del pack de ARCA, compartidas por JS y PHP: `decideCondition()` (DocTipo 99 → 5 automático; DocTipo 96 con comprobante B/C → 5 para revisar; lo demás → falta el dato, con los códigos válidos según la clase), los mensajes y la detección de SOAP propio. |
| `codemods/arca-wsfe-condicion-iva.js` | ARCA en JS/TS (`afip.js`): busca `ElectronicBilling.createVoucher/createNextVoucher`, lee el objeto literal (o la variable que lo define) e inserta una línea con `insertAfterProp()`. |
| `codemods/arca-wsfe-condicion-iva-php.js` | ARCA en PHP (`afip.php` y forks): `voucherMethod()` reconoce la llamada; `collect()` junta las asignaciones por scope; `resolveData()` decide si se puede leer el array con certeza; `insertAfterEntry()` y `arrowSpacing()` insertan copiando el estilo. |
| `codemods/mercadopago-payments-to-orders.js` | Mercado Pago: migra **solo la creación** de pagos de Payments API a Orders API (mapea campos, medio de pago, estados y la clave de idempotencia con `randomUUID`). Las consultas, capturas y reembolsos de pagos existentes quedan como están (lo indica la guía oficial). `application_fee` queda bloqueado (Orders no tiene equivalente). También detecta REST directo a `/v1/payments`, el SDK v1 y webhooks. |
| `detectors/ai-model-retirements.js` | Busca IDs de modelos de IA retirados o por retirarse en strings, y la Assistants API de OpenAI. Solo avisa (D19). |

### Packs (`packs/*.json`)
Campos obligatorios: `id`, `version` (fecha), `provider`, `title`, `kind`, `severity`, `deadline`, `last_verified`, `summary_es`, `why_es`, `sources` (con URL), `detect`, `codemod` y `review_checklist_es`. Lo que cada pack necesita además (códigos, mapeos) va en campos propios, por ejemplo `codes` y `codes_by_class` en ARCA.

### Distribución
- `action.yml`: Action *composite*. Instala Parche desde el propio repo (`npm ci` en `$GITHUB_ACTION_PATH`) y corre `parche pr`. Los inputs pasan por variables de entorno.
- `.github/workflows/ci.yml`: tests y demo en Ubuntu y Windows con Node 22 y 24, prueba de la Action y del paquete. `release.yml`: publica al pushear un tag.
- `templates/github-workflow.yml`: el workflow semanal que copia el cliente.

## 4. Decisiones técnicas y por qué

| # | Decisión | Por qué |
|---|---|---|
| D1 | Los packs son **datos verificados** y los arreglos son **codemods determinísticos**, no un LLM. | Un PR malo en facturación o pagos mata la confianza. El "LLM que escribe el fix" ya es commodity; lo escaso es la base verificada. El LLM entra después del 1/11 como nivel 2, detrás de `--generate` y con la misma verificación. |
| D2 | ARCA edita con **inserciones de texto mínimas**; Mercado Pago **reimprime con recast**. | En ARCA alcanza con agregar una línea, y una inserción de texto garantiza un diff de una línea. La migración de Mercado Pago cambia la estructura (campos, anidamiento, instancias), y armarla a mano con texto sería frágil. |
| D3 | Con recast, nunca `node.start`/`node.end`; siempre `offsetAt(source, node.loc…)`. | recast parsea una copia con las líneas unidas por `os.EOL` y las tabs expandidas. En Windows (CRLF) los offsets quedaban corridos un carácter por línea, y el codemod insertaba en medio de `hoy()`. |
| D4 | `toSource({ lineTerminator: eolOf(source) })`. | recast imprime con `os.EOL`: en Windows convertía el archivo entero a CRLF y el PR mostraba todo cambiado. |
| D5 | `tidy()`: diff de líneas para sacar solo las líneas en blanco que agregó recast; si una línea en blanco puede emparejarse más adelante, se toma como nueva. | recast agrega líneas en blanco alrededor de lo que reimprime. Con el desempate, lo insertado con `insertAfter` queda pegado a la línea anterior (el import nuevo junto a los otros). |
| D6 | En PHP se edita con `loc.*.offset` de php-parser, no con `offsetAt`. | php-parser lee el texto original y sus offsets son exactos con CRLF, tabs y acentos (probado). `offsetAt` corrige cosas de recast y en PHP correría mal las posiciones. |
| D7 | PHP: el método se reconoce sin distinguir mayúsculas; la propiedad `ElectronicBilling`, sí. | Así funciona PHP: los métodos no distinguen mayúsculas y las propiedades sí. |
| D8 | PHP: `$data` se lee solo si se define **una vez**, **antes** de la llamada y en el **mismo scope**, y nadie toca después `DocTipo`, `CbteTipo` ni `DocNro`. | Cero inventos: si los datos se arman en varios pasos o llegan de afuera, no se puede saber qué va a ARCA. Se reporta como "falta un dato" y no se toca. Las demás claves que se agregan después (por ejemplo `Iva`) no cambian la decisión. |
| D9 | Se respeta la coma final, las comillas, la indentación y la alineación de los `=>`. | Un diff que cambia el estilo parece hecho por una máquina y se revisa con desconfianza. |
| D10 | Se saltean `node_modules/` y `vendor/`. | No es código del cliente, y tocar la librería instalada sería un error. |
| D11 | `verify` elige los tests según el lenguaje de lo que cambió y dice la verdad si no hubo tests. | Un cambio en PHP no se valida con `npm test`, y "✅ pasan" sin tests es mentir. |
| D12 | Rutas con `/` y orden estable en todos los sistemas operativos. | El reporte y el PR tienen que ser idénticos en Windows y Linux. |
| D13 | Lo que Parche escribe en el repo de un cliente no lleva atribuciones de herramientas; los commits firman como el bot de Parche. | Un `Co-Authored-By` de otra herramienta en el historial de un cliente es falso y confunde. Lo controla un test. |
| D14 | Dependencias mínimas: `jscodeshift`, `@babel/parser`, `php-parser` y `typescript`. | Menos superficie de ataque y menos peso para algo que corre en el CI de otros. `php-parser` y `typescript` no tienen dependencias propias; `typescript` se carga solo para el diff (D27). |
| D15 | Tests con fixtures, sin red, y con variantes CRLF y tabs para cada codemod. | Los bugs de Windows no aparecían en Linux; con variantes generadas, la suite los atrapa en cualquier sistema. |
| D16 | La Action instala Parche desde el repo y pasa los inputs por variables de entorno. | Funciona aunque npm esté caído o la versión no esté publicada, y un input no puede inyectar código en el script. |
| D17 | Releases con *trusted publishing* desde `release.yml`; el tag se pushea solo con OK. | Sin tokens guardados ni 2FA a mano; cada versión en npm sale de un commit de `main` con la CI verde. |
| D18 | `.gitattributes` fuerza LF. | El runner de Windows baja los archivos con CRLF y alteraba los fixtures. Los tests generan las variantes CRLF a propósito. |
| D19 | El pack de IA solo detecta. | Cambiar de modelo cambia el comportamiento del producto del cliente; eso lo decide una persona. |
| D20 | Mercado Pago migra solo la creación. | Según la guía oficial, los pagos existentes se siguen consultando, capturando y reembolsando por la API con la que se crearon. |
| D21 | El inventario lista **cualquier API**, tenga pack o no. | Es el nivel 1 del producto y la base del alcance "todo el ecosistema": para avisar que una API cambió, primero hay que saber que el repo la usa y dónde. |
| D22 | Qué es un SDK lo decide una **lista curada como datos** (`data/known-sdks.json`) más una heurística con confianza explícita. | Igual que los packs: ampliar la cobertura es sumar datos, no tocar código. La heurística (api/sdk/client en el nombre) encuentra lo que la lista no tiene, pero queda marcada como confianza baja o media para no presentar como seguro algo que es una corazonada. |
| D23 | El inventario lee con `@babel/parser` directo, no con jscodeshift. | Solo lee, así que no hay offsets que cuidar (D3) ni nada que reimprimir; es más rápido y más simple. |
| D24 | El inventario sigue variables por nombre en todo el archivo, sin scopes. | Alcanza para avisar (nivel 1) y mantiene el código chico. Los codemods que **editan** no se apoyan en esto: ellos sí exigen certeza (D8). |
| D25 | Las URLs dinámicas van aparte (`unresolved`) y no se adivina el host. | Cero inventos: se dice qué no se pudo resolver, en lugar de omitirlo o suponer. Lo relativo y lo local se descarta, porque es el propio backend. |
| D26 | `inventory.json` tiene `schemaVersion` y mantiene los campos anteriores. | Otros (la Action, una futura GitHub App, el cliente) van a leer ese archivo; el número de versión permite cambiar el formato sin romperlos. |
| D27 | TypeScript **6.0** (`~6.0.3`), cargado recién cuando se usa `diff` o `--upgrades`. | TypeScript 7 es el compilador nativo en Go y no trae el compiler API de JavaScript; la 6.0 es la última con la API clásica (`createProgram`, `TypeChecker`). Pesa 24 MB: con la carga diferida, `parche scan` común no paga ese costo. |
| D28 | El diff compara los **`.d.ts` publicados**, no el código JavaScript. | Los tipos son el contrato público del SDK y se leen sin ejecutar nada del paquete: no se corre código de terceros. |
| D29 | Lector de tar propio, sin dependencias, que extrae solo `.d.ts` y `package.json`. | Es una función chica; sumar una librería de tar agrega superficie de ataque para algo que procesa archivos bajados de internet. |
| D30 | Integridad sha512 verificada y caché inmutable de tarballs; metadata cacheada una hora; modo sin red. | Una versión publicada no cambia, así que se baja una vez. La integridad evita usar un tarball alterado. El modo sin red permite tests con fixtures y uso en CI sin acceso al registry. |
| D31 | La superficie usa **la misma forma de rutas que el inventario** (instancia del export por defecto sin prefijo; exports con nombre con prefijo) e incluye instancias de clases y lo que devuelven las fábricas. | Así el cruce con lo que usa el repo es una comparación de strings, sin traducir. Las fábricas (`twilio(sid, token)`) son una forma común de crear clientes. |
| D32 | No se baja por tipos de la librería estándar; sí por recursos invocables. | Una función que devuelve `Promise` no tiene que sumar `then`/`catch` al SDK. Y `client.messages(sid)` también tiene `messages.create`: si no se baja por los invocables, se pierden métodos reales (le pasaba a Twilio). |
| D33 | Se reporta: lo que desaparece (solo el padre), parámetros obligatorios nuevos, parámetros que se van, cambios de tipo (solo con una firma de cada lado) y deprecaciones. Un parámetro opcional nuevo no se reporta. | Son los cambios que rompen o van a romper el código existente. Con sobrecargas, comparar tipos por posición genera más ruido que señal. |
| D34 | Si la versión nueva no expone nada en un lado de la superficie, ese lado no se compara. | Pasa cuando cambia la forma del módulo (Stripe 23 dejó de tener exports con nombre leíbles): sin esto aparecerían decenas de "ya no existe" falsos. |
| D35 | Las operaciones del repo que no aparecen en los tipos de la versión instalada se informan como "sin verificar". | Cero inventos: decir "lo que usás no cambia" sobre algo que no se pudo verificar sería una falsa tranquilidad. |
| D36 | Para mostrar se deduplican los cambios; para cruzar con el repo se usa la lista completa. | El mismo método se alcanza por la instancia, la clase y la fábrica: mostrarlo tres veces es ruido, pero el repo puede usar cualquiera de los tres caminos. |
| D37 | Versión instalada: `node_modules` → `package-lock.json` → base del rango declarado (o la más alta de la misma mayor). | Lo instalado es lo que de verdad corre; si no hay instalación (CI sin `npm ci`, un clon), el lock; y si tampoco, lo declarado. |
| D38 | Un codemod que edita texto lleva registro de los objetos que ya editó. | Salió de un repo real: el mismo `payload` iba a dos `createVoucher` y se insertaba dos veces. Babel no lo marca, pero TypeScript no compila un objeto con claves duplicadas: el PR habría roto el build. |
| D39 | El chequeo de sintaxis y el inventario aceptan decoradores (`decorators-legacy`). | NestJS, Angular y TypeORM los usan en todos los servicios. Sin el plugin, el inventario no veía nada y `--verify`/`--dry-run` frenaban el PR en esos repos. |
| D40 | El inventario lee **todos** los manifiestos del repo (salteando `node_modules`, `vendor`, etc.) y sigue clientes guardados en clases (`private x = new X()`, `this.x = new X()`). | Los repos reales son monorepos (`packages/backend/package.json`, `ms-billing/package.json`) y los servicios guardan el cliente en la clase. Sin esto, repos con ARCA, Mercado Pago y AWS daban "0 APIs". |
| D41 | Cuando no se puede leer el comprobante, el hallazgo dice **dónde** agregar el dato: la función que lo arma (y de qué módulo viene) o que llega como parámetro. | "Falta un dato" sin decir dónde es poco accionable; con la ubicación, el mantenedor lo resuelve en un minuto. Se sigue sin adivinar el valor: depende del cliente. |
| D42 | La lista de "no son APIs" se compara por familia (`pg` y `pg-*`, no cualquier cosa que empiece con "pg") y va antes que los prefijos de proveedores. | Con nombres cortos (`ws`, `pg`) un prefijo suelto se llevaba puesto un SDK real (`wsfe-sdk`). Y `@aws-sdk/types` es de la familia de AWS pero son solo tipos. |

## 5. Cómo extender

**Un pack nuevo para JS:** `packs/<proveedor>.<cambio>.json` → transform en `src/codemods/` o `src/detectors/` con el contrato de la sección 2 → registrarlo en `TRANSFORMS` → fixture en `examples/` → tests (caso feliz, casos que no se tocan, idempotencia, CRLF y tabs) → README, CHANGELOG y este documento.

**Un lenguaje nuevo** (así se sumó PHP):
1. Un módulo de lectura (`src/<lenguaje>.js`) con parse, recorrido y literales.
2. La extensión en `EXT` y las carpetas de dependencias en `SKIP_DIRS` (`src/engine.js`).
3. El manifiesto de dependencias en `readDeps()`.
4. La rama en `parseCheck()` (`src/ast.js`) y los comandos de test en `testCommands()` (`src/verify.js`).
5. `languageOf()` y la versión del pack en `TRANSFORMS` (`src/packs.js`).
6. **Verificar primero cómo da las posiciones el parser** (D3, D6): con CRLF, con tabs y con acentos.

## 6. Límites conocidos (dónde meterle más fino)

- **ARCA (JS y PHP):** si el comprobante lo arma una función de otro archivo (`buildVoucherPayload()`), no se edita esa función: se reporta "falta un dato" con su nombre y su módulo (D41).
- **ARCA en PHP:** no sigue alias (`$eb = $afip->ElectronicBilling; $eb->CreateVoucher(...)`), ni constantes para DocTipo o CbteTipo (`self::DOC_TIPO`), ni arrays armados por otra función. Hoy todos esos casos son "falta un dato".
- **ARCA en JS:** lo mismo con alias y objetos armados en varios pasos.
- **Integraciones SOAP propias** (JS o PHP): se detectan pero no se reescriben.
- **Python y Java:** no están cubiertos.
- **Inventario** (detalle en [`docs/inventario.md`](inventario.md)): sigue variables por nombre sin scopes y no sigue instancias entre archivos; las URLs armadas en otro archivo o con funciones quedan como dinámicas; PHP y Python se listan solo desde el manifiesto.
- **Diff de SDKs (hito C):**
  - Un **renombre o una mudanza** (por ejemplo `createChatCompletion` → `chat.completions.create`) se ve como "ya no existe": decir a dónde se movió es trabajo de un pack (nivel 3) o del arreglo con IA (nivel 2).
  - Los **cambios de tipo** con nombres de tipos nuevos pueden ser ruido aunque la forma sea compatible.
  - Solo npm: los SDKs de PHP y Python todavía no se comparan.
  - Un paquete sin `.d.ts` ni `@types` no se puede comparar (queda "sin tipos").
  - Las **deprecaciones** se leen solo de la etiqueta `@deprecated` del JSDoc.
  - Hereda los límites del inventario: si el cliente se crea en otro archivo, las operaciones de ese archivo no se cruzan.
- **Códigos por clase de comprobante:** salen de una tabla publicada y falta validarlos contra `FEParamGetCondicionIvaReceptor` en homologación.

## 7. Qué cubre cada archivo de tests

| Archivo | Cubre |
|---|---|
| `test/parche.test.js` | Validación de packs; ARCA en JS (tres casos, una línea, coma final, CRLF y tabs); Mercado Pago (JS, TS, CommonJS, marketplace bloqueado, webhooks, fin de línea, lugar del import); IA; motor (idempotencia); CLI `pr --dry-run`, incluida la ausencia de atribución en commits y PRs. |
| `test/inventory.test.js` | Inventario: clasificación de paquetes, SDKs con sus operaciones (imports, require, instancias), HTTP con los cinco clientes, URLs dinámicas, locales y relativas, modelos de IA, manifiestos de PHP y Python, motor sobre `saas-demo` y `tienda-demo`, y la CLI con `inventory.json` y el reporte. |
| `test/sdk-diff.test.js` | Diff de SDKs: lector de tar (con nombres largos), dónde están los tipos (incluido el caso Stripe 23), versiones, registry con integridad y caché sin red, superficie de un SDK de ejemplo (`test/fixtures/sdk-diff/demo-sdk`, versiones 1 y 2 con cambios a propósito), comparación, versión instalada, `scan --upgrades` y la CLI sin red. |
| `test/arca-php.test.js` | ARCA en PHP: tres casos más datos de afuera, una línea y minúsculas, CRLF y tabs, reglas de scope, estilo (comillas, alineación, coma final, comentario), lo que no se puede leer, motor con `composer.json` y `vendor/`, y selección de tests en `verify`. |
