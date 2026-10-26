// De los datos de un mail (la forma de `test/fixtures/resumen/semanal.json`) al asunto, el HTML y el texto, con las
// plantillas de `templates/resumen/`. Es lo que calcula `web-src/resumen/armar.mjs` del chat de página (fechas, días que
// faltan, conteos, la línea de la corrida), copiado para que el resultado sea el mismo que su diseño. Lo propio de
// Parche está marcado: la línea de los packs que no se pudieron completar.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engine } from './mustache.js';

export const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'resumen');
// Gmail recorta el mensaje arriba de ~102 KB de HTML y esconde el resto detrás de "Ver mensaje completo".
export const GMAIL_LIMIT = 102 * 1024;

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SEGUIMIENTO = ['nuevo', 'pendiente', 'en curso', 'resuelto', 'descartado'];

// Fechas de calendario (sin hora): la de envío y las de los packs son días de Buenos Aires.
const partes = (iso) => { const [a, m, d] = iso.split('-').map(Number); return { a, m, d, t: Date.UTC(a, m - 1, d) }; };
export const corta = (iso) => { const f = partes(iso); return `${f.d}/${f.m}`; };
export const larga = (iso) => `${corta(iso)}/${partes(iso).a}`;
const diaDe = (iso) => `${DIAS[new Date(partes(iso).t).getUTCDay()]} ${corta(iso)}`;
export const diasEntre = (desde, hasta) => Math.round((partes(hasta).t - partes(desde).t) / 86400000);
export const sumarDias = (iso, n) => new Date(partes(iso).t + n * 86400000).toISOString().slice(0, 10);
export const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function vencimiento(iso, hoy, rompe) {
  if (!iso) return { con_fecha: false, rojo: false, vence_frase: 'Sin fecha límite.' };
  const n = diasEntre(hoy, iso);
  const rel = n > 1 ? `faltan ${n} días` : n === 1 ? 'falta 1 día' : n === 0 ? 'vence hoy' : n === -1 ? 'venció ayer' : `venció hace ${-n} días`;
  return {
    con_fecha: true,
    // Rojo: el cambio rompe en esa fecha (o ya rompió). Un pack con fecha que no rompe lo dice con `rompe: false`.
    rojo: rompe !== false,
    vencio: n < 0,
    vence_anio: String(partes(iso).a),
    vence_dias_txt: rel,
    vence_frase: n >= 0 ? `Vence el ${larga(iso)} (${rel}).` : `Venció el ${larga(iso)}.`,
  };
}

// Recorre los datos: cada fecha ISO suma su forma corta y larga (`x_corto`, `x_largo`), cada `vence` sus días y su color,
// cada `seguimiento` su marca, y cada lista `donde` su texto.
function derivar(v, hoy) {
  if (Array.isArray(v)) return v.map((x) => derivar(x, hoy));
  if (v === null || typeof v !== 'object') return v;
  const o = {};
  for (const [k, x] of Object.entries(v)) {
    o[k] = derivar(x, hoy);
    if (typeof x === 'string' && ISO.test(x)) { o[`${k}_corto`] = corta(x); o[`${k}_largo`] = larga(x); }
  }
  if ('vence' in v) Object.assign(o, vencimiento(v.vence, hoy, v.rompe));
  if ('seguimiento' in v) {
    if (!SEGUIMIENTO.includes(v.seguimiento)) throw new Error(`Seguimiento desconocido: ${v.seguimiento}`);
    o.seguimiento_may = v.seguimiento.toUpperCase();
    o[`seg_${v.seguimiento.replace(' ', '_')}`] = true;
  }
  if (Array.isArray(v.donde)) o.donde_txt = v.donde.join(', ') + (v.donde_mas ? ` ${v.donde_mas}` : '');
  return o;
}

function corridaTxt({ dia, repos, fallas = [], no_se_pudo: noSePudo = [] }) {
  const cuando = `el ${diaDe(dia)}`;
  // Propio de Parche: en un repo, los packs que la corrida no pudo completar (la verificación, la API de GitHub).
  if (noSePudo.length) return `Parche corrió ${cuando}, pero no pudo completar ${plural(noSePudo.length, 'pack', 'packs')}.`;
  if (!fallas.length) {
    return repos === 1
      ? `Parche corrió ${cuando} y la corrida terminó bien.`
      : `Parche corrió ${cuando} en los ${repos} repos, y las ${repos} corridas terminaron bien.`;
  }
  const bien = repos - fallas.length;
  return `Parche corrió ${cuando} en ${plural(repos, 'repo', 'repos')}: ${plural(bien, 'terminó bien', 'terminaron bien')}.`;
}

