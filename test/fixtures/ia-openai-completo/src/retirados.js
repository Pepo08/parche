// Modelos y APIs que OpenAI ya apagó en 2026 y el pack no tenía: las llamadas ya fallan.
import OpenAI from 'openai';
import WebSocket from 'ws';

const openai = new OpenAI();

// 23/7/2026 (sección "2026-04-22: Legacy GPT model snapshots (July 2026 shutdown)").
export const navegar = (input) => openai.responses.create({ model: 'computer-use-preview', input });
export const navegarFijo = (input) => openai.responses.create({ model: 'computer-use-preview-2025-03-11', input });
export const buscar = (input) => openai.responses.create({ model: 'gpt-4o-search-preview-2025-03-11', input });
export const buscarMini = (input) => openai.responses.create({ model: 'gpt-4o-mini-search-preview-2025-03-11', input });
export const charlar = (input) => openai.responses.create({ model: 'gpt-5-chat-latest', input });
export const charlar51 = (input) => openai.responses.create({ model: 'gpt-5.1-chat-latest', input });
export const programar = (input) => openai.responses.create({ model: 'gpt-5-codex', input });
export const programar51 = (input) => openai.responses.create({ model: 'gpt-5.1-codex', input });
export const programarMax = (input) => openai.responses.create({ model: 'gpt-5.1-codex-max', input });
export const programarMini = (input) => openai.responses.create({ model: 'gpt-5.1-codex-mini', input });
export const programar52 = (input) => openai.responses.create({ model: 'gpt-5.2-codex', input });
export const vozMini = (input) => openai.responses.create({ model: 'gpt-audio-mini-2025-10-06', input });
export const realtimeMini = (input) => openai.responses.create({ model: 'gpt-realtime-mini-2025-10-06', input });
export const investigar = (input) => openai.responses.create({ model: 'o3-deep-research', input });
export const investigarFijo = (input) => openai.responses.create({ model: 'o3-deep-research-2025-06-26', input });
export const investigarMini = (input) => openai.responses.create({ model: 'o4-mini-deep-research', input });
export const investigarMiniFijo = (input) => openai.responses.create({ model: 'o4-mini-deep-research-2025-06-26', input });

// 10/8/2026.
export const charlar52 = (input) => openai.responses.create({ model: 'gpt-5.2-chat-latest', input });
export const charlar53 = (input) => openai.responses.create({ model: 'gpt-5.3-chat-latest', input });

// 24/9/2026: Sora 2 (sin reemplazo).
export const video = (prompt) => openai.videos.create({ model: 'sora-2', prompt });
export const videoPro = (prompt) => openai.videos.create({ model: 'sora-2-pro', prompt });
export const videoOctubre = (prompt) => openai.videos.create({ model: 'sora-2-2025-10-06', prompt });
export const videoDiciembre = (prompt) => openai.videos.create({ model: 'sora-2-2025-12-08', prompt });
export const videoProOctubre = (prompt) => openai.videos.create({ model: 'sora-2-pro-2025-10-06', prompt });

// 1/10/2026.
export const auditar = (input) => openai.responses.create({ model: 'gpt-5.4-cyber', input });

// 7/5/2026: las filas que faltaban de la sección de gpt-4o-realtime-preview.
export const realtimeMiniPreview = (input) => openai.responses.create({ model: 'gpt-4o-mini-realtime-preview', input });
export const audioPreview = (messages) => openai.chat.completions.create({ model: 'gpt-4o-audio-preview', messages });
export const audioMiniPreview = (messages) => openai.chat.completions.create({ model: 'gpt-4o-mini-audio-preview', messages });

// 26/3/2026.
export const completar = (prompt) => openai.completions.create({ model: 'gpt-4-turbo-preview-completions', prompt });

// 12/5/2026: Realtime API Beta.
export const conectar = (url, key) => new WebSocket(url, { headers: { Authorization: `Bearer ${key}`, 'OpenAI-Beta': 'realtime=v1' } });
