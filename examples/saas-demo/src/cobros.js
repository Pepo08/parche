import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function cobrar(clienteId, monto) {
  const intent = await stripe.paymentIntents.create({ amount: monto, currency: 'usd', customer: clienteId });
  return intent.client_secret;
}

export async function alta(email) {
  return stripe.customers.create({ email });
}

export async function reembolsar(pagoId) {
  return stripe.refunds.create({ payment_intent: pagoId });
}
