// JavaScript con el SDK 1.0.0: el modelo llega de la configuración, pero el parámetro falla igual.
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

async function clasificar(config, texto) {
  return client.messages.create({ model: config.modelo, max_tokens: 16, top_p: 0.9, messages: [{ role: 'user', content: texto }] });
}

module.exports = { clasificar };
