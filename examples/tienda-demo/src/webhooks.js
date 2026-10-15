import express from 'express';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { marcarPagado } from './db.js';

const payment = new Payment(new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN }));
export const webhooks = express.Router();

webhooks.post('/webhooks/mp', async (req, res) => {
  if (req.query.topic === 'payment' || req.body.type === 'payment') {
    const id = req.body.data?.id ?? req.query.id;
    const pago = await payment.get({ id });
    if (pago.status === 'approved') {
      await marcarPagado(pago.external_reference);
    }
  }
  res.sendStatus(200);
});
