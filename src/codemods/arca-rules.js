// Reglas del pack arca.wsfe.condicion-iva-receptor, compartidas por los codemods de JS y de PHP:
// qué se puede inferir sin datos del negocio y con qué mensajes se reporta.

import { isTestFile } from '../paths.js';

export const PACK = 'arca.wsfe.condicion-iva-receptor';

// Prefiltro de los codemods: sin estas palabras no hay nada de ARCA en el archivo y no se parsea
// (en repos con bundles grandes, parsear todo tardaba minutos y 1,5 GB de RAM).
export const ARCA_HINT = /electronicbilling|fecaesolicitar|fecaedetrequest/i;

const CLASS = {
  A: new Set([1, 2, 3, 201, 202, 203]),
  B: new Set([6, 7, 8, 206, 207, 208]),
  C: new Set([11, 12, 13, 211, 212, 213]),
};

export function classOf(cbteTipo) {
  for (const [k, set] of Object.entries(CLASS)) if (set.has(cbteTipo)) return k;
  return null;
}

// docTipo y cbteTipo: números si el valor es un literal, undefined si no se puede saber.
export function decideCondition({ docTipo, cbteTipo }, pack) {
  const clase = typeof cbteTipo === 'number' ? classOf(cbteTipo) : null;
  if (docTipo === 99) {
    return { status: 'auto', code: 5, comment: ' parche: 5 = Consumidor Final (DocTipo 99, sin identificar)' };
  }
  if (docTipo === 96 && (clase === 'B' || clase === 'C')) {
    return { status: 'needs-review', code: 5, comment: ' parche: inferido Consumidor Final (DNI + comprobante ' + clase + ') — REVISAR' };
  }
  const valid = clase ? pack.codes_by_class[clase] : null;
  return { status: 'needs-input', clase, valid };
}

export function validCodesText(decision, pack) {
  return (decision.valid || Object.keys(pack.codes).map(Number))
    .map((c) => `${c} (${pack.codes[String(c)]})`).join(', ');
}

export function missingMessage(decision) {
  return `Falta CondicionIVAReceptorId y no se puede inferir sin saber la condición frente al IVA del cliente${decision.clase ? ` (comprobante clase ${decision.clase})` : ''}.`;
}

export function appliedMessage(status) {
  return status === 'auto'
    ? 'Agregado CondicionIVAReceptorId: 5 (Consumidor Final): el comprobante va a un consumidor sin identificar.'
    : 'Agregado CondicionIVAReceptorId: 5 por inferencia (DNI + comprobante B/C). Confirmá que el cliente no sea exento ni no alcanzado.';
}

// Arreglo parcial "en tiempo de ejecución" (punto 7 del frente B, 16/10): si DocTipo no es un literal
// (DocTipo: docTipo), la regla 99 → 5 se aplica al ejecutarse y, con otro DocTipo, el pedido sale igual que hoy.
// No inventa nada: Consumidor Final es el único caso que no depende de datos del negocio. No se aplica si el
// comprobante es clase A o de otra clase conocida (99 con factura A no existe).
export const PARTIAL = 'consumidor final';
export const PARTIAL_COMMENT = ' parche: 5 = Consumidor Final solo si DocTipo es 99; con otro DocTipo falta la condición frente al IVA del cliente';

export function canApplyAtRuntime(decision, cbteTipo) {
  return decision.status === 'needs-input' && (cbteTipo === undefined || decision.clase === 'B' || decision.clase === 'C');
}

const dmy = (iso) => iso.split('-').map(Number).reverse().join('/');

export function partialAppliedMessage(docTipoText) {
  return `Arreglo parcial (${PARTIAL}): CondicionIVAReceptorId: 5 solo cuando \`${docTipoText}\` vale 99 al ejecutarse. Con otro DocTipo el pedido sale igual que hoy, sin el campo.`;
}

// Lo que el arreglo parcial NO cubre: va en el cuerpo del PR como "lo que este PR no resuelve".
export function partialPending(decision, pack, suggestion) {
  return {
    covers: PARTIAL,
    message: `No cubre los comprobantes con DocTipo distinto de 99 (CUIT, DNI y otros): siguen sin CondicionIVAReceptorId y desde el ${dmy(pack.deadline)} ARCA los va a rechazar. Falta la condición frente al IVA de cada cliente${decision.clase ? ` (comprobante clase ${decision.clase})` : ''}.`,
    suggestion,
  };
}

