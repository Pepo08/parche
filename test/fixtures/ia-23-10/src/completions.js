// Alias "-completions" de la Completions API vieja (OpenAI los apaga el 23/10/2026).
import OpenAI from 'openai';

const openai = new OpenAI();

export async function resumir(texto) {
  const r = await openai.completions.create({ model: 'gpt-3.5-turbo-completions', prompt: texto, max_tokens: 200 });
  return r.choices[0].text;
}

export async function clasificar(texto) {
  const r = await openai.completions.create({ model: "gpt-4-completions", prompt: texto });
  return r.choices[0].text;
}

export const completar = (prompt) => openai.completions.create({ model: 'gpt-4-0613-completions', prompt });

export const DEFAULT_MODEL = `gpt-4-turbo-completions`;
