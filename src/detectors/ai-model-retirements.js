// Pack ai.model-retirements — solo detección.
// Cambiar de modelo cambia el comportamiento del producto, así que Parche avisa y no reescribe.
//
// Menos ruido (frente B, 16/10): un ID que aparece en el contexto de una llamada (model: '...', DEFAULT_MODEL)
// es un uso; si aparece en una lista o un catálogo, se avisa como mención. Y en código de Azure OpenAI no se
// da por cerrada la Assistants API: la fecha oficial es la de la API de OpenAI.
import samplingParams from './anthropic-sampling-params.js';

const PACK = 'ai.model-retirements';

const MODEL_CONTEXT = /\bmodel(?:Id|Name)?\b\s*[:=(]|["']model["']\s*[:=]|\b(?:DEFAULT|default)_?(?:MODEL|Model)\b|\bmodel\s*\(/i;
const AZURE = /azure|AzureOpenAI|openai\.azure\.com/i;
// Modelos fine-tuned de OpenAI: el ID real es `ft:<modelo base>:<org>:<sufijo>:<id>` (guía de fine-tuning).
// Se compara el modelo base entero, hasta el `:`, contra `bases` del pack: nunca un prefijo, porque
// `ft:gpt-4o-mini-2024-07-18:...` no es un fine-tuned de `gpt-4` y se apaga en otra fecha.
const FINE_TUNE = /["'`]ft:([\w.-]+):/g;
// Productos de OpenAI que cierran y no son modelos (prompts reutilizables, Evals, ChatKit con Agent Builder, Videos API).
// Un endpoint del pack es un `pattern` (texto literal) o un `regex` (se muestra el grupo 1). Con `openai_context`, solo
// cuenta si el archivo importa el SDK oficial (JS o Python) o nombra el host de la API: `.evals.create(`,
// `.videos.list(` o `/v1/evals` pueden ser de otra librería o de otra API. El regex de la Videos API además descarta
// los receptores de YouTube (`youtube.videos.list(`), que conviven con el SDK de OpenAI en los resumidores de videos.
const OPENAI_CONTEXT = /\b(?:from|import)\s+["']openai(?:\/[^"']*)?["']|\b(?:require|import)\(\s*["']openai(?:\/[^"']*)?["']\s*\)|^\s*(?:from\s+openai(?:\.\w+)*\s+import|import\s+openai)\b|api\.openai\.com/m;

// Acepta el formato nuevo ({ date, replacement }) y el viejo (solo la fecha). `replacement` es un ID de modelo
// y va entre backticks; `replacement_es` es un reemplazo que el proveedor da en prosa ("el modelo cyber más
// capaz al que tengas acceso"); `note_es` es una oración más, para lo que la página dice además de la fecha.
const entry = (v) => (typeof v === 'string' ? { date: v, replacement: null } : v);
const quoted = (line, id) => line.includes(`'${id}'`) || line.includes(`"${id}"`) || line.includes(`\`${id}\``);
const replacementText = ({ replacement, replacement_es: prose, note_es: note }) =>
  (replacement ? ` Reemplazo recomendado: \`${replacement}\`.` : prose ? ` Reemplazo recomendado: ${prose}.` : '') + (note ? ` ${note}` : '');
// `aliasOf`: el snapshot al que apunta un alias de Anthropic (`model_aliases` del pack). Sin alias, el texto es el de siempre.
const retiredMessage = (model, e, inCall, today, aliasOf) => {
  const past = e.date <= today;
  const repl = replacementText(e);
  const when = past ? `fue retirado el ${e.date}` : `se retira el ${e.date}`;
  return inCall
    ? `El modelo \`${model}\`${aliasOf ? ` (alias de \`${aliasOf}\`)` : ''} ${when}${past ? ': las llamadas ya fallan' : ''}.${repl} Corré tus pruebas de prompts antes de cambiarlo.`
    : `Aparece \`${model}\` (${aliasOf ? `alias de \`${aliasOf}\`, ` : ''}${when}) fuera de una llamada: si es una lista o un catálogo de modelos, actualizalo.${repl}`;
};
const floorMessage = (model, date, aliasOf) =>
  `El modelo \`${model}\`${aliasOf ? ` (alias de \`${aliasOf}\`)` : ''} puede retirarse a partir del ${date} (fecha mínima publicada; hay 60 días de aviso). Planificá el reemplazo.`;
const endpointHit = (ep, l) => {
  if (ep.pattern) return l.includes(ep.pattern) ? ep.pattern : null;
  const m = l.match(ep.re);
  return m ? m[1] ?? m[0] : null;
};
// Pasos anteriores al cierre (las evals pasan a solo lectura el 31/10 y cierran el 30/11). Cerrado el producto, no se
// nombran.
const milestonesText = (ep, today) => (ep.milestones || [])
  .map((m) => (m.date <= today ? ` Desde el ${m.date} ${m.past_es}.` : ` El ${m.date} ${m.future_es}.`)).join('');

// La fecha de cada aviso como dato, además de en el texto (P2 de la vigilancia, 0.8.0): `due` es la fecha, `dueKind`
// dice si es la de retiro (`retirement`) o una fecha mínima publicada (`minimum`), `subject` qué se retira y `provider`
// de quién. El resumen semanal arma con esto el calendario sin leer el mensaje. Los IDs del pack que no son de Claude
// son de OpenAI.
const PROVIDERS = { openai: 'OpenAI', anthropic: 'Anthropic' };
const providerOf = (model) => (/^claude/i.test(model) ? 'Anthropic' : 'OpenAI');
const dated = (subject, provider, due, dueKind = 'retirement') => ({ due, dueKind, subject, provider });

export default function detect({ source, file, pack, today = new Date().toISOString().slice(0, 10), context }) {
  const findings = [];
  const usages = [];
  const { retired_models: retired, retirement_floors: floors, retired_endpoints: endpoints, model_aliases: aliases = {} } = pack.detect;
  const fineTunes = new Map();
  for (const [name, e] of Object.entries(pack.detect.retired_fine_tunes || {})) for (const b of e.bases) fineTunes.set(b, { name, ...e });
  const azure = AZURE.test(source);
  const openai = OPENAI_CONTEXT.test(source);
  const eps = endpoints.filter((ep) => openai || !ep.openai_context).map((ep) => (ep.regex ? { ...ep, re: new RegExp(ep.regex) } : ep));
  const lines = source.split('\n');
  lines.forEach((l, i) => {
    const line = i + 1;
    const inCall = MODEL_CONTEXT.test(l);
    for (const [model, raw] of Object.entries(retired)) {
      if (!quoted(l, model)) continue;
      findings.push({ pack: PACK, file, line, status: 'detect-only', message: retiredMessage(model, entry(raw), inCall, today),
        ...dated(`modelo \`${model}\``, providerOf(model), entry(raw).date) });
      usages.push({ provider: 'ia', op: `modelo ${model}`, line });
    }
    // Alias de Anthropic de antes de la generación 4.6 (`claude-sonnet-4-5`): apuntan al snapshot fechado más reciente y
    // tienen su fecha (Model IDs and versioning). Se comparan enteros entre comillas: `'claude-sonnet-4-5'` no es
    // `'claude-sonnet-4-5-20250929'` (ese ya se avisa arriba), ni el ID de Bedrock (`anthropic.claude-…`) o el de Google
    // Cloud (`claude-sonnet-4-5@20250929`), que tienen su propio calendario.
    for (const [alias, target] of Object.entries(aliases)) {
      if (!quoted(l, alias)) continue;
      let message;
      let due;
      if (retired[target]) { message = retiredMessage(alias, entry(retired[target]), inCall, today, target); due = dated(`modelo \`${alias}\``, providerOf(alias), entry(retired[target]).date); }
      else if (floors[target]) { message = floorMessage(alias, floors[target], target); due = dated(`modelo \`${alias}\``, providerOf(alias), floors[target], 'minimum'); }
      else continue;
      findings.push({ pack: PACK, file, line, status: 'detect-only', message, ...due });
      usages.push({ provider: 'ia', op: `modelo ${alias}`, line });
    }
    for (const [, base] of l.matchAll(FINE_TUNE)) {
      const ft = fineTunes.get(base);
      if (!ft) continue;
      const past = ft.date <= today;
      const when = past ? `fue retirado el ${ft.date}` : `se retira el ${ft.date}`;
      const repl = `OpenAI recomienda como modelo base de reemplazo \`${ft.replacement}\`; el modelo fine-tuned no se migra solo.`;
      const message = inCall
        ? `El modelo fine-tuned sobre \`${base}\` (\`${ft.name}\`) ${when}${past ? ': las llamadas ya fallan' : ''}. ${repl} Corré tus pruebas de prompts antes de cambiarlo.`
        : `Aparece un modelo fine-tuned sobre \`${base}\` (\`${ft.name}\`, ${when}) fuera de una llamada: si es una lista o un catálogo de modelos, actualizalo. ${repl}`;
      findings.push({ pack: PACK, file, line, status: 'detect-only', message, ...dated(`modelo fine-tuned sobre \`${base}\``, 'OpenAI', ft.date) });
      usages.push({ provider: 'ia', op: `modelo fine-tuned ${base}`, line });
    }
    for (const [model, date] of Object.entries(floors)) {
      if (!l.includes(model)) continue;
      findings.push({ pack: PACK, file, line, status: 'detect-only', message: floorMessage(model, date), ...dated(`modelo \`${model}\``, providerOf(model), date, 'minimum') });
      usages.push({ provider: 'ia', op: `modelo ${model}`, line });
    }
    for (const ep of eps) {
      const hit = endpointHit(ep, l);
      if (!hit) continue;
      const past = ep.retired <= today;
      const closed = past ? `cerrada el ${ep.retired}` : `que cierra el ${ep.retired}`;
      const steps = past ? '' : milestonesText(ep, today);
      findings.push({ pack: PACK, file, line, status: 'detect-only', message: azure && ep.provider === 'openai'
        ? `\`${hit}\` es la ${ep.api_es}. En Azure OpenAI sigue su propio calendario (el cierre del ${ep.retired} es el de la API de OpenAI): revisá el de Azure.`
        : `\`${hit}\` pertenece a la ${ep.api_es} de OpenAI, ${closed}.${steps} Reemplazo: ${ep.replacement_es}.${ep.note_es ? ` ${ep.note_es}` : ''}`,
        // En Azure, la fecha de OpenAI no es la que rige: no va como dato.
        ...(azure && ep.provider === 'openai' ? {} : dated(ep.api_es, PROVIDERS[ep.provider] || 'OpenAI', ep.retired)) });
      usages.push({ provider: 'ia', op: `OpenAI ${ep.api_es}`, line });
    }
  });
  // `temperature`, `top_p` y `top_k` (Claude 4.7 y posteriores, API version 2026-10-21): el modelo y el parámetro pueden estar en líneas
  // distintas del pedido, así que va aparte (anthropic-sampling-params.js).
  const sampling = samplingParams({ source, file, pack, context });
  findings.push(...sampling.findings);
  usages.push(...sampling.usages);
  return { output: null, findings, usages };
}
