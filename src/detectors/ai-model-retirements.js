// Pack ai.model-retirements — solo detección.
// Cambiar de modelo cambia el comportamiento del producto, así que Parche avisa y no reescribe.
//
// Menos ruido (frente B, 16/10): un ID que aparece en el contexto de una llamada (model: '...', DEFAULT_MODEL)
// es un uso; si aparece en una lista o un catálogo, se avisa como mención. Y en código de Azure OpenAI no se
// da por cerrada la Assistants API: la fecha oficial es la de la API de OpenAI.
const PACK = 'ai.model-retirements';

const MODEL_CONTEXT = /\bmodel(?:Id|Name)?\b\s*[:=(]|["']model["']\s*[:=]|\b(?:DEFAULT|default)_?(?:MODEL|Model)\b|\bmodel\s*\(/i;
const AZURE = /azure|AzureOpenAI|openai\.azure\.com/i;
// Modelos fine-tuned de OpenAI: el ID real es `ft:<modelo base>:<org>:<sufijo>:<id>` (guía de fine-tuning).
// Se compara el modelo base entero, hasta el `:`, contra `bases` del pack: nunca un prefijo, porque
// `ft:gpt-4o-mini-2024-07-18:...` no es un fine-tuned de `gpt-4` y se apaga en otra fecha.
const FINE_TUNE = /["'`]ft:([\w.-]+):/g;

// Acepta el formato nuevo ({ date, replacement }) y el viejo (solo la fecha).
const entry = (v) => (typeof v === 'string' ? { date: v, replacement: null } : v);
const quoted = (line, id) => line.includes(`'${id}'`) || line.includes(`"${id}"`) || line.includes(`\`${id}\``);

export default function detect({ source, file, pack, today = new Date().toISOString().slice(0, 10) }) {
  const findings = [];
  const usages = [];
  const { retired_models: retired, retirement_floors: floors, retired_endpoints: endpoints } = pack.detect;
  const fineTunes = new Map();
  for (const [name, e] of Object.entries(pack.detect.retired_fine_tunes || {})) for (const b of e.bases) fineTunes.set(b, { name, ...e });
  const azure = AZURE.test(source);
  const lines = source.split('\n');
  lines.forEach((l, i) => {
    const line = i + 1;
    const inCall = MODEL_CONTEXT.test(l);
    for (const [model, raw] of Object.entries(retired)) {
      if (!quoted(l, model)) continue;
      const { date, replacement } = entry(raw);
      const past = date <= today;
      const repl = replacement ? ` Reemplazo recomendado: \`${replacement}\`.` : '';
      const when = past ? `fue retirado el ${date}` : `se retira el ${date}`;
      const message = inCall
        ? `El modelo \`${model}\` ${when}${past ? ': las llamadas ya fallan' : ''}.${repl} Corré tus pruebas de prompts antes de cambiarlo.`
        : `Aparece \`${model}\` (${when}) fuera de una llamada: si es una lista o un catálogo de modelos, actualizalo.${repl}`;
      findings.push({ pack: PACK, file, line, status: 'detect-only', message });
      usages.push({ provider: 'ia', op: `modelo ${model}`, line });
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
      findings.push({ pack: PACK, file, line, status: 'detect-only', message });
      usages.push({ provider: 'ia', op: `modelo fine-tuned ${base}`, line });
    }
    for (const [model, date] of Object.entries(floors)) {
      if (!l.includes(model)) continue;
      findings.push({ pack: PACK, file, line, status: 'detect-only',
        message: `El modelo \`${model}\` puede retirarse a partir del ${date} (fecha mínima publicada; hay 60 días de aviso). Planificá el reemplazo.` });
      usages.push({ provider: 'ia', op: `modelo ${model}`, line });
    }
    for (const ep of endpoints) {
      if (!l.includes(ep.pattern)) continue;
      findings.push({ pack: PACK, file, line, status: 'detect-only', message: azure && ep.provider === 'openai'
        ? `\`${ep.pattern}\` es la Assistants API. En Azure OpenAI sigue su propio calendario (el cierre del ${ep.retired} es el de la API de OpenAI): revisá el de Azure.`
        : `\`${ep.pattern}\` pertenece a la Assistants API de OpenAI, cerrada el ${ep.retired}. Reemplazo: ${ep.replacement_es}.` });
      usages.push({ provider: 'ia', op: 'OpenAI Assistants API', line });
    }
  });
  return { output: null, findings, usages };
}
