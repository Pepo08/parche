import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const anthropic = new Anthropic();
const openai = new OpenAI();

export async function resumirReclamo(texto) {
  const msg = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 300,
    messages: [{ role: 'user', content: `Resumí este reclamo en una línea:\n\n${texto}` }],
  });
  return msg.content[0].text;
}

export async function crearAsistenteDeSoporte() {
  return openai.beta.assistants.create({
    name: 'Soporte Tienda Demo',
    model: 'gpt-4o',
    instructions: 'Respondé dudas sobre envíos y devoluciones.',
  });
}
