# Inventario de APIs (`.parche/inventory.json`)

`parche scan` lista **todas** las APIs de terceros que usa el repo, tengan pack de Parche o no. Es el nivel 1 del producto: saber qué se usa y dónde es lo que permite avisar cuando una de esas APIs cambia.

Qué detecta:

| Tipo (`kind`) | Cómo se detecta | Ejemplo de operación |
|---|---|---|
| `sdk` | Dependencias de `package.json`, `composer.json` y `requirements.txt` clasificadas con [`data/known-sdks.json`](../data/known-sdks.json); en JS/TS, además, los imports y `require` con la cadena de miembros que se llama | `paymentIntents.create`, `Payment.create`, `messages.create` |
| `http` | Llamadas con `fetch`, `axios`, `got`, `undici`, `node-fetch` (también `ky` y `superagent`), cuando la URL es un literal, una plantilla o se arma con constantes del archivo | `GET /repos/{}/{}/issues`, `POST /items` |
| `ai-model` | IDs de modelos de IA en strings (`gpt-4o`, `claude-…`, `gemini-…`, `mistral-…`, `command-r…`; `o1`/`o3` solo si el archivo usa OpenAI) | `gpt-4o-mini` |

PHP y Python, por ahora, solo se **listan** desde su manifiesto: el análisis de código es de JS/TS.

Se leen **todos** los manifiestos del repo, no solo los de la raíz (monorepos: `packages/*/package.json`, microservicios), salteando `node_modules`, `vendor`, `dist`, `build`, `coverage`, `.next` y `.parche`. Si un paquete aparece en varios, gana el más cercano a la raíz. También se siguen los clientes guardados en clases (`private afip = new Afip(...)`, `this.afip = new Afip(...)` → `this.afip.ElectronicBilling.createVoucher`), y el código con decoradores (NestJS, Angular) se lee bien.

## Esquema (versión 1)

```jsonc
{
  "schemaVersion": 1,                 // sube si el formato cambia de forma incompatible
  "generatedAt": "2026-10-16T18:00:00.000Z",
  "repo": "saas-demo",
  "apis": [
    {
      "id": "npm:stripe",             // npm:<paquete> | composer:<paquete> | pypi:<paquete> | http:<host> | ai:<proveedor>
      "kind": "sdk",                  // sdk | http | ai-model
      "provider": "Stripe",           // null si no está en la lista curada
      "category": "pagos",            // pagos, facturación, ia, mensajería, email, nube, datos, ... | null
      "ecosystem": "npm",             // solo sdk: npm | composer | pypi
      "package": "stripe",            // solo sdk
      "version": "^17.0.0",           // solo sdk: lo que dice el manifiesto (null si se usa sin declararlo)
      "host": "api.github.com",       // solo http
      "confidence": "alta",           // alta | media | baja (ver abajo)
      "source": "curated",            // curated | heuristic | usage
      "packs": [],                    // ids de packs de Parche que cubren esta API
      "operations": [
        { "op": "paymentIntents.create", "count": 1, "locations": [{ "file": "src/cobros.js", "line": 6 }] }
      ]
    }
  ],
  "unresolved": [                     // llamadas HTTP con URL dinámica: no se sabe a qué host van
    { "file": "src/integraciones.js", "line": 32, "kind": "http", "client": "fetch", "reason": "URL dinámica: ..." }
  ],
  "dependencies": { "npm": {}, "composer": {}, "pypi": {} },   // todo lo declarado, sea API o no (de todos los manifiestos)
  "manifestFiles": { "npm": ["package.json", "packages/backend/package.json"], "composer": [], "pypi": [] },  // qué manifiestos se leyeron
  "upgrades": [                       // solo con `scan --upgrades`: versión instalada vs última, por SDK de npm
    { "package": "openai", "installed": "3.3.0", "latest": "7.34.0", "status": "afectado",   // afectado | sin-impacto | al-dia | sin-verificar | sin-tipos | no-publicado | sin-version | error
      "totalChanges": 9, "unverified": [],
      "affected": [{ "op": "OpenAIApi.createChatCompletion", "locations": [{ "file": "src/asistente.js", "line": 8 }],
                     "changes": [{ "ns": "exports", "path": "OpenAIApi", "type": "removed", "message": "`OpenAIApi` ya no existe." }] }] }
  ],

  // Campos anteriores a schemaVersion (lo que reportan los packs). Se mantienen por compatibilidad:
  "generated_at": "...", "packages": {}, "providers": {}, "usages": []
}
```

- Las rutas de `locations` siempre van con `/`, en cualquier sistema operativo.
- En las rutas HTTP, `{}` marca una parte que se arma en tiempo de ejecución (`/repos/${owner}` → `/repos/{}`). La query string se descarta.
- `apis` viene ordenado: primero SDKs, después HTTP, después modelos; dentro de cada tipo, por proveedor o nombre.

## Confianza

| Confianza | Cuándo |
|---|---|
| `alta` | El paquete o el host está en la lista curada, o es un ID de modelo con prefijo inequívoco. |
| `media` | Un host que no está en la lista curada (sabemos que es externo, no de quién), o un paquete detectado por el nombre que además se ve usado en el código. |
| `baja` | Un paquete detectado solo por el nombre (`api`, `sdk` o `client` en el nombre), que no se ve usado. |

**Qué no se lista:** clientes HTTP (`axios`, `got`… son el medio, no la API), herramientas de desarrollo y frameworks (`eslint`, `@types/*`, `react`, `express`…), llamadas a la propia máquina o a la red local (`localhost`, `127.*`, `192.168.*`, `*.local`) y rutas relativas (`fetch('/api/…')` va al backend propio).

## Cómo sumar una API a la lista curada

Agregar una entrada en [`data/known-sdks.json`](../data/known-sdks.json):
- en `npm`, `composer` o `pypi`: `"<paquete>": { "provider": "...", "category": "..." }`;
- en `npmPrefixes`: para familias de paquetes (`@aws-sdk/client-`);
- en `hosts`: para llamadas HTTP (se compara por sufijo: `googleapis.com` cubre `sheets.googleapis.com`).

Con eso, la detección pasa a confianza `alta` y aparecen el proveedor y el rubro. No hace falta tocar código.

## Límites conocidos

- Las variables se siguen **por nombre en todo el archivo**, sin scopes: si un mismo nombre se usa para dos cosas distintas en el mismo archivo, el inventario puede atribuir mal una operación. Alcanza para avisar (nivel 1); ningún codemod que edita se apoya en esto.
- No se siguen instancias entre archivos: si el cliente se crea en `lib/stripe.js` y se exporta, las llamadas que se hacen desde otro archivo no se atribuyen a Stripe (el SDK igual aparece, por el manifiesto y por el archivo que lo importa).
- No se resuelven URLs armadas en otro archivo ni con funciones (`new URL(path, base)`, `buildUrl(...)`): quedan en `unresolved`.
- PHP y Python se listan desde el manifiesto, sin operaciones.
