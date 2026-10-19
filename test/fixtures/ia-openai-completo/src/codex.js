// gpt-5.1, gpt-5.3-codex y gpt-5.4-nano: OpenAI los apaga el 1/4/2027 (sección del 1/10/2026).
import OpenAI from 'openai';

const openai = new OpenAI();

export const planificar = (input) => openai.responses.create({ model: 'gpt-5.1', input });
export const programar = (input) => openai.responses.create({ model: 'gpt-5.3-codex', input });
export const resumir = (input) => openai.responses.create({ model: 'gpt-5.4-nano', input });
