import axios from 'axios';
import got from 'got';
import { ClimaClient } from 'clima-api-client';

const GITHUB = 'https://api.github.com';
const meli = axios.create({ baseURL: 'https://api.mercadolibre.com' });
const clima = new ClimaClient({ key: process.env.CLIMA_KEY });

// GitHub por HTTP directo, con una plantilla y una constante del archivo.
export async function issuesAbiertos(owner, repo) {
  const res = await fetch(`${GITHUB}/repos/${owner}/${repo}/issues?state=open`, { headers: { Accept: 'application/vnd.github+json' } });
  return res.json();
}

// Mercado Libre con una instancia de axios.
export async function publicarItem(item) {
  return meli.post('/items', item);
}

// Una API que no está en la lista curada: se lista igual, con confianza media.
export async function precioDolar() {
  return got('https://api.bluelytics.com.ar/v2/latest').json();
}

// Un SDK que no está en la lista: se reconoce por el nombre ("api-client").
export async function pronostico(ciudad) {
  return clima.forecast.get({ ciudad });
}

// URL que llega de afuera: no se puede saber el host.
export async function llamarWebhook(url, payload) {
  return fetch(url, { method: 'POST', body: JSON.stringify(payload) });
}

// El propio backend: no es una API de terceros.
export async function salud() {
  return fetch('http://localhost:3000/salud');
}