function estilosDe(dir) {
  const crudo = JSON.parse(fs.readFileSync(path.join(dir, 'estilos.json'), 'utf8'));
  const estilos = {};
  for (const [k, v] of Object.entries(crudo)) {
    if (!k.startsWith('_')) estilos[k] = v.replace(/\$(cond|sans|mono) ?/g, (_, f) => crudo._fuentes[f]);
  }
  return estilos;
}

function contexto(datos, { estilos, encabezados, render }) {
  const hoy = datos.fecha_envio;
  const c = derivar(datos, hoy);
  const f = partes(hoy);
  c.e = estilos;
  c.fecha_envio_dia = diaDe(hoy);
  c.dia_semana = DIAS[new Date(f.t).getUTCDay()];
  c.quien = datos.cliente || datos.agencia;
  c.pie_ci = datos.cliente ? `en el CI de ${datos.cliente}` : 'en el CI de cada cliente';
  c.mes_nombre = MESES[(datos.mes ? partes(`${datos.mes}-01`).m : f.m) - 1];
  c.mes_anio = datos.mes ? partes(`${datos.mes}-01`).a : f.a;
  if (datos.corrida) c.corrida_txt = corridaTxt(datos.corrida);
  if (datos.clientes) {
    c.varios_clientes = datos.clientes.length > 1;
    let hacer = 0;
    let nuevos = 0;
    for (const cl of c.clientes) {
      hacer += cl.para_hacer?.length || 0;
      nuevos += cl.nuevos?.length || 0;
      // Propio de Parche: "1 API en 1 repo" (el diseño suponía varios).
      if (cl.apis) Object.assign(cl.apis, { total_txt: plural(cl.apis.total, 'API', 'APIs'), repos_txt: plural(cl.apis.repos, 'repo', 'repos') });
    }
    c.conteo_txt = hacer || nuevos ? `${hacer} para hacer, ${nuevos ? plural(nuevos, 'nuevo', 'nuevos') : 'nada nuevo'}` : 'nada para hacer';
    // Propio de Parche: sin la foto anterior no se sabe qué es nuevo, así que no se dice "nada nuevo".
    if (datos.sin_anterior) c.conteo_txt = hacer ? `${hacer} para hacer` : 'nada para hacer';
    c.conteo_titular = hacer || nuevos ? c.conteo_txt : 'Nada para hacer esta semana';
    c.vacio = !hacer && !nuevos;
  }
  if (datos.conteo_mes) {
    const { cambios, resueltos, en_curso: enCurso, pendientes } = datos.conteo_mes;
    c.cambios_txt = plural(cambios, 'cambio de API', 'cambios de API');
    c.conteo_mes_txt = [
      `${resueltos} ${resueltos === 1 ? 'está resuelto' : 'están resueltos'}`,
      `${enCurso} ${enCurso === 1 ? 'está en curso' : 'están en curso'}`,
      `${pendientes} ${pendientes === 1 ? 'está pendiente' : 'están pendientes'}`,
    ].join(', ').replace(/, ([^,]*)$/, ' y $1');
  }
  if (datos.mail === 'mensual') c.ventana_hasta_largo = larga(sumarDias(hoy, 90));
  // Asunto, texto de vista previa, etiqueta de la banda y línea de datos: plantillas cortas de `encabezados.json`.
  for (const [k, tpl] of Object.entries(encabezados[datos.mail])) c[k] = render(tpl, c, { formato: 'txt', nombre: `encabezados.${k}` }).texto;
  return c;
}

// Arma un mail. `faltan`: las claves que las plantillas pidieron y los datos no tenían (en un armado completo, ninguna).
export function renderMail(datos, { dir = TEMPLATES } = {}) {
  const estilos = estilosDe(dir);
  const encabezados = JSON.parse(fs.readFileSync(path.join(dir, 'encabezados.json'), 'utf8'));
  const render = engine(dir, { codigo: estilos.codigo });
  const ctx = contexto(datos, { estilos, encabezados, render });
  const leer = (ext) => fs.readFileSync(path.join(dir, `${datos.mail}.${ext}`), 'utf8');
  const html = render(leer('html'), ctx, { formato: 'html', nombre: `${datos.mail}.html` });
  const txt = render(leer('txt'), ctx, { formato: 'txt', nombre: `${datos.mail}.txt` });
  return {
    asunto: ctx.asunto,
    previa: ctx.previa,
    html: html.texto,
    txt: `Asunto: ${ctx.asunto}\n\n${txt.texto}`.replace(/\n{3,}/g, '\n\n'),
    faltan: [...new Set([...html.faltan, ...txt.faltan])],
  };
}
