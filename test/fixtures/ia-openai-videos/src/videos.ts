// Generación de video con la Videos API de OpenAI desde el SDK de Node (cerró el 24/9/2026).
import fs from 'node:fs';
import OpenAI from 'openai';

const openai = new OpenAI();

export async function generar(prompt: string) {
  const video = await openai.videos.create({ model: 'sora-2', prompt, seconds: '8' });
  let actual = await openai.videos.retrieve(video.id);
  while (actual.status === 'queued' || actual.status === 'in_progress') {
    await new Promise((r) => setTimeout(r, 5000));
    actual = await openai.videos.retrieve(video.id);
  }
  const contenido = await openai.videos.downloadContent(video.id);
  fs.writeFileSync('video.mp4', Buffer.from(await contenido.arrayBuffer()));
  return actual;
}

export const otraVersion = (id: string) => openai.videos.remix(id, { prompt: 'de noche' });
export const listar = () => openai.videos.list({ limit: 10 });
export const borrar = (id: string) => openai.videos.delete(id);
export const personaje = (id: string) => openai.videos.getCharacter(id);
export const porHttp = (id: string) => fetch(`https://api.openai.com/v1/videos/${id}`, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
