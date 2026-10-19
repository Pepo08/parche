# Cambios

Todas las versiones de `parche-cli` (npm) y de la Action `Pepo08/parche@v0`.

## 0.6.3 — 2026-10-18

Pack de IA con el resto de la página de deprecaciones de OpenAI (verificada fila por fila el 18/10): los modelos que se apagan desde 2026. Como siempre, Parche avisa con la fecha y el reemplazo oficial, y no cambia el modelo.

### Nuevo
- **Lo que viene:**
  - 1/12/2026: `gpt-image-1-mini`, `gpt-image-1.5` y `chatgpt-image-latest` (reemplazo `gpt-image-2.5-sunburst` o `gpt-image-2.5-flare`).
  - 6/1/2027: voz con `tts-1`, `tts-1-hd` y los snapshots `gpt-4o-mini-tts-2025-03-20` y `-2025-12-15` (`gpt-realtime-2.1-mini`).
  - 14/1/2027: los snapshots `gpt-4o-2024-08-06`, `gpt-4o-2024-11-20`, `gpt-4o-mini-2024-07-18`, `gpt-4.1-2025-04-14` y `gpt-4.1-mini-2025-04-14` (`gpt-6-luna`), y sus modelos fine-tuned (`ft:…`), que se apagan con su modelo base. Los alias `gpt-4o`, `gpt-4o-mini`, `gpt-4.1` y `gpt-4.1-mini` no figuran en la página y no se avisan; un fine-tuned sobre el alias se avisa solo cuando ese alias tiene un único snapshot (no es el caso de `gpt-4o`).
  - 20/1/2027: las familias `gpt-realtime`, `gpt-realtime-mini`, `gpt-audio` y `gpt-audio-mini` (alias y snapshots) y `gpt-4o-mini-transcribe-2025-03-20`.
  - 26/2/2027: transcripción con `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` y `gpt-4o-transcribe-diarize` (`gpt-live-transcribe` o `gpt-transcribe`). El aviso de `whisper-1` dice además que `/v1/audio/translations` cierra ese día.
  - 1/4/2027: `gpt-5.1`, `gpt-5.3-codex` (`gpt-6-sol`) y `gpt-5.4-nano` (`gpt-6-luna`).
- **Lo que ya se apagó y faltaba:** 23/7/2026 (`computer-use-preview`, los `*-search-preview-2025-03-11`, `gpt-5-chat-latest`, `gpt-5.1-chat-latest`, los `gpt-5*-codex`, `o3-deep-research`, `o4-mini-deep-research` y los snapshots `-2025-10-06` de `gpt-audio-mini` y `gpt-realtime-mini`), 10/8 (`gpt-5.2-chat-latest`, `gpt-5.3-chat-latest`), 24/9 (Sora 2: `sora-2`, `sora-2-pro` y sus snapshots, sin reemplazo), 1/10 (`gpt-5.4-cyber`), 7/5 (`gpt-4o-mini-realtime-preview`, `gpt-4o-audio-preview`, `gpt-4o-mini-audio-preview`), 26/3 (`gpt-4-turbo-preview-completions`) y el header `OpenAI-Beta: realtime=v1` de la Realtime API Beta (12/5).
- El inventario reconoce como modelos de OpenAI `gpt-realtime*`, `gpt-audio*`, `gpt-6*`, `sora-2*`, `computer-use-preview*` y `o4-mini-deep-research`.

### Todavía no cubre
- Los productos que OpenAI cierra y no son modelos: prompts reutilizables (`v1/prompts`, 30/11/2026), la plataforma de Evals (solo lectura el 31/10, cierre el 30/11/2026), Agent Builder (30/11/2026) y la Videos API (cerrada el 24/9/2026; sí se avisan los modelos `sora-2`).
- Las familias `gpt-4o-audio`, `gpt-4o-realtime`, `gpt-4o-mini-realtime` y `gpt-4o-mini-audio` (20/1/2027): la página no dice qué IDs siguen activos (sus alias `-preview` se apagaron el 7/5/2026).
- Los snapshots de un alias que la página nombra sin ellos (por ejemplo `gpt-5.1-2025-11-13`, `gpt-5.4-nano-2026-03-17`) y lo que OpenAI apagó antes de 2026.