// En un scan posterior (el PR parcial ya se mergeó): lo que falta se sigue reportando.
export function partialLeftMessage(pending) {
  return `Tiene el arreglo parcial de Parche (solo DocTipo 99 → 5). ${pending.message}`;
}

// Clave casi igual al campo (frente B, punto 13): `CondicionIVAReceptor` sin Id, `CondicionIvaReceptorId`,
// `condicionIVAReceptorId`. Ese elemento no existe en el WSDL de WSFEv1, así que el dato nunca viaja y el repo
// parece migrado (pablocla/erpia lo tenía en cuatro archivos). Solo se toca dentro del detalle de un comprobante
// (dos o más claves de WSFEv1), para no renombrar modelos o DTOs propios que se llamen parecido.
const FIELD = 'CondicionIVAReceptorId';
export const NEAR_HINT = /condicion_?iva_?receptor/i;
const DETAIL_KEYS = new Set(['Concepto', 'DocTipo', 'DocNro', 'CbteDesde', 'CbteHasta', 'CbteFch', 'ImpTotal', 'ImpNeto', 'ImpIVA', 'MonId', 'MonCotiz']);
export const isNearMissKey = (key) => typeof key === 'string' && key !== FIELD && /^condicion_?iva_?receptor(?:_?id)?$/i.test(key);
export const isVoucherDetail = (keys) => keys.filter((k) => DETAIL_KEYS.has(k)).length >= 2;

export function nearMissMessage(key, pack) {
  return `\`${key}\` no es un campo de WSFEv1: ARCA espera \`${FIELD}\`, así que hoy el dato no llega y desde el ${dmy(pack.deadline)} ARCA rechaza el CAE. `
    + 'Lo renombré sin tocar el valor: revisá que sea un código de FEParamGetCondicionIvaReceptor.';
}

export function nearMissBothMessage(key) {
  return `El comprobante tiene \`${key}\` y también \`${FIELD}\`. \`${key}\` no es un campo de WSFEv1: se puede borrar. Revisá que \`${FIELD}\` lleve el valor correcto.`;
}

// Frente B, punto 25: una asignación aparte (`det.CondicionIVAReceptor = x`) a un objeto que no se puede confirmar
// como el detalle del comprobante. No se toca, pero se dice: un arreglo parcial nunca queda en silencio.
export function nearMissUnsureMessage(target, key) {
  return `\`${target}\`: si es el detalle del comprobante, \`${key}\` no es un campo de WSFEv1 y ARCA espera \`${FIELD}\`. `
    + 'No lo cambié porque no pude confirmar que sea el comprobante: revisalo a mano.';
}

// Frente B, punto 23: el tipo del repo declara la clave mal escrita. Renombrar solo el objeto rompe el tipado.
export function nearMissTypedMessage(key, decl, pack) {
  return `\`${key}\` no es un campo de WSFEv1: ARCA espera \`${FIELD}\`, así que hoy el dato no llega y desde el ${dmy(pack.deadline)} ARCA rechaza el CAE. `
    + `No lo renombré porque el tipo de \`${decl.file}:${decl.line}\` declara \`${key}\` y TypeScript dejaría de compilar: renombralo en los dos lugares (y en los tests que lo usen).`;
}

// Frente B, punto 22: con un \r suelto (\r\r\n) el parser cuenta una línea más que el archivo y la edición caía en
// otra línea. En esos archivos no se edita: se dice qué cambio hacer a mano.
export const LOOSE_EOL = /\r(?!\n)|[\u2028\u2029]/;
export function looseEolMessage(manual) {
  return 'No edité este archivo: tiene saltos de línea `\\r` sueltos (por ejemplo `\\r\\r\\n`) y Parche no puede ubicar el cambio con certeza. '
    + `Hacelo a mano: ${manual}.`;
}

// "El repo ya usa CondicionIVAReceptorId en otro lado": prefijo para bajar a "revisar" lo que no se pudo leer
// (en repos ya migrados, el objeto suele salir de un builder que sí pone el campo).
export function alreadyMigratedPrefix(context) {
  const f = context?.fieldFiles?.[0];
  return f ? `El repo ya usa CondicionIVAReceptorId (en \`${f}\`): verificá que este comprobante también lo lleve. ` : null;
}

