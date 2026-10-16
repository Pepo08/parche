// Asistente escrito con el SDK de OpenAI v3 (antes de la reescritura de la v4).
const { Configuration, OpenAIApi } = require('openai');

const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

async function responder(pregunta) {
  const r = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: pregunta }],
  });
  return r.data.choices[0].message.content;
}

async function vectorizar(texto) {
  const r = await openai.createEmbedding({ model: 'text-embedding-ada-002', input: texto });
  return r.data.data[0].embedding;
}

module.exports = { responder, vectorizar };
