# Cómo agregar `CondicionIVAReceptorId` antes del 1/12/2026

Desde el **1 de diciembre de 2026**, ARCA (ex AFIP) rechaza los pedidos de CAE del web service de factura electrónica (WSFEv1) que no informen la condición frente al IVA de quien recibe la factura. La obligación viene de la RG 5616/2024, y hasta el 30/11 el sistema todavía tolera que el dato falte ([iProfesional](https://www.iprofesional.com/impuestos/464104-nuevo-requisito-arca-puede-trabar-emision-facturas)). Si tu sistema factura con una integración propia o con una librería, esta guía dice qué cambiar y cómo probarlo.

**Si facturás con un sistema comercial** (Tango, Xubio, Colppy y parecidos), lo resuelve tu proveedor: preguntale.

## 1. Encontrá cada lugar donde se pide un CAE

Buscá en tu código cada llamada que arma un comprobante: `createVoucher` o `createNextVoucher` (afip.js, @arcasdk/core), `CreateVoucher` o `CreateNextVoucher` (afip.php), o el `FECAESolicitar` de una integración SOAP propia. Es fácil que haya más de una: facturas, notas de crédito, procesos en lote.

Para encontrarlas todas de una vez, en la carpeta de tu proyecto:

```bash
npx parche-cli scan .
```

Corre en tu compu, sin cuenta y sin mandar tu código a ningún lado ([seguridad y datos](../SECURITY.md)), y no cambia nada: lista cada lugar, dice cuáles se pueden arreglar sin datos tuyos (por ejemplo, consumidor final) y marca el resto con los códigos válidos para ese tipo de comprobante. Para aplicar esos arreglos, `npx parche-cli fix .`. Necesita Node 22 o posterior.

## 2. Agregá el campo en cada comprobante

El campo se llama exactamente **`CondicionIVAReceptorId`** y es un número.

**afip.js (`@afipsdk/afip.js`):**

```js
await afip.ElectronicBilling.createNextVoucher({
  // ...lo que ya mandás
  DocTipo: 99,
  DocNro: 0,
  CondicionIVAReceptorId: 5, // Consumidor Final
});
```

**afip.php (`afipsdk/afip.php`):**

```php
$afip->ElectronicBilling->CreateNextVoucher([
    // ...lo que ya mandás
    'DocTipo' => 99,
    'DocNro' => 0,
    'CondicionIVAReceptorId' => 5, // Consumidor Final
]);
```

**@arcasdk/core:**

```ts
await arca.electronicBillingService.createNextVoucher({
  // ...lo que ya mandás
  DocTipo: 99,
  DocNro: 0,
  CondicionIVAReceptorId: 5, // Consumidor Final
});
```

**Integración SOAP propia:** agregá el elemento `CondicionIVAReceptorId` dentro de cada `FECAEDetRequest`, después de `MonCotiz` (y de `CanMisMonExt`, si lo mandás) y antes de `CbtesAsoc`. Si tu cliente SOAP se genera desde un WSDL guardado en el proyecto, regeneralo con el WSDL vigente de WSFEv1: uno viejo no tiene el campo y no lo va a mandar.

## 3. Elegí el código según tu cliente

Un consumidor final sin identificar (`DocTipo` 99) va con **5**. Para el resto, el dato sale de tu base de clientes: la condición frente al IVA de cada uno. No se puede adivinar.

| Código | Condición frente al IVA |
|---:|---|
| 1 | IVA Responsable Inscripto |
| 4 | IVA Sujeto Exento |
| 5 | Consumidor Final |
| 6 | Responsable Monotributo |
| 7 | Sujeto No Categorizado |
| 8 | Proveedor del Exterior |
| 9 | Cliente del Exterior |
| 10 | IVA Liberado – Ley N° 19.640 |
| 13 | Monotributista Social |
| 15 | IVA No Alcanzado |
| 16 | Monotributo Trabajador Independiente Promovido |

No todos sirven para cualquier comprobante:

| Comprobante | Códigos válidos |
|---|---|
| Clase A | 1, 6, 13, 16 |
| Clase B | 4, 5, 7, 8, 9, 10, 15 |
| Clase C | 1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16 |

Las dos tablas son las del anexo "Condición Frente al IVA del receptor" del [manual para el desarrollador de ARCA](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf) (revisión del 1/9/2026), y pueden cambiar: antes de pasar a producción, consultá los valores vigentes con el método `FEParamGetCondicionIvaReceptor` del web service.

Si tu sistema guarda la condición con una numeración propia (por ejemplo, un enum interno), traducila a esta tabla: no la mandes tal cual.

## 4. Tres errores que vimos en repos reales

- **El nombre casi bien escrito.** `CondicionIVAReceptor` (sin `Id`), `CondicionIvaReceptorId` o `condicionIVAReceptorId` no existen en el web service: el dato no llega y el código parece migrado. Tiene que ser exactamente `CondicionIVAReceptorId`.
- **La librería vieja.** Con afip.php 0.x el pedido se arma con un WSDL de 2021 que no tiene el campo: aunque lo agregues al código, no viaja. Con afip.js 0.x y con `ts-afip-ws` (un fork de afip.js 0.x), el WSDL que traen tampoco lo tiene: tratalo como si no viajara. Pasá a la 1.x de afip.js o de afip.php (con `ts-afip-ws`, a `@afipsdk/afip.js` 1.x), o actualizá el WSDL que trae la librería.
- **Solo la factura principal.** Las notas de crédito y débito, los procesos en lote y los reintentos también piden CAE: cada uno necesita el campo.

## 5. Probalo en homologación

Emití un comprobante de cada tipo que uses (A, B, C, notas de crédito) contra el ambiente de homologación de WSFEv1, con tu certificado de prueba, y mirá las observaciones y los errores de cada respuesta. Estos son los códigos del campo según los dos manuales para el desarrollador de ARCA, que dicen lo mismo: el de [producción](https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf) (v4.7, revisión del 1/9/2026) y el de [homologación](https://www.afip.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf) (v4.8, revisión del 1/12/2026).

| Código | Tipo | Qué significa |
|---|---|---|
| 10245 | Observación | Falta el campo, que "resultará obligatorio" por la RG 5616. El CAE sale igual, con esta observación. La v4.8 dice que este código queda en desuso desde el 1/12/2026 |
| 10246 | Error | Falta el campo, que ya "es obligatorio": no hay CAE |
| 10242 | Error | El código no existe (no es un valor permitido; consultá `FEParamGetCondicionIvaReceptor`). Ya rechaza hoy |
| 10243 | Error | El código no es válido para la clase del comprobante (por ejemplo, 5, Consumidor Final, en una factura A). Ya rechaza hoy con CAE; con CAEA, observa |

Si te aparece la 10245, el dato no está viajando. Hasta el 30/11/2026 eso no impide facturar; desde el 1/12/2026 el campo es obligatorio y el pedido sin el dato se rechaza (lo dice el historial de cambios de la v4.8). Confirmá en homologación qué código te devuelve a vos: algunas fuentes citan otros (Afip SDK, por ejemplo, describe el campo faltante con el 10242).

## Si querés ayuda

Parche es open source ([github.com/Pepo08/parche](https://github.com/Pepo08/parche)) y el scan es gratis. Si preferís que te ayudemos a dejarlo listo y probado en homologación antes del 1/12, escribinos a hola@getparche.com.
