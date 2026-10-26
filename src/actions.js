// Lo que se ve en GitHub Actions además de los PRs: el resumen del job ($GITHUB_STEP_SUMMARY) y las anotaciones
// (::warning) con archivo y línea. Sin esto, los avisos de los packs de solo detección (IA) y lo que queda sin PR
// (falta un dato, o no hay código para cambiar) se perdían dentro del runner (sesión del 23/10, D67).
import path from 'node:path';
import { LABEL } from './report.js';

// Comandos de workflow de GitHub: el mensaje escapa %, \r y \n; las propiedades (file, title), además, ":" y ",".
export const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
export const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

// GitHub muestra hasta 10 anotaciones de advertencia por paso: las primeras van como anotación y todas en el resumen.
export const MAX_ANNOTATIONS = 10;

// Grupos { pack, findings } de un resultado del motor, en el orden de los packs y sin los packs vacíos.
export const byPack = (result) => result.packs
  .map((pack) => ({ pack, findings: result.findings.filter((f) => f.pack === pack.id) }))
  .filter((g) => g.findings.length);

// Prefijo para que la ruta del hallazgo (relativa a la carpeta que se revisó) sea relativa a la raíz del checkout,
// que es lo que espera una anotación. Si la carpeta está fuera del checkout, no hay prefijo válido: null.
export function workspacePrefix(root, workspace) {
  if (!workspace) return '';
  const rel = path.relative(path.resolve(workspace), path.resolve(root));
  if (rel === '') return '';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return `${rel.split(path.sep).join('/')}/`;
}

// Una anotación por hallazgo, hasta MAX_ANNOTATIONS. Sin prefijo válido, el archivo y la línea van en el mensaje.
export function annotations(groups, prefix = '') {
  const out = [];
  for (const { pack, findings } of groups) {
    for (const f of findings) {
      if (out.length === MAX_ANNOTATIONS) return out;
      const where = `${f.file}${f.line ? `:${f.line}` : ''}`;
      const props = prefix === null ? [] : [`file=${escapeProperty(prefix + f.file)}`, ...(f.line ? [`line=${f.line}`] : [])];
      props.push(`title=${escapeProperty(`Parche · ${pack.title}`)}`);
      out.push(`::warning ${props.join(',')}::${escapeData(prefix === null ? `${where}: ${f.message}` : f.message)}`);
    }
  }
  return out;
}

// Qué pasó con un PR que ya existía (src/publish.js, P9).
const EXISTING = {
  updated: 'ya estaba abierto: se actualizó con el arreglo de hoy',
  unchanged: 'ya estaba abierto con este mismo arreglo: no se tocó',
  kept: 'la rama tiene commits de otra persona: Parche no la pisa (si querés que la rehaga, cerrá el PR y borrá la rama)',
};

// El resumen del job: los PRs de esta corrida, lo que quedó sin PR, los avisos de solo detección y los packs que fallaron.
// opened: [{ title, url, draft, status }] (url null en modo prueba; status, el de publishPr); reportOnly y notices:
// grupos { pack, findings }; failed: [{ pack, message }].
export function stepSummary({ opened = [], reportOnly = [], notices = [], failed = [] }) {
  const lines = ['## Parche', ''];
  if (opened.length) {
    lines.push('### PRs', '');
    for (const o of opened) {
      const note = EXISTING[o.status] ? ` · ${EXISTING[o.status]}` : o.draft ? ' · borrador' : '';
      if (o.url) lines.push(`- [${o.title}](${o.url})${note}`);
      else lines.push(`- ${o.title}${note}${o.status ? '' : ' · modo prueba: no se abrió'}`);
    }
    lines.push('');
  }
  if (failed.length) {
    lines.push('### No se pudo', '');
    for (const f of failed) lines.push(`- **${f.pack.title}** · ${f.message.split('\n')[0]}`);
    lines.push('');
  }
  const section = (title, intro, groups) => {
    if (!groups.length) return;
    lines.push(`### ${title}`, '', intro, '');
    for (const { pack, findings } of groups) {
      lines.push(`**${pack.title}** · ${pack.provider}`, '');
      for (const f of findings) lines.push(`- ${LABEL[f.status]} · \`${f.file}${f.line ? `:${f.line}` : ''}\` · ${f.message}`);
      lines.push('');
    }
  };
  section('Sin PR', 'Parche no abre un PR cuando el arreglo depende de un dato de tu negocio o cuando no hay código para cambiar. Esto es lo que encontró y lo que falta.', reportOnly);
  section('Avisos', 'Cambios con fecha que afectan a tu código. Parche no los cambia solo: cambiar de modelo, por ejemplo, cambia cómo responde tu producto.', notices);
  if (!opened.length && !reportOnly.length && !notices.length && !failed.length) {
    lines.push('Ninguno de los packs verificados tiene cambios que te afecten hoy.', '');
  }
  lines.push('El inventario completo de las APIs del repo: `npx parche-cli scan .`');
  return `${lines.join('\n')}\n`;
}
