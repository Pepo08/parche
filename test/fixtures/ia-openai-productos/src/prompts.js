// Prompts reutilizables de OpenAI (objetos de prompt): la API v1/prompts y los objetos cierran el 30/11/2026.
import OpenAI from 'openai';

const client = new OpenAI();

export async function responderSoporte(cliente, consulta) {
  return client.responses.create({
    prompt: {
      id: 'pmpt_68b2c0ffee5e8190a1b2c3d4e5f60718',
      version: '3',
      variables: { customer_name: cliente, issue: consulta },
    },
  });
}

export const PROMPT_BIENVENIDA = "pmpt_123";

export async function versiones(id) {
  const r = await fetch(`https://api.openai.com/v1/prompts/${id}/versions`, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  });
  return r.json();
}
