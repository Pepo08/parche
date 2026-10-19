// Modelos fine-tuned con el formato real de OpenAI: ft:<modelo base>:<org>:<sufijo>:<id>.
import OpenAI from 'openai';

const openai = new OpenAI();

export const soporte = (input: string) =>
  openai.responses.create({ model: 'ft:gpt-3.5-turbo-0125:acme:soporte:96olL566:ckpt-step-2000', input });

export const ventas = (input: string) =>
  openai.chat.completions.create({ model: "ft:gpt-3.5-turbo:acme::8AbCdEf", messages: [{ role: 'user', content: input }] });

export const legal = (input: string) =>
  openai.chat.completions.create({ model: 'ft:gpt-4-0613:acme:legal:9XyZ12', messages: [{ role: 'user', content: input }] });

export const etiquetas = (input: string) =>
  openai.responses.create({ model: 'ft:gpt-4.1-nano-2025-04-14:openai::BTz2REMH', input });

export const razonar = (input: string) =>
  openai.responses.create({ model: 'ft:o4-mini-2025-04-16:acme:rft:Q1w2E3', input });

export const MODELOS_PROPIOS = ['ft:gpt-4:acme:viejo:7Hh8Jj'];