## 0.6.2 — 2026-10-18

Pack de IA completo para el apagado de OpenAI del **23/10/2026** (sección "2026-04-22: Legacy GPT model snapshots" de la página oficial, verificada el 18/10).

### Nuevo
- **Alias `-completions`:** `gpt-3.5-turbo-completions` (reemplazo `gpt-5.6-terra`), `gpt-4-completions`, `gpt-4-0613-completions` y `gpt-4-turbo-completions` (reemplazo `gpt-5.6-sol`).
- **Modelos fine-tuned:** se avisan los IDs reales (`ft:<modelo base>:<org>:<sufijo>:<id>`, también con `:ckpt-step-…`) de las familias que OpenAI apaga: `ft-gpt-3.5-turbo` y `ft-babbage-002`, `ft-davinci-002` y `ft-o4-mini-2025-04-16` (base de reemplazo `gpt-5.6-terra`), `ft-gpt-4` (`gpt-5.6-sol`) y `ft-gpt-4.1-nano-2025-04-14` (`gpt-5.6-luna`). Se compara el modelo base entero: `ft:gpt-4o-mini-…`, `ft:gpt-4o-…` y `ft:gpt-4.1-…` no son de `gpt-4` y no se avisan (OpenAI los apaga en otra fecha). Como siempre, Parche avisa y no cambia el modelo.
- El pack cita la guía de fine-tuning de OpenAI como fuente del formato de los IDs. `last_verified`: 2026-10-18 (Anthropic y el resto de OpenAI, revisados contra sus páginas ese día: sin cambios).

## 0.6.1 — 2026-10-18

Lo que encontró el frente de tracción al preparar los PRs con la 0.6.0.

### Arreglado
- **ARCA en JS: si el objeto recibe el campo después, cuenta como migrado**, igual que en PHP: `voucher.CondicionIVAReceptorId = …`, `voucher['CondicionIVAReceptorId'] = …`, con cast de TS u `Object.assign(voucher, { CondicionIVAReceptorId: … })`. Antes se agregaba el arreglo parcial igual, y era redundante. Una variable con el mismo nombre en otra función no cuenta.
- **Copias de respaldo:** no se leen ni se editan las carpetas `BAK/`, `backup(s)/`, `old/`, `_old/` y `deprecated/`, ni los archivos `* copy.*`, `* - Copy.*`, `* copia.*`, `*.bak.*`, `*-old.*`, `*_old.*` y `*.old.*`. Tampoco cuentan sus manifiestos ni sus WSDL. El scan y `report.md` dicen qué se saltó.
- **Windows:** los comandos de git corren con `core.longpaths`. Sin eso, un clon recién hecho con rutas largas daba "Hay cambios sin commitear".
- **`parche pr --author "Nombre <email>"`** firma con esa identidad sin tocar la configuración de git. `pr` muestra quién firma y, antes de pushear, avisa si el email no es un noreply de GitHub (queda público en el PR).
- Si solo cambiarían tests o mocks, el texto queda como issue: ya no empieza con "Modifica 1 archivo".
- La consola ya no repite "No cubre: No cubre…" en los arreglos parciales.

## 0.6.0 — 2026-10-17

### Nuevo
- **ARCA con `DocTipo` en una variable: PR parcial (consumidor final).** Antes se reportaba como "falta un dato" y no se tocaba nada. Ahora Parche aplica la regla 99 → 5 **al ejecutarse** y, con otro `DocTipo`, el pedido sale igual que hoy (la clave ni existe). En JS agrega `...(Number(docTipo) === 99 ? { CondicionIVAReceptorId: 5 } : {})`; en PHP, un `if ((int) $data['DocTipo'] === 99)` después de armar el array, nunca `null`. El PR sale borrador, con "(parcial: consumidor final)" en el título y, en "Lo que este PR NO resuelve", los casos que no cubre con los códigos válidos. No se aplica a facturas A, a expresiones con efectos (llamadas, `await`) ni a arrays de PHP dentro de la llamada. Si se corre de nuevo después del merge, no cambia nada y sigue avisando lo que falta.
- El ledger registra cuántos arreglos parciales lleva cada PR (`partial`).

