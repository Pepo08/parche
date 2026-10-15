# Parche — Dependabot para APIs

[![CI](https://github.com/Pepo08/parche/actions/workflows/ci.yml/badge.svg)](https://github.com/Pepo08/parche/actions/workflows/ci.yml)

Parche lee tu código, arma un inventario de qué APIs de terceros usás (Mercado Pago, ARCA, modelos de IA…) y lo cruza contra una base de **cambios de API verificados**. Cuando un proveedor cambia algo que te afecta, Parche abre un PR con el arreglo, explica qué cambió y por qué, y marca lo que necesita una persona. Ningún PR sale sin pasar la verificación.

```
$ parche scan .
APIs encontradas:
  mercadopago   4 usos en 4 archivo(s)  [Payment.create, Payment.get]
  arca          3 usos en 1 archivo(s)  [ElectronicBilling.createNextVoucher]
  ia            2 usos en 1 archivo(s)  [modelo claude-3-5-haiku-20241022, OpenAI Assistants API]

■ Condición frente al IVA del receptor obligatoria en WSFEv1
  ARCA (ex AFIP) · severidad critical · vence 2026-12-01 (47 días)
  ✅ automático     src/facturacion.js:14  Agregado CondicionIVAReceptorId: 5 (Consumidor Final)…
  👀 revisar       src/facturacion.js:56  Agregado CondicionIVAReceptorId: 5 por inferencia (DNI + comprobante B/C)…
  ✋ falta un dato  src/facturacion.js:62  Falta CondicionIVAReceptorId y no se puede inferir… (comprobante clase A).
…
✅ automático: 5   👀 revisar: 8   ✋ falta un dato: 1   ⛔ bloqueado: 1   🔎 detectado: 2
```

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
npx parche-cli fix .                 # aplica los arreglos en tu working copy
npx parche-cli pr . --verify         # una rama + commit + PR por cambio
npx parche-cli feedback . --pack <id> --outcome merged|edited|rejected
```

`parche pr` abre el PR por la API de GitHub si hay `GITHUB_TOKEN` y un remote `origin` en github.com; si no (o con `--dry-run`), deja la rama, el commit y el cuerpo del PR en `.parche/pr-<pack>.md`. Si hay ítems para revisar, el PR se abre como borrador.

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
npm test                         # 13 tests; el CI los corre en Linux y Windows
bash demo.sh                     # demo completa sobre examples/tienda-demo
```

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
| `arca.wsfe.condicion-iva-receptor` | ARCA | rompe | 2026-12-01 | sí (consumidor final y DNI B/C) |
| `mercadopago.payments-to-orders` | Mercado Pago | migración | — | sí (creación de pagos en SDK Node v2) |
| `ai.model-retirements` | Anthropic, OpenAI | retiro | varias | solo detección |

## Verificación

Antes de commitear, `--verify` parsea cada archivo modificado (JS/TS) y corre el `npm test` del repo. Si algo falla, no hay PR. El commit lleva la versión del pack que lo generó, para poder rastrear qué regla produjo cada cambio.

## Límites del MVP

- Solo Node.js (JS/TS, ESM y CommonJS). Siguen PHP (la mayoría de los sistemas de facturación locales), Python y Java.
- ARCA: cubre `@afipsdk/afip.js`. Las integraciones SOAP propias se detectan pero no se reescriben.
- Mercado Pago: migra la creación de pagos con el SDK v2. Las consultas, capturas y reembolsos de pagos existentes se dejan a propósito en Payments API, como indica la guía oficial.
- Se distribuye como CLI (`npx parche-cli`) + GitHub Action (`Pepo08/parche@v0`). La GitHub App (instalación en un click, PRs automáticos al publicarse un pack nuevo) es el próximo paso.
- La capa de LLM (redactar packs desde changelogs y resolver casos "falta un dato" leyendo el modelo de datos del cliente) todavía no está incluida; cuando entre, va a pasar por la misma verificación.