// Si el campo puede no llegar a ARCA aunque esté en el código: librería 0.x (WSDL de 2021) o un WSDL viejo
// en el repo. Verificado en el código de afip.js/afip.php el 16/10/2026 (ver src/context.js).
export function libraryCaveat(context, ecosystem) {
  const lib = (context?.arcaLibs || []).find((l) => l.ecosystem === ecosystem && l.travels !== 'si');
  if (lib) {
    return `Ojo: con ${lib.name} ${lib.version} el pedido se arma con un WSDL de 2021 que no tiene este campo`
      + `${lib.travels === 'no' ? '' : ' (en JS falta confirmarlo)'}: para que llegue a ARCA hay que ${lib.fix || 'actualizar la librería a 1.x'}.`;
  }
  const wsdl = context?.staleWsdl?.[0];
  if (wsdl) return `Ojo: el repo tiene un WSDL de WSFEv1 sin este campo (\`${wsdl}\`): si el cliente SOAP lo usa, el campo no viaja hasta actualizarlo.`;
  return null;
}

// Integraciones SOAP propias (cualquier lenguaje): solo detección.
// Con menos ruido que la primera versión (frente B, 16/10): no marca tests, mocks, tipos, copias de la librería
// ni archivos que solo nombran el método (constantes, reexports); solo los que arman el detalle del comprobante.
export function soapDetection(source, file, context) {
  if (!/FECAESolicitar|FECAEDetRequest/.test(source) || /CondicionIVAReceptorId/.test(source)) return null;
  if (isTestFile(file) || /\.d\.[cm]?ts$/.test(file)) return null;
  if (/class\s+ElectronicBilling\b/.test(source)) return null; // copia de afip.php/afip.js: la cubren la versión y el WSDL
  const generated = /(^|\/)Reference\.cs$|Stub\.java$/i.test(file) || /class\s+FECAEDetRequest\b/.test(source);
  if (!generated && !/\b(DocTipo|CbteDesde|ImpTotal)\b/.test(source)) return null;
  const line = source.split('\n').findIndex((l) => /FECAESolicitar|FECAEDetRequest/.test(l)) + 1;
  const base = generated
    ? 'Cliente SOAP de WSFEv1 generado sin CondicionIVAReceptorId: hay que regenerarlo con el WSDL vigente (y después completar el campo).'
    : 'Integración SOAP propia con WSFEv1 sin CondicionIVAReceptorId en el FECAEDetRequest. Hay que agregarlo al XML, con la condición frente al IVA del cliente.';
  const prefix = alreadyMigratedPrefix(context);
  return {
    finding: { pack: PACK, file, line, status: prefix ? 'needs-review' : 'needs-input', message: (prefix || '') + base },
    usage: { provider: 'arca', op: generated ? 'WSFEv1 SOAP (cliente generado)' : 'WSFEv1 SOAP', line },
  };
}

// Archivos .wsdl de WSFEv1 sin el campo: si el cliente SOAP arma el pedido con ese esquema
// (SoapClient en modo WSDL, la librería soap de Node), el campo no viaja aunque esté en el código.
export function wsdlDetection({ source, file }) {
  const findings = [];
  const usages = [];
  if (/FECAESolicitar|FECAEDetRequest/.test(source) && !source.includes('CondicionIVAReceptorId')) {
    const line = source.split('\n').findIndex((l) => /FECAEDetRequest/.test(l)) + 1 || 1;
    findings.push({ pack: PACK, file, line, status: 'needs-input',
      message: 'WSDL de WSFEv1 sin CondicionIVAReceptorId: si tu cliente SOAP arma el pedido con este archivo, el campo no viaja aunque lo agregues al código. Reemplazalo por el WSDL vigente de WSFEv1.' });
    usages.push({ provider: 'arca', op: 'WSFEv1 WSDL', line });
  }
  return { output: null, findings, usages };
}

// Lenguajes sin codemod (Python, C#, Java, Go, VB.NET): solo la detección de SOAP propio o cliente generado.
export function soapOnly({ source, file, context }) {
  const soap = soapDetection(source, file, context);
  return { output: null, findings: soap ? [soap.finding] : [], usages: soap ? [soap.usage] : [] };
}
