# Cambios

Todas las versiones de `parche-cli` (npm) y de la Action `Pepo08/parche@v0`.

## 0.4.1 — 2026-10-16

Arreglos encontrados al correr Parche sobre los primeros repos públicos reales con ARCA y Mercado Pago.

### Arreglado
- **ARCA:** si el mismo objeto de comprobante se pasaba a dos llamadas, el campo se insertaba dos veces (clave duplicada: TypeScript no compila). Ahora se inserta una sola vez, en JS y en PHP.
- **Decoradores** (NestJS, Angular, TypeORM): el chequeo de sintaxis fallaba y `--verify`/`--dry-run` frenaban el PR; el inventario no veía nada en esos archivos.
- **Inventario en monorepos:** se leen todos los `package.json`, `composer.json` y `requirements.txt` del repo, no solo los de la raíz (`manifestFiles` dice cuáles).
- **Inventario:** se siguen los clientes guardados en clases (`private x = new X()`, `this.x = new X()`).
- `http://localhost:${PORT}` ya no aparece como un host externo.
- `socket.io-client`, `@prisma/client`, `@trpc/client`, `pg`, `ws`, `@aws-sdk/types` y similares ya no se listan como APIs; toda la familia `@aws-sdk/` cuenta como AWS.

### Mejorado
- **ARCA:** cuando el comprobante lo arma otra función o llega como parámetro, el hallazgo dice dónde agregar el dato (por ejemplo: "lo arma `buildVoucherPayload()` (de `@/lib/afip/voucher-builder`)").

## 0.4.0 — 2026-10-16

### Nuevo
- **Qué cambia en las versiones nuevas de tus SDKs** (`parche scan --upgrades`): para cada SDK de npm que el repo usa, compara la versión instalada con la última publicada leyendo sus tipos (`.d.ts`) y dice qué operaciones **del repo** desaparecen, piden parámetros obligatorios nuevos, pierden parámetros, cambian de tipo o pasan a deprecadas, con archivo y línea. Solo avisa (detect-only).
- **`parche diff <paquete> --from <v> --to <v>`**: el mismo análisis para cualquier paquete, sin repo (acepta `latest` y versiones parciales; `--all`, `--json`).
- Tarballs bajados del registry con verificación de integridad y cacheados en `~/.parche/cache` (`PARCHE_CACHE`, `PARCHE_OFFLINE=1`). Si el paquete no trae tipos, usa `@types/<paquete>`.
- Ejemplo nuevo: `examples/legacy-ia` (SDK de OpenAI v3: `OpenAIApi` desaparece en las versiones nuevas, como dice la guía oficial de migración).
- Dependencia nueva: `typescript ~6.0.3` (la última con el compiler API de JavaScript), cargada solo para el diff.

## 0.3.0 — 2026-10-16

### Nuevo
- **Inventario de cualquier API** (nivel 1): `parche scan` lista todas las APIs de terceros del repo, tengan pack o no.
  - **SDKs** de `package.json`, `composer.json` y `requirements.txt`, clasificados con una lista curada (`data/known-sdks.json`: pagos, facturación, IA, mensajería, email, nube, datos y más) y una heurística por nombre, con nivel de confianza.
  - En JS/TS, **qué operaciones** se usan de cada SDK (`stripe.paymentIntents.create`, `client.messages.create`…), siguiendo imports, `require` e instancias.
  - **Llamadas HTTP directas** con `fetch`, `axios` (incluido `axios.create({ baseURL })`), `got`, `undici` y `node-fetch`: método, host y ruta. Las URLs dinámicas se reportan aparte; lo local y lo relativo se descarta.
  - **Modelos de IA** nombrados en el código (OpenAI, Anthropic, Gemini, Mistral, Cohere).
- `.parche/inventory.json` con `schemaVersion: 1`, documentado en `docs/inventario.md` (los campos anteriores se mantienen).
- La salida de `scan` y `.parche/report.md` muestran el inventario completo.
- Ejemplo nuevo: `examples/saas-demo` (Stripe, Twilio, OpenAI, GitHub, Mercado Libre y HTTP directo).
- `docs/arquitectura.md`: qué hace cada parte del código y por qué.

## 0.2.0 — 2026-10-16

### Nuevo
- **Pack ARCA para PHP**: `afipsdk/afip.php` y sus forks (`fertandil87/afip.php`, `ivanalemunioz/afip.php`, `eesnaola/afip.php`). Agrega `CondicionIVAReceptorId` a `$afip->ElectronicBilling->CreateVoucher($data)` y `CreateNextVoucher($data)` con las mismas reglas que en JS: DocTipo 99 → automático; DNI con comprobante B o C → para revisar; factura A o CUIT → pide el dato y muestra los códigos válidos.
  - Lee el array en la llamada (`array()` o `[]`) o en una variable definida una vez en la misma función; si no puede leerlo con certeza, lo reporta y no toca nada.
  - Copia el estilo del cliente: comillas, indentación (espacios o tabs), `=>` alineados, coma final y fin de línea.
- El motor escanea archivos `.php`, lee `composer.json` y saltea `vendor/`.
- `--verify` corre `composer test` o `vendor/bin/phpunit` cuando cambian archivos PHP (y `npm test` cuando cambian archivos JS/TS).
- Ejemplo nuevo: `examples/tienda-php`.

### Arreglado
- El cuerpo del PR decía "✅ pasan" cuando el repo no tenía tests; ahora dice que no hubo tests y que se validó la sintaxis.
- Mercado Pago: el `import { randomUUID }` nuevo queda junto a los otros imports.
- ARCA (JS): si la última propiedad no tenía coma final, la propiedad nueva tampoco la lleva.

## 0.1.1 — 2026-10-15

- Publicado en npm como `parche-cli` (npm no acepta `parche`). El comando instalado sigue siendo `parche`.

## 0.1.0 — 2026-10-15

- Primera versión: CLI (`packs`, `scan`, `fix`, `pr`, `feedback`), GitHub Action y packs de ARCA (afip.js), Mercado Pago Payments → Orders y retiros de modelos de IA.
- CI en Linux y Windows. Arreglados 4 bugs que solo aparecían en Windows (offsets de recast, CRLF, rutas con `\`, `npm test` sin shell).
