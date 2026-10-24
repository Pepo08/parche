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

La tabla sale de [este relevamiento](https://app.spomsolutions.com/blog/condicion-iva-receptor-rg-5616) y puede cambiar: antes de pasar a producción, consultá los valores vigentes con el método `FEParamGetCondicionIvaReceptor` del web service.

Si tu sistema guarda la condición con una numeración propia (por ejemplo, un enum interno), traducila a esta tabla: no la mandes tal cual.

## 4. Tres errores que vimos en repos reales

- **El nombre casi bien escrito.** `CondicionIVAReceptor` (sin `Id`), `CondicionIvaReceptorId` o `condicionIVAReceptorId` no existen en el web service: el dato no llega y el código parece migrado. Tiene que ser exactamente `CondicionIVAReceptorId`.
- **La librería vieja.** Con afip.js o afip.php 0.x, y con forks como `ts-afip-ws`, el pedido se arma con un WSDL de 2021 que no tiene el campo: aunque lo agregues al código, no viaja. Pasá a la 1.x de la librería (o actualizá el WSDL que trae).
- **Solo la factura principal.** Las notas de crédito y débito, los procesos en lote y los reintentos también piden CAE: cada uno necesita el campo.

## 5. Probalo en homologación

Emití un comprobante de cada tipo que uses (A, B, C, notas de crédito) contra el ambiente de homologación de WSFEv1, con tu certificado de prueba. Si el campo falta o tiene un valor inválido, ARCA responde con el código 10242 ("El campo Condición IVA receptor es obligatorio"). Hasta el 30/11/2026 no impide facturar; desde el 1/12, sí ([Afip SDK lo explica acá](https://afipsdk.com/blog/factura-electronica-solucion-a-error-10242/)).

## Si querés ayuda

Parche es open source ([github.com/Pepo08/parche](https://github.com/Pepo08/parche)) y el scan es gratis. Si preferís que te ayudemos a dejarlo listo y probado en homologación antes del 1/12, escribinos a hola@getparche.com.
