// Llamadas directas a la API de Messages, sin SDK (fetch y axios). En el mismo archivo, un cliente de OpenAI apuntado a
// la capa compatible de Anthropic: eso no es la API de Messages y no se avisa.
import axios from 'axios';
import OpenAI from 'openai';

const URL = 'https://api.anthropic.com/v1/messages';
const headers = { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };

export async function preguntar(texto) {
  const res = await fetch(URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 512,
      temperature: 0.7,
      messages: [{ role: 'user', content: texto }],
    }),
  });
  return res.json();
}

export const conAxios = (texto) => axios.post(URL, {
  "model": "claude-opus-5-5",
  "max_tokens": 100,
  "top_p": 0.5,
  "messages": [{ "role": "user", "content": texto }],
}, { headers });

const compat = new OpenAI({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: 'https://api.anthropic.com/v1/' });
export const viaOpenAI = (texto) => compat.chat.completions.create({
  model: 'claude-opus-4-7',
  max_tokens: 100,
  temperature: 0.5,
  messages: [{ role: 'user', content: texto }],
});
