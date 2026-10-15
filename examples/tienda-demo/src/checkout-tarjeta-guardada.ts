import { MercadoPagoConfig, Payment } from 'mercadopago';
import { v4 as uuid } from 'uuid';

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN as string });
const pagos = new Payment(client);

interface CobroGuardado {
  customerId: string;
  cardToken: string;
  monto: number;
  paymentMethodId: string;
  paymentTypeId: 'credit_card' | 'debit_card';
  sku: string;
}

export async function reservarConTarjetaGuardada(input: CobroGuardado): Promise<string> {
  const res = await pagos.create({
    body: {
      transaction_amount: input.monto,
      token: input.cardToken,
      installments: 1,
      payment_method_id: input.paymentMethodId,
      payment_type_id: input.paymentTypeId,
      capture: false,
      external_reference: `reserva-${input.sku}`,
      payer: { type: 'customer', id: input.customerId },
      items: [{ id: input.sku, title: 'Reserva', quantity: 1, unit_price: input.monto }],
    },
    requestOptions: { idempotencyKey: uuid() },
  });

  switch (res.status) {
    case 'authorized':
      return 'reservado';
    case 'rejected':
      return 'rechazado';
    case 'cancelled':
      return 'cancelado';
    default:
      return 'pendiente';
  }
}
