import Afip from '@afipsdk/afip.js';

const afip = new Afip({ CUIT: Number(process.env.AFIP_CUIT) });
const PTO_VTA = 3;

function hoy() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0].replace(/-/g, '');
}

// Factura B a consumidor final sin identificar (ventas de mostrador / e-commerce).
export async function facturarConsumidorFinal(total) {
  const neto = +(total / 1.21).toFixed(2);
  const iva = +(total - neto).toFixed(2);
  return afip.ElectronicBilling.createNextVoucher({
    'CantReg': 1,
    'PtoVta': PTO_VTA,
    'CbteTipo': 6,
    'Concepto': 1,
    'DocTipo': 99,
    'DocNro': 0,
    'CbteFch': hoy(),
    'ImpTotal': total,
    'ImpTotConc': 0,
    'ImpNeto': neto,
    'ImpOpEx': 0,
    'ImpIVA': iva,
    'ImpTrib': 0,
    'MonId': 'PES',
    'MonCotiz': 1,
    'Iva': [{ 'Id': 5, 'BaseImp': neto, 'Importe': iva }],
  });
}

// Factura B a una persona identificada con DNI.
export async function facturarConDni(dni, total) {
  const neto = +(total / 1.21).toFixed(2);
  const iva = +(total - neto).toFixed(2);
  const data = {
    'CantReg': 1,
    'PtoVta': PTO_VTA,
    'CbteTipo': 6,
    'Concepto': 1,
    'DocTipo': 96,
    'DocNro': dni,
    'CbteFch': hoy(),
    'ImpTotal': total,
    'ImpTotConc': 0,
    'ImpNeto': neto,
    'ImpOpEx': 0,
    'ImpIVA': iva,
    'ImpTrib': 0,
    'MonId': 'PES',
    'MonCotiz': 1,
    'Iva': [{ 'Id': 5, 'BaseImp': neto, 'Importe': iva }],
  };
  return afip.ElectronicBilling.createNextVoucher(data);
}

// Factura A a una empresa (CUIT).
export async function facturarEmpresa(cuit, neto) {
  const iva = +(neto * 0.21).toFixed(2);
  return afip.ElectronicBilling.createNextVoucher({
    'CantReg': 1,
    'PtoVta': PTO_VTA,
    'CbteTipo': 1,
    'Concepto': 2,
    'DocTipo': 80,
    'DocNro': cuit,
    'CbteFch': hoy(),
    'ImpTotal': +(neto + iva).toFixed(2),
    'ImpTotConc': 0,
    'ImpNeto': neto,
    'ImpOpEx': 0,
    'ImpIVA': iva,
    'ImpTrib': 0,
    'MonId': 'PES',
    'MonCotiz': 1,
    'Iva': [{ 'Id': 5, 'BaseImp': neto, 'Importe': iva }],
  });
}