### Arreglado
- ARCA en JS: la clave nueva usa las mismas comillas que las claves del objeto. Antes copiaba las del resto del archivo y, en un repo real con claves `'...'` en un archivo con `"..."`, quedaba distinta a sus vecinas.

## 0.5.1 — 2026-10-17

Lo que apareció en el primer PR real (lunamarie11/obraya#1).

### Arreglado
- **Los commits ya no se firman con `bot@parche.dev`**, un dominio que no es nuestro. Ahora firma `PARCHE_GIT_NAME`/`PARCHE_GIT_EMAIL` si están; si no, la identidad de git de quien lo corre; y en GitHub Actions sin identidad, `github-actions[bot]`. Sin ninguna, `parche pr` frena antes de tocar el repo.
- **`parche pr` chequea la sintaxis siempre**, también sin `--verify` (no ejecuta nada del repo). El PR ya no dice "Sin verificar": dice que Parche no corrió los tests y nombra los workflows del repo que los corren en cada pull request (`pull_request`; `pull_request_target` no cuenta).
- El texto para un issue (sin cambios de código) ya no lleva la sección de verificación.

## 0.5.0 — 2026-10-16

Lo que encontró el frente de tracción al correr Parche sobre 175 repos públicos reales.

### Nuevo
- **La versión de la librería de ARCA importa:** con `afip.js`/`afip.php` 0.x (o `eesnaola/afip.php`) el campo no llega a ARCA (WSDL de 2021). Parche lee la versión instalada y el arreglo pasa a "revisar" con el aviso de actualizar a 1.x.
- Detección de **`.wsdl` de WSFEv1 sin el campo** en el repo.
- **Python, C#, Java, Go y VB.NET:** detección de integraciones SOAP propias y de clientes SOAP generados sin el campo.
- `parche pr --push-remote <remote>`: abre PRs **desde un fork**.
- **Pack de IA al día con las páginas oficiales:** `claude-sonnet-4-5-20250929` se retira el 30/11/2026; OpenAI retira `gpt-3.5-turbo`, `gpt-4`, `gpt-4-turbo`, `o1`, `o3-mini`, `o4-mini`, `gpt-4.1-nano`, `gpt-image-1` y otros el **23/10/2026**, y los snapshots de `gpt-5-*-2025-08-07` y `o3` el 11/12/2026; suma los ya retirados (DALL·E, `gpt-3.5-turbo-instruct`, `chatgpt-4o-latest`, Claude 2/3.5…). Cada aviso trae el reemplazo recomendado.

### Arreglado
- `parche pr` dejaba el archivo modificado en la rama base cuando fallaba la verificación; ahora el repo queda como estaba y la rama se borra. Tampoco quedan ramas vacías.
- No se abre un PR cuyo único cambio sea un test o un mock.
- ARCA en JS: se reconocen `(afip.ElectronicBilling as any).createVoucher(...)`, `afip.ElectronicBilling!` y alias (`const eb = afip.ElectronicBilling`). Si un archivo de ARCA no parsea, se avisa (antes se descartaba en silencio).
- Menos ruido: la detección de SOAP propio ya no marca tests, mocks, tipos, constantes ni copias de la librería; si el repo ya usa el campo en otro archivo, lo que no se pudo leer pasa a "revisar".
- Pack de IA: un modelo en una lista o catálogo se avisa como mención, no como uso; en Azure OpenAI no se da por cerrada la Assistants API.
- Mucho más rápido en repos grandes: los codemods de ARCA no parsean archivos que no mencionan ARCA.
- El texto para un issue (sin cambios de código) ya no habla de "este PR".
- `detect.packages` de ARCA: fuera `afip.js` (no existe en npm); suma `@arcasdk/core`, `afip.ts`, `ts-afip-ws` y `facturajs`.

### Cambiado
- `docs/arquitectura.md` sale del repo: era documentación interna del equipo. El formato del inventario sigue en `docs/inventario.md`.

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
