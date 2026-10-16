const twilio = require('twilio');

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

async function avisarPorSms(telefono, texto) {
  return client.messages.create({ to: telefono, from: process.env.TWILIO_FROM, body: texto });
}

module.exports = { avisarPorSms };
