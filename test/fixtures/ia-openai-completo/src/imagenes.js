// Modelos de imagen que OpenAI apaga el 1/12/2026 (sección del 2/6/2026).
import OpenAI from 'openai';

const openai = new OpenAI();

export const logo = (prompt) => openai.images.generate({ model: 'gpt-image-1-mini', prompt });
export const banner = (prompt) => openai.images.generate({ model: "gpt-image-1.5", prompt });
export const foto = (prompt) => openai.images.generate({ model: 'chatgpt-image-latest', prompt });
