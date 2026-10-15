const { MercadoPagoConfig, Payment } = require('mercadopago');

// Cobro en nombre de un vendedor del marketplace (Split 1:1).
async function cobrarParaVendedor(accessTokenVendedor, { monto, token, email, comision }) {
  const client = new MercadoPagoConfig({ accessToken: accessTokenVendedor });
  const payment = new Payment(client);
  return payment.create({
    body: {
      transaction_amount: monto,
      token,
      installments: 1,
      payment_method_id: 'visa',
      payer: { email },
      application_fee: comision,
    },
  });
}

module.exports = { cobrarParaVendedor };
