// api.video también tiene `client.videos.create(`, y otros proveedores tienen `/v1/videos`: el archivo no usa
// el SDK ni el host de OpenAI, así que Parche no avisa.
import ApiVideoClient from '@api.video/nodejs-client';

const client = new ApiVideoClient({ apiKey: process.env.APIVIDEO_API_KEY });

export async function subir(archivo) {
  const video = await client.videos.create({ title: 'Clase 1' });
  return client.videos.upload(video.videoId, archivo);
}

export const otro = () => fetch('https://api.example-video.dev/v1/videos');
