// Reglas del pack arca.wsfe.condicion-iva-receptor, compartidas por los codemods de JS y de PHP:
// qué se puede inferir sin datos del negocio y con qué mensajes se reporta.

export const PACK = 'arca.wsfe.condicion-iva-receptor';

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

// Integraciones SOAP propias (cualquier lenguaje): solo detección.
export function soapDetection(source, file) {
  if (!/FECAESolicitar|FECAEDetRequest/.test(source) || /CondicionIVAReceptorId/.test(source)) return null;
  const line = source.split('\n').findIndex((l) => /FECAESolicitar|FECAEDetRequest/.test(l)) + 1;
  return {
    finding: { pack: PACK, file, line, status: 'needs-input',
      message: 'Integración SOAP propia con WSFEv1 sin CondicionIVAReceptorId en el FECAEDetRequest. Hay que agregarlo al XML.' },
    usage: { provider: 'arca', op: 'WSFEv1 SOAP', line },
  };
}
