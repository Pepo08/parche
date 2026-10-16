# Cambios

Todas las versiones de `parche-cli` (npm) y de la Action `Pepo08/parche@v0`.

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
