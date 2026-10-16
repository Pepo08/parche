import OpenAI from 'openai';

const openai = new OpenAI();

export async function resumir(texto: string): Promise<string> {
  const r = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: `Resumí: ${texto}` }],
  });
  return r.choices[0].message.content ?? '';
}

export async function vectorizar(texto: string) {
  return openai.embeddings.create({ model: 'text-embedding-3-small', input: texto });
}
