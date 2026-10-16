<?php

namespace Tienda;

use Afip;

// Facturación electrónica de la tienda con afipsdk/afip.php.
class Facturacion
{
    private $afip;

    public function __construct()
    {
        $this->afip = new Afip(array('CUIT' => (int) getenv('AFIP_CUIT')));
    }

    // Factura B a consumidor final sin identificar (mostrador y e-commerce).
    public function consumidorFinal($total)
    {
        $neto = round($total / 1.21, 2);
        $data = array(
            'CantReg'    => 1,
            'PtoVta'     => 3,
            'CbteTipo'   => 6,
            'Concepto'   => 1,
            'DocTipo'    => 99,
            'DocNro'     => 0,
            'CbteFch'    => intval(date('Ymd')),
            'ImpTotal'   => $total,
            'ImpTotConc' => 0,
            'ImpNeto'    => $neto,
            'ImpOpEx'    => 0,
            'ImpIVA'     => round($total - $neto, 2),
            'ImpTrib'    => 0,
            'MonId'      => 'PES',
            'MonCotiz'   => 1,
        );
        $data['Iva'] = array(
            array('Id' => 5, 'BaseImp' => $neto, 'Importe' => round($total - $neto, 2)),
        );

        return $this->afip->ElectronicBilling->CreateNextVoucher($data);
    }

    // Factura B a un cliente identificado con DNI.
    public function conDni($dni, $total)
    {
        $neto = round($total / 1.21, 2);
        $res = $this->afip->ElectronicBilling->CreateVoucher([
            'CantReg' => 1,
            'PtoVta' => 3,
            'CbteTipo' => 6,
            'Concepto' => 1,
            'DocTipo' => 96,
            'DocNro' => $dni,
            'CbteDesde' => 1,
            'CbteHasta' => 1,
            'CbteFch' => intval(date('Ymd')),
            'ImpTotal' => $total,
            'ImpNeto' => $neto,
            'ImpIVA' => round($total - $neto, 2),
            'MonId' => 'PES',
            'MonCotiz' => 1,
        ], true);

        return $res['CAE'];
    }

    // Factura A a una empresa (CUIT): la condición frente al IVA depende del cliente.
    public function facturaA($cuit, $total)
    {
        $neto = round($total / 1.21, 2);
        $data = [
            'CantReg' => 1,
            'PtoVta' => 3,
            'CbteTipo' => 1,
            'Concepto' => 1,
            'DocTipo' => 80,
            'DocNro' => $cuit,
            'CbteFch' => intval(date('Ymd')),
            'ImpTotal' => $total,
            'ImpNeto' => $neto,
            'ImpIVA' => round($total - $neto, 2),
            'MonId' => 'PES',
            'MonCotiz' => 1,
        ];

        return $this->afip->ElectronicBilling->CreateNextVoucher($data);
    }

    // Los datos llegan armados desde otro lado: no se pueden leer acá.
    public function reemitir(array $comprobante)
    {
        return $this->afip->ElectronicBilling->CreateNextVoucher($comprobante);
    }
}
