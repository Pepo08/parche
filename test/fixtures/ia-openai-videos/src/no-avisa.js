// Resumidor de videos de YouTube con GPT: el archivo usa el SDK de OpenAI, pero los `videos` son los de YouTube.
import { google } from 'googleapis';
import OpenAI from 'openai';

const openai = new OpenAI();
const youtube = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });

export async function resumir(videoId) {
  const { data } = await youtube.videos.list({ part: ['snippet'], id: [videoId] });
  const stats = await google.youtube('v3').videos.list({ part: ['statistics'], id: [videoId] });
  const r = await openai.responses.create({ model: 'gpt-5.6-terra', input: `Resumí: ${data.items[0].snippet.description}` });
  return { resumen: r.output_text, vistas: stats.data.items[0].statistics.viewCount };
}

export const subir = (media) => youtube.videos.insert({ part: ['snippet'], media });

// Vimeo y la Data API de YouTube por HTTP: rutas `/videos` que no son las de OpenAI.
export const vimeo = (id) => fetch(`https://api.vimeo.com/videos/${id}`);
export const yt = (id) => fetch(`https://www.googleapis.com/youtube/v3/videos?id=${id}&part=snippet`);
