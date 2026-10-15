// Pack ai.model-retirements — solo detección.
// Cambiar de modelo cambia el comportamiento del producto, así que Parche avisa y no reescribe.
const PACK = 'ai.model-retirements';

export default function detect({ source, file, pack, today = new Date().toISOString().slice(0, 10) }) {
  const findings = [];
  const usages = [];
  const { retired_models: retired, retirement_floors: floors, retired_endpoints: endpoints } = pack.detect;
  const lines = source.split('\n');
  lines.forEach((l, i) => {
    for (const [model, date] of Object.entries(retired)) {
      if (l.includes(`'${model}'`) || l.includes(`"${model}"`) || l.includes('`' + model + '`')) {
        const past = date <= today;
        findings.push({ pack: PACK, file, line: i + 1, status: 'detect-only',
          message: past
            ? `El modelo \`${model}\` fue retirado el ${date}: las llamadas ya fallan. Elegí un reemplazo en la página de deprecaciones y corré tus pruebas de prompts.`
            : `El modelo \`${model}\` se retira el ${date}.` });
        usages.push({ provider: 'ia', op: `modelo ${model}`, line: i + 1 });
      }
    }
    for (const [model, date] of Object.entries(floors)) {
      if (l.includes(model)) {
        findings.push({ pack: PACK, file, line: i + 1, status: 'detect-only',
          message: `El modelo \`${model}\` puede retirarse a partir del ${date} (fecha mínima publicada; hay 60 días de aviso). Planificá el reemplazo.` });
        usages.push({ provider: 'ia', op: `modelo ${model}`, line: i + 1 });
      }
    }
    for (const ep of endpoints) {
      if (l.includes(ep.pattern)) {
        findings.push({ pack: PACK, file, line: i + 1, status: 'detect-only',
          message: `\`${ep.pattern}\` pertenece a la Assistants API de OpenAI, cerrada el ${ep.retired}. Reemplazo: ${ep.replacement_es}.` });
        usages.push({ provider: 'ia', op: 'OpenAI Assistants API', line: i + 1 });
      }
    }
  });
  return { output: null, findings, usages };
}
