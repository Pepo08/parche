<?php
// Script viejo de facturación de mostrador (Factura C, monotributo).
require __DIR__ . '/../vendor/autoload.php';

$afip = new Afip(array('CUIT' => 20111111112));
$res = $afip->ElectronicBilling->createNextVoucher(array('CantReg' => 1, 'PtoVta' => 1, 'CbteTipo' => 11, 'Concepto' => 1, 'DocTipo' => 99, 'DocNro' => 0, 'CbteFch' => intval(date('Ymd')), 'ImpTotal' => 100, 'ImpNeto' => 100, 'MonId' => 'PES', 'MonCotiz' => 1));
echo $res['CAE'] . PHP_EOL;
