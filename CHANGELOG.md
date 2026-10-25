# Cambios

Los cambios de cada versión de `parche-cli` y de la Action `Pepo08/parche@v0`. En npm están la 0.1.1, la 0.5.1, de la 0.6.0 a la 0.7.0, la 0.7.2, la 0.7.3 y de la 0.7.5 en adelante. La 0.1.0 y de la 0.2.0 a la 0.5.0 no se publicaron en npm; lo que traían está incluido en la 0.5.1. La 0.7.1 y la 0.7.4 tampoco: salieron junto con la 0.7.2 y la 0.7.5. La fecha de cada versión es la del cambio; la de publicación figura en npm y en los [Releases](https://github.com/Pepo08/parche/releases).

## 0.7.5 — 2026-10-24

Mercado Pago: dos cosas del SDK oficial que el pack no tenía en cuenta, verificadas en su código (github.com/mercadopago/sdk-nodejs, 24/10/2026).

### Cambios
- **Ya no se agrega `idempotencyKey` al migrar a `Order.create`.** El SDK manda una `X-Idempotency-Key` nueva en cada escritura cuando no recibe una, así que agregarla no aportaba nada. Y por un bug abierto del SDK (mercadopago/sdk-nodejs#481), las `requestOptions` de `create` quedan guardadas en la configuración del `client`: la clave que agregaba Parche salía también en los reembolsos y las capturas siguientes de ese `client`. Si el código ya traía su propia clave, se deja como está y el PR avisa del #481. Tampoco se agrega más el import de `randomUUID`.
- **Versión del SDK:** `Order` existe en `mercadopago` desde la 2.4.0 (1/4/2025). Con una versión anterior instalada (según el lockfile o `node_modules`), la migración queda **bloqueada** y pide actualizar el SDK, porque migrada dejaría `Order` en undefined. Si solo se conoce el rango de `package.json` y permite una versión anterior, se migra para revisar y pide fijar `^2.4.0`. Si no se ve ninguna versión, pide confirmarla.
- **Pack `mercadopago.payments-to-orders` 2026.10.24:** el checklist ya no pide mandar `X-Idempotency-Key` a mano con el SDK (sí por HTTP directo) y pide `mercadopago` 2.4.0 o posterior. Suma como fuentes el release 2.4.0 del SDK y el issue #481.

## 0.7.4 — 2026-10-24

Un repo con `.parche/` commiteado, y los códigos de error de ARCA según su manual oficial.

### Cambios
- **`.parche/` commiteado:** si alguien commiteó `.parche/` (pasó copiando una carpeta ya escaneada a un repo nuevo), `scan` lo modificaba y después `pr` frenaba con "Hay cambios sin commitear"; y si hubiera seguido, `git add -A` metía `.parche/` en el PR. Ahora `pr` no cuenta `.parche/` al ver si el repo está limpio, nunca lo incluye en el commit, y avisa con una línea cómo dejar de versionarlo. Si la verificación falla, se descarta el arreglo pero no el registro de esa corrida.
- **Pack `arca.wsfe.condicion-iva-receptor`:** cita como fuentes los dos manuales para el desarrollador de WSFEv1 de ARCA: el de producción (revisión del 1/9/2026), cuyo anexo confirma la tabla de códigos válidos por clase de comprobante que ya usaba el pack, y el de homologación (v4.8, revisión del 1/12/2026), que fija el 01/12/2026 como la fecha en que el campo pasa a ser obligatorio. Hasta ahora esa fecha salía solo de fuentes de terceros.
- **Guía de `CondicionIVAReceptorId`:** los códigos son los de los manuales. Cuando falta el campo, el código es la observación 10245 (que queda en desuso el 1/12) y, cuando pasa a ser obligatorio, el error 10246; el 10242 es un código que no existe y el 10243, uno que no corresponde a la clase del comprobante, y los dos ya rechazan hoy. Antes decía que el campo faltante era el 10242. Con afip.js 0.x y `ts-afip-ws` dice "tratalo como si no viajara", porque no está confirmado que no viaje (PR #26). El README dice lo mismo.
- README e inventario: `.parche/` es salida local y no va en git.

## 0.7.3 — 2026-10-24

La foto de cada corrida de la Action. Hasta la 0.7.2, el inventario de APIs, los avisos y el registro se escribían dentro del runner y se perdían al terminar el job: de una corrida quedaban solo el resumen del job y los PRs, y el resumen no se puede leer por la API de GitHub.

### Nuevo
- **La Action guarda la foto de la corrida** como artifact del workflow (`parche`): `scan.json`, que es la salida de `parche scan --json` (el inventario y los avisos), y `ledger.jsonl`, el registro de esa corrida (los PRs que abrió y lo que quedó sin PR). Lleva rutas, números de línea, paquetes, versiones, operaciones y los mensajes de Parche; no lleva código. Se baja con `gh run download <id> -n parche`. Inputs nuevos: `snapshot` (`'true'` por defecto; `'false'` la apaga) y `snapshot-name`, para usar la Action más de una vez en el mismo workflow. Corre aunque `parche pr` haya fallado, y si la foto falla, la corrida no falla: queda un aviso.
- **Cada aviso tiene un `fingerprint`**, un identificador que sale del pack, el archivo y el texto de la línea, sin el número de línea ni el mensaje. No cambia si se mueven las líneas, se reindenta el código o el archivo pasa a CRLF; sí cambia si cambia el código de esa línea. Sirve para comparar una corrida con la anterior: qué es nuevo, qué sigue y qué se resolvió.
- **`parche scan --json` dice qué versión de Parche lo generó** (`parcheVersion`).

### Cambios
- `actions/upload-artifact` (v7.0.2) fijada por SHA, como las demás Actions; un test controla que `action.yml` también las fije.

## 0.7.2 — 2026-10-24

ARCA: lo que pidió el re-escaneo de repos públicos con la 0.7.0. Un PR preparado quedaba parcial sin decirlo, y dos casos podían sacar un PR que no anda.

### Cambios
- **Clave casi bien escrita en una asignación aparte:** `det.CondicionIVAReceptor = x`, `det['CondicionIVAReceptor'] = x` (JS y TS) y `$det['CondicionIVAReceptor'] = $x` (PHP) se renombran a `CondicionIVAReceptorId` cuando `det` es, en la misma función, un objeto o array con claves de WSFEv1. En un repo real, el informe de comprobantes con CAEA lo hacía así, y la 0.7.0 renombraba las otras tres apariciones y esta ni la nombraba: el PR quedaba parcial en silencio. Si no se puede confirmar que `det` sea el comprobante (por ejemplo, si llega como parámetro), Parche lo avisa para revisar y no lo toca.
- **El renombre ya no rompe el tipado:** si un `interface` o un `type` del repo declara la clave mal escrita (`CondicionIvaReceptorId?: number`), renombrarla solo en el objeto hacía que TypeScript no compilara, y el chequeo de sintaxis no lo veía. Ahora no se renombra, y el aviso dice en qué archivo y línea está el tipo para cambiar los dos.
- **Archivos con saltos de línea `\r` sueltos (`\r\r\n`):** en JS y TS, Parche no los edita. El parser cuenta cada `\r` como una línea y la edición caía en otra parte del archivo; en un repo real, dentro de un comentario y con "Sintaxis OK". Ahora el hallazgo pasa a "revisar", con lo que hay que cambiar a mano y la línea que muestra git.

## 0.7.1 — 2026-10-24

La Action, lista para el GitHub Marketplace como "Parche API Changes". No cambia nada de lo que hace Parche.

### Cambios
- **Ícono de la Action:** `git-pull-request`. El que tenía, `tool`, está en la lista de íconos que el Marketplace no acepta y el panel de publicación lo marcaba como error.
- **Descripción de la Action en inglés y en menos de 125 caracteres:** es la tarjeta del Marketplace, que ve gente de cualquier país. "Dependabot para APIs" queda como frase de presentación.
- **README:** un "GitHub Action quick start" en inglés al principio (la página de la Action en el Marketplace es el README): qué hace la plantilla, los permisos y los inputs.
- **Input `verify`:** la descripción nombra todos los tests que puede correr (`npm test`, `composer test` o `vendor/bin/phpunit`), no solo `npm test`.
- Un test controla lo que revisa el Marketplace: el nombre, el largo de la descripción, el ícono y el color.

## 0.7.0 — 2026-10-24

ARCA: Parche encuentra a los repos que creen estar migrados y no lo están, reconoce `@arcasdk/core` (la segunda librería de ARCA más descargada en npm) y avisa de la librería vieja en más casos. Salió de los pendientes del escaneo de 174 repos públicos (frente B, puntos 12 a 14).

### Nuevo
- **Clave casi bien escrita:** si el detalle del comprobante lleva `CondicionIVAReceptor` (sin `Id`), `CondicionIvaReceptorId` o `condicionIVAReceptorId`, Parche la renombra a `CondicionIVAReceptorId` sin tocar el valor, en JS y en PHP. Ese elemento no existe en el WSDL de WSFEv1: el dato nunca llegaba y desde el 1/12/2026 ARCA rechaza el CAE. Pasaba en un repo real con integración SOAP propia, en cuatro archivos. El PR sale borrador, para revisar que el valor sea un código válido. Solo se toca dentro de objetos o arrays con al menos dos claves de WSFEv1 (`DocTipo`, `CbteDesde`, `ImpTotal`…), nunca en tests ni en modelos propios con un nombre parecido. Si el comprobante tiene las dos claves, no edita y pide revisar.
- **`@arcasdk/core`:** `arca.electronicBillingService.createVoucher(...)` y `createNextVoucher(...)` reciben los mismos arreglos que `afip.js` (consumidor final, DNI con B o C, PR parcial). Su comprobante usa las mismas claves de WSFEv1 (tipos de la 2.0.2, leídos en el paquete de npm). Probado sobre cinco repos públicos que la usan.
- **Guía "Cómo agregar `CondicionIVAReceptorId` antes del 1/12/2026"** (`docs/guia-condicion-iva-receptor.md`): qué cambia, el campo en afip.js, afip.php, @arcasdk/core y SOAP propio, los códigos por clase de comprobante, los tres errores que aparecieron en repos reales y cómo probarlo en homologación. Para quien prefiere hacerlo a mano.

### Cambios
- **`ts-afip-ws`:** se avisa como librería vieja. Es un fork de afip.js 0.x y su última versión (1.3.2, de 2023) trae `wsfe.wsdl` y `wsfe-production.wsdl` sin el campo. El aviso dice qué hacer: pasar a `@afipsdk/afip.js` 1.x o actualizar el WSDL que trae la librería (lo mismo para `eesnaola/afip.php`, que no tiene una 1.x).
- **El aviso de librería vieja también sale cuando Parche no puede leer los datos del comprobante** (por ejemplo, si llegan de otra función). Antes salía solo en los arreglos automáticos y en lo que pedía un dato con el objeto a la vista.
- **Cuerpo del issue:** el pie dice "¿Te sirvió este aviso?" en vez de "¿Este PR te sirvió?".
- **Checklist:** "confirmar que cada cliente con CUIT tiene su condición" sale solo si queda algo pendiente. En un PR que arregla todo, como uno de puros consumidores finales, no aplicaba (nuevo campo de pack: `review_checklist_if_pending_es`).
- **Pack `arca.wsfe.condicion-iva-receptor` 2026.10.24:** fuentes releídas el 24/10/2026 (sin prórroga del 1/12); la explicación ya no cita una versión del manual de WSFEv1, que la página de ARCA rotula distinto; suma `facturas` (LaPyme) y las llamadas de `@arcasdk/core` a la detección.

## 0.6.9 — 2026-10-23

La Action muestra lo que no abre un PR, y la plantilla del workflow anda en repos PHP. Salió de probar cada comando sobre los ejemplos antes de mandar los primeros mensajes de venta.

### Nuevo
- **Resumen del job y anotaciones en GitHub Actions:** `parche pr` escribe en el resumen de la corrida (`$GITHUB_STEP_SUMMARY`) los PRs que abrió, lo que quedó sin PR (por ejemplo, una factura A a un CUIT, donde falta la condición frente al IVA del cliente) y los avisos de los packs de solo detección, como un modelo de IA que se retira. Las primeras 10 también salen como anotaciones con el archivo y la línea. Hasta la 0.6.8, `pr` salteaba los packs sin arreglo y la Action no mostraba los avisos de IA.
- **Fuera de GitHub Actions,** `parche pr` imprime al final los avisos de solo detección ("Avisos sin PR").

### Cambios
- **Plantilla del workflow (`templates/github-workflow.yml`):** `npm ci` corre solo si hay `package-lock.json`, y `composer install` solo si hay `composer.json`. Antes, en un repo PHP el workflow fallaba en el primer paso.
- **Inventario en PHP y Python:** un SDK declarado en `composer.json` o `requirements.txt` dice "los usos en PHP (o Python) todavía no se analizan", en vez de "sin usos encontrados", que sonaba a que no se usa.
- La CI prueba la Action también sobre un repo PHP (copia de `examples/tienda-php`).

## 0.6.8 — 2026-10-22

Pack de IA: los alias de Claude que apuntan a un modelo con fecha. Antes de la generación 4.6, la API de Claude acepta alias cortos que apuntan al snapshot fechado más reciente de cada versión (página "Model IDs and versioning", verificada el 22/10/2026). La 0.6.7 avisaba `claude-sonnet-4-5-20250929`, que se retira el 30/11/2026, pero no `claude-sonnet-4-5`, que es el mismo modelo.

### Nuevo
- **`claude-sonnet-4-5`:** se avisa como su snapshot, con la fecha (30/11/2026) y el reemplazo que recomienda Anthropic (`claude-sonnet-5-5`). El aviso nombra el snapshot: "El modelo `claude-sonnet-4-5` (alias de `claude-sonnet-4-5-20250929`) se retira el 2026-11-30".
- **`claude-opus-4-5` y `claude-haiku-4-5`:** se avisan con la fecha mínima de retiro de su snapshot, igual que los IDs fechados.
- Los alias viven en el pack (`model_aliases`), cada uno con la página del modelo como fuente: sumar otro es agregar una línea.

### Sin cambios
- Los IDs de Amazon Bedrock (`anthropic.claude-…`) y de Google Cloud (`claude-sonnet-4-5@20250929`) no se marcan: esas plataformas tienen su propio calendario de retiros.

### Todavía no cubre
- Los alias de modelos ya retirados (`claude-3-5-sonnet-latest`, `claude-3-7-sonnet-latest` y otros): la documentación actual de Anthropic ya no los nombra, y sin fuente no se avisan.

## 0.6.7 — 2026-10-21

Pack de IA con la API version `2026-10-21` de Anthropic, que salió el 21/10 junto con el SDK de TypeScript 1.0.0 y el de Python 2.0.0: elimina `temperature`, `top_p` y `top_k` para cualquier modelo, y un pedido que los manda devuelve un error 400 aunque tengan su valor por defecto (guía "Migrating to API version 2026-10-21" y página de deprecaciones, verificadas el 21/10). Los SDK anteriores siguen mandando `2023-06-01`, así que hoy casi nada se rompe: se rompe con la próxima suba del SDK. Como siempre, Parche avisa y no toca el código. Esta versión trae además las bases de confianza del repo (al final).

### Nuevo
- **Los tres parámetros con cualquier modelo,** también Claude Sonnet 4.6, Opus 4.6 y Haiku 4.5, que en `2023-06-01` los aceptan. El aviso dice en cuál de tres casos está el pedido:
  - **ya falla:** el archivo manda `anthropic-version: 2026-10-21`, o el SDK instalado ya es el nuevo (`@anthropic-ai/sdk` 1.0.0 o posterior; `anthropic` 2.0.0 o posterior por `extra_body`). En Python, el parámetro directo ya tira `TypeError` desde la 1.0.0 (MIGRATION.md del SDK);
  - **falla en una instalación nueva:** el rango declarado no tiene tope (`>=0.30.0`, `>=0.40`) y ya deja instalar la versión nueva;
  - **va a fallar con la suba:** el SDK instalado es anterior; el aviso pide sacar el parámetro antes de aceptar esa suba.
- **Sin repetir avisos:** lo que ya marca la regla de Claude 4.7 (un valor fuera de lo aceptado) sale una sola vez. En un modelo que todavía acepta otros valores, el aviso aclara que sacarlo cambia cómo responde y que la alternativa es dejar ese pedido en `2023-06-01`. Un archivo que fija `anthropic-version: 2023-06-01` no se avisa.
- **Versión de Python desde `requirements.txt`:** el contexto del repo ahora también trae las versiones declaradas de Python y el rango tal como está escrito.
- **PRs abiertos con el `GITHUB_TOKEN`:** GitHub deja sus workflows esperando aprobación. Cuando la Action corre con el token por defecto, el cuerpo del PR lo dice y explica cómo usar un token de GitHub App o uno personal para que la CI corra sola (README, "En GitHub Actions").
- **La Action se llama "Parche API Changes"** (antes, "Parche — Dependabot para APIs"), para publicarla en el GitHub Marketplace. Sus reglas no aceptan un nombre igual a una función de GitHub (Dependabot, que queda solo en la descripción) ni a un usuario de GitHub (existe la cuenta `parche`).

### Cambios
- La fuente del `TypeError` del SDK de Python pasa a ser su MIGRATION.md de la 1.0.0: la guía de migración a Opus 5.5 ya no lo menciona.

### Todavía no cubre
- La versión del SDK de Python desde `pyproject.toml`, `poetry.lock` o `uv.lock`, y los rangos sin número (`latest`, `*`), que cuentan como versión desconocida.
- Los SDKs de Go (v2), Java (3.0.0), .NET (13.0.0), Ruby (2.0.0) y PHP (1.0.0), que también pasan a `2026-10-21`.
- Los otros cambios de esa API version: bloques `document` en mensajes de `assistant`, `citations` en mensajes de `user` y los campos renombrados de la Admin API.

### Bases de confianza del repo

Qué hace Parche con tu código, cómo reportar una vulnerabilidad y cómo contribuir.

- **`SECURITY.md`:** cómo reportar una vulnerabilidad (en privado, primera respuesta en 14 días como máximo) y qué hace Parche en tu máquina o en tu runner: a qué hosts se conecta y con qué comando, que no tiene telemetría, qué ejecuta (tus tests, solo con `--verify`) y qué archivos escribe.
- **README:** un bloque en inglés al principio, la sección "Seguridad y datos" y qué puede cambiar dentro de `v0`.
- **`CONTRIBUTING.md`** (con el proceso para sacar una versión, que sale del README), **código de conducta**, plantillas de issue (falso positivo o aviso que falta, pedido de pack, error) y de PR.
- **`parche --version`.**
- **"¿Por qué recibí un PR de Parche?"** ([`docs/por-que-recibi-este-pr.md`](docs/por-que-recibi-este-pr.md)): para quien recibe un PR o un issue de Parche. Explica por qué su repo, cómo se revisó el PR, qué se verificó y qué no, y cómo pedir que no le manden más. El pie de cada PR y de cada issue la enlaza.
- **La plantilla del workflow pide solo lectura por defecto** y da `contents: write` y `pull-requests: write` solo al job de Parche. Explica cómo fijar la Action a un commit en vez de `v0`.
- **Las Actions de la CI, del release y de la plantilla quedan fijadas por SHA** (`actions/checkout` v7.0.1, `actions/setup-node` v7.1.0), con `dependabot.yml` para mantenerlas al día.
- `package.json`: la descripción dice "cualquier API", la página es getparche.com y suma keywords de IA.

## 0.6.6 — 2026-10-20

Pack de IA con el primer cambio de Anthropic que no es un retiro de modelo: desde Claude 4.7, `temperature`, `top_p` y `top_k` con un valor que no es el de por defecto dan error 400 (página de deprecaciones de Anthropic, sección "API parameter deprecations", verificada el 20/10; los valores aceptados, de la referencia de la API y de las guías de migración). Como siempre, Parche avisa y no toca el código.

### Nuevo
- **Parámetros de muestreo en Claude 4.7 y posteriores:** en `claude-opus-4-7`, `claude-opus-4-8`, `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5`, `claude-fable-5-1`, `claude-mythos-5`, `claude-mythos-5-1` y `claude-mythos-preview`, avisa `temperature` distinto de 1, `top_p` por debajo de 0.99 y `top_k` con cualquier valor. En Claude Haiku 5.5, que es más estricto, también `top_p` distinto de 0.99 (incluso 1) y `temperature` y `top_p` juntos. El aviso dice el parámetro, el modelo, qué acepta y la recomendación oficial: sacar el parámetro y guiar el comportamiento del modelo con el prompt. Con `temperature` en 0 aclara que, según Anthropic, eso nunca garantizó respuestas idénticas; en Python, que el SDK 1.0 o posterior ya no tiene esos parámetros (pasarlos tira `TypeError`).
- **Dónde lo busca:** en lo que recibe `messages.create` y `messages.stream` del SDK de JS/TS y del de Python (también `beta.`, `with_raw_response.` y `create(params)` / `create(**params)` con el objeto en el mismo archivo), en objetos tipados como `MessageCreateParams` y en el cuerpo de las llamadas HTTP directas a `api.anthropic.com/v1/messages` (fetch, axios, requests). El modelo y el parámetro pueden estar en líneas distintas del pedido.
- **El modelo, sin inventar:** se lee si es un literal, una constante asignada una sola vez en el archivo o el valor por defecto de una variable (`process.env.CLAUDE_MODEL || '…'`, `os.getenv("CLAUDE_MODEL", "…")`), y el aviso dice cuál de los dos es. Si el modelo no se puede saber (llega de otro archivo, de la configuración o se asigna más de una vez), no avisa.
- **Sin falsos positivos con otros modelos y proveedores:** Claude Sonnet 4.6, Opus 4.6, Haiku 4.5 y anteriores aceptan los tres parámetros; OpenAI, Gemini y la capa de Anthropic compatible con el SDK de OpenAI no se avisan.

### Todavía no cubre
- La versión instalada del SDK de Python: con la 1.0 o posterior, pasar `temperature`, `top_p` o `top_k` tira `TypeError` con cualquier valor y cualquier modelo, pero hoy solo se dice en los avisos de Claude 4.7 y posteriores.
- Frameworks que arman el pedido por su cuenta (LangChain, Vercel AI SDK, LiteLLM), la Message Batches API y los IDs de modelo de Amazon Bedrock (`anthropic.claude-…`).
- Los SDKs de Go, Java, .NET, Ruby y PHP, y los cuerpos de pedido escritos como texto JSON dentro de un string.

## 0.6.5 — 2026-10-19

Pack de IA con la Videos API de OpenAI, que cerró el 24/9/2026 junto con los modelos Sora 2 (página de deprecaciones verificada el 19/10; los métodos salen de la referencia oficial de la API y del SDK de Python). Hasta ahora solo se avisaban los modelos `sora-2*`; ahora también las llamadas que quedaron en el código sin un ID de modelo cerca (consultar el estado, bajar el video, listar, borrar). Como siempre, Parche avisa y no toca el código.

### Nuevo
- **Videos API (cerrada el 24/9/2026, sin reemplazo):** los métodos del SDK de Node (`videos.create`, `retrieve`, `list`, `delete`, `remix`, `edit`, `extend`, `downloadContent`, `createCharacter`, `getCharacter`), los del SDK de Python (los mismos en snake_case, más `create_and_poll` y `poll`, también detrás de `with_raw_response` y `with_streaming_response`) y `/v1/videos` por HTTP. OpenAI no indica reemplazo (su referencia dice que no hay una API que la reemplace uno a uno), y el aviso lo dice así, sin inventar uno.
- **Menos falsos positivos:** como Evals y ChatKit, solo cuenta si el archivo importa el SDK oficial de OpenAI o nombra `api.openai.com`, porque api.video tiene `client.videos.create(` y otros proveedores usan `/v1/videos`. Además no se avisan los receptores de YouTube (`youtube.videos.list(`, `google.youtube('v3').videos.list(`), que conviven con el SDK de OpenAI en los resumidores de videos. En Azure OpenAI no se da por cerrada con la fecha de OpenAI.

### Todavía no cubre
- Un archivo que importa el SDK de OpenAI y llama a otro cliente con `videos` (api.video, o YouTube con un nombre como `yt`): se avisa igual.
- Un cliente de OpenAI que llega de otro archivo (`import { openai } from './lib/openai'`) sin importar el SDK ni nombrar el host.
- Los SDKs de Go, Java, .NET y Ruby.

## 0.6.4 — 2026-10-18

Pack de IA con los productos que OpenAI cierra y no son modelos (página de deprecaciones verificada el 18/10; cómo se usa cada uno, de la referencia oficial de la API y de los SDKs de Node y Python). Como siempre, Parche avisa con la fecha y el reemplazo oficial, y no toca el código.

### Nuevo
- **Prompts reutilizables (cierran el 30/11/2026):** los IDs de objetos de prompt entre comillas (`"pmpt_…"`, como en `responses.create({ prompt: { id: "pmpt_…" } })`, en cualquier lenguaje) y las llamadas a `api.openai.com/v1/prompts`. Reemplazo: pasar el contenido del prompt al código y mandarlo en `input` de la Responses API.
- **Plataforma de Evals (solo lectura el 31/10, cierre el 30/11/2026):** los métodos del SDK (`evals.create`, `evals.retrieve`, `evals.update`, `evals.list`, `evals.delete`, `evals.runs.*` y `evals.runs.outputItems.*` / `output_items.*`) y `/v1/evals`. El aviso dice que las evals existentes pasan a solo lectura el 31/10 (y, desde ese día, que ya lo están). Reemplazo: Promptfoo, el que recomienda OpenAI.
- **Agent Builder (cierra el 30/11/2026):** no tiene API propia; lo que queda en el código es la sesión de ChatKit que corre un workflow de Agent Builder (`beta.chatkit.sessions.create`, que siempre pide un `workflow`, y `/v1/chatkit/sessions`). Reemplazo: exportar el workflow como código del Agents SDK y conectar ChatKit a un servidor propio. ChatKit sigue.
- **Menos falsos positivos:** `.evals.…(`, `/v1/evals`, `chatkit.sessions.create` y `/v1/chatkit/sessions` solo cuentan si el archivo importa el SDK oficial de OpenAI (JS o Python) o nombra `api.openai.com`; `/v1/prompts` solo con el host de OpenAI (Portkey usa `/v1/prompts/:id/completions`). En Azure OpenAI no se dan por cerrados con la fecha de OpenAI.

### Todavía no cubre
- Un ID de prompt o de workflow que llega por variable de entorno o configuración, y `/v1/evals` o ChatKit por HTTP con la URL armada en otro archivo.
- Los SDKs de Go, Java, .NET y Ruby para Evals y ChatKit (sí se ven los IDs `pmpt_…` y las URLs con `api.openai.com`).
- La Videos API (cerrada el 24/9/2026; sí se avisan los modelos `sora-2`), las familias de audio y realtime sin IDs en la página y lo que OpenAI apagó antes de 2026.

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
