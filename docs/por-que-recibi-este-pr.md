# ¿Por qué recibí un PR de Parche?

*In English below.*

Parche es una herramienta open source ([MIT](../LICENSE)) que avisa cuando un proveedor de API cambia algo con fecha que afecta tu código y, cuando el arreglo se puede hacer sin inventar datos, propone un PR chico con ese arreglo. Si te llegó un PR o un issue de Parche, esto es lo que hay que saber.

Si instalaste Parche en tu repo (la Action `Pepo08/parche`), el PR lo abrió tu propio workflow: lo de "Por qué tu repo" y "Quién lo abrió" no aplica, el resto sí.

## Por qué tu repo

Tu código usa una API que tiene un cambio con fecha. El caso más común hoy es ARCA: desde el **1/12/2026** rechaza las facturas electrónicas que no informan `CondicionIVAReceptorId` (RG 5616/2024). Parche encontró tu repo con la búsqueda pública de código de GitHub, buscando las llamadas de la librería afectada (por ejemplo, `ElectronicBilling.createVoucher` de afip.js).

## Quién lo abrió y cómo se revisó

- Lo abrió una persona, no un bot automático: cada PR a un repo de terceros se revisa a mano antes de abrirse, uno por uno.
- El arreglo es determinístico: sale de reglas escritas a partir de la fuente oficial (el pack, citado al final del PR), no de un modelo de IA que adivina.
- Lo que no se puede saber con certeza no se completa. Si falta un dato de tu negocio (por ejemplo, la condición frente al IVA de un cliente con CUIT), el PR lo dice y muestra los valores válidos.
- Si el PR es **parcial** (el título dice "parcial"), arregla solo los casos que se pueden resolver sin inventar nada y lista el resto en "Lo que este PR NO resuelve".

## Qué se verificó

Parche parseó cada archivo que modificó. **No ejecutó tu código ni tus tests**: en un repo de terceros no corre nada. Por eso el PR nombra los workflows de tu CI que corren los tests, o te pide correrlos antes de mergear. Si tu repo pide aprobar los workflows de contribuidores nuevos, los checks van a esperar esa aprobación.

## Qué podés hacer

- **Mergearlo** tal cual, **editarlo** o **cerrarlo**: las tres respuestas sirven, y se usan para mejorar las reglas.
- **Pedir que no te mandemos más:** cerrá el PR o comentá "no más PRs". No se abre otro en ese repo.
- **Preguntar:** contestá en el mismo PR o escribí a **hola@getparche.com**.

Parche no guarda tu código ni tiene telemetría: [qué hace y qué no](../SECURITY.md).

---

## In English

Parche is an open-source tool that flags dated third-party API changes affecting your code and, when the fix can be made without guessing, proposes a small PR. Your repository showed up in GitHub's public code search because it calls an API with a dated change (today, mostly Argentina's ARCA e-invoicing requirement due December 1, 2026). A person reviewed the PR by hand before opening it. The fix is deterministic and cites its official source; anything that can't be inferred is left for you, with the valid values. Parche parsed the files it changed but didn't run your code or your tests. Merge it, edit it or close it; if you'd rather not get more, close it or comment "no more PRs" and no other will be opened in that repository. Questions: reply in the PR or write to hola@getparche.com.
