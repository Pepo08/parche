import express from 'express';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { guardarPedido } from './db.js';

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(client);

export const router = express.Router();

router.post('/checkout/tarjeta', async (req, res) => {
  const { amount, token, installments, payment_method_id, issuer_id, email, dni, pedidoId } = req.body;

  const result = await payment.create({
    body: {
      transaction_amount: Number(amount),
      token,
      description: 'Compra en Tienda Demo',
      installments: Number(installments),
      payment_method_id,
      issuer_id,
      payer: {
        email,
        identification: { type: 'DNI', number: dni },
      },
      notification_url: 'https://tiendademo.com.ar/webhooks/mp',
      statement_descriptor: 'TIENDADEMO',
      external_reference: pedidoId,
      three_d_secure_mode: 'optional',
    },
  });

  await guardarPedido({
    pedidoId,
    mpId: Number(result.id),
    creado: result.date_created,
  });

  if (result.status === 'approved') {
    return res.json({ ok: true });
  } else if (result.status === 'rejected' && result.status_detail === 'cc_rejected_insufficient_amount') {
    return res.status(402).json({ ok: false, motivo: 'Fondos insuficientes' });
  }
  return res.status(202).json({ ok: false, estado: result.status });
});
