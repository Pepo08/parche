// Pack ai.model-retirements — `temperature`, `top_p` y `top_k` en Claude 4.7 y posteriores. Solo detección.
// Desde Claude 4.7 (y en Claude Mythos Preview), la API de Anthropic devuelve 400 si alguno de los tres llega con un
// valor distinto del de por defecto (página de deprecaciones, "API parameter deprecations"). Los valores aceptados
// salen de la referencia de la API (`temperature` 1, `top_p` desde 0.99, `top_k` ninguno) y de la guía de Claude
// Haiku 5.5, que es más estricta (`top_p` solo 0.99, y nunca `temperature` y `top_p` juntos).
//
// El modelo y el parámetro suelen estar en líneas distintas del mismo pedido, así que no alcanza con mirar una línea
// como en los modelos retirados: se tokeniza el archivo (strings y comentarios de JS/TS o de Python), se arma el árbol
// de paréntesis y llaves, y se mira cada objeto que es un pedido a la API de Messages:
//   1. lo que recibe `.messages.create(` o `.messages.stream(` (también `beta.` y `with_raw_response.`): el objeto en
//      JS, los argumentos con nombre en Python;
//   2. el objeto asignado a la variable que recibe esa llamada (`create(params)`, `create(**params)`);
//   3. un objeto tipado como `MessageCreateParams…`;
//   4. si el archivo nombra `api.anthropic.com` y `v1/messages` (HTTP directo): cualquier objeto con `messages` o
//      `max_tokens`, salvo los que van a una llamada de OpenAI (`chat.completions.create(`, `responses.create(`).
// Se avisa solo si el modelo del pedido se puede leer y es uno de los afectados, y si el parámetro es un número fuera
// de lo aceptado. El modelo se lee si es un literal, una constante asignada una sola vez en el archivo o el valor por
// defecto de una variable (`process.env.X || '…'`, `os.getenv("X", "…")`). Si no se puede saber, no se avisa (D64).
const PACK = 'ai.model-retirements';
const JS = /\.[cm]?[jt]sx?$/i;
const PY = /\.py$/i;
const PARAMS = ['temperature', 'top_p', 'top_k'];
const MESSAGES_CALL = /\.\s*messages\s*\.\s*(?:with_(?:raw|streaming)_response\s*\.\s*)?(?:create|stream)\s*$/;
const OPENAI_CALL = /\.\s*(?:chat\s*\.\s*)?completions\s*\.\s*create\s*$|\.\s*responses\s*\.\s*(?:create|stream|parse)\s*$/;
const TYPED_PARAMS = /MessageCreateParams\w*(?:<[^>]*>)?\s*=\s*$/;
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const NAMES = /[A-Za-z_$][\w$]*/g;
// Antes de una `/` que abre una regex de JS (y no es una división) hay un operador, un separador o una palabra clave.
const REGEX_BEFORE = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|in|of|yield|await|void|delete|throw|else|do))\s*$/;
const CONTROL = /\b(?:if|for|while|switch|catch|with)\s*$/;

// Copia del código con los comentarios y el interior de los strings en blanco (mismas posiciones y saltos de línea),
// para buscar llaves, comas y claves sin tropezar con texto. Los strings quedan aparte, con su valor.
function tokenize(source, python) {
  const code = source.split('');
  const strings = [];
  const blank = (a, b) => { for (let k = a; k < b; k++) if (code[k] !== '\n' && code[k] !== '\r') code[k] = ' '; };
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i];
    if (python ? c === '#' : source.startsWith('//', i)) {
      const e = source.indexOf('\n', i);
      const end = e < 0 ? n : e;
      blank(i, end); i = end; continue;
    }
    if (!python && source.startsWith('/*', i)) {
      const e = source.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      blank(i, end); i = end; continue;
    }
    if (c === '"' || c === "'" || (c === '`' && !python)) {
      const q = python && source.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      let j = i + q.length;
      while (j < n && !source.startsWith(q, j)) {
        if (source[j] === '\\') j++;
        else if (source[j] === '\n' && q.length === 1 && c !== '`') break; // string sin cerrar: termina en la línea
        j++;
      }
      const end = Math.min(n, j + q.length);
      strings.push({ start: i, end, value: source.slice(i + q.length, j) });
      blank(i + q.length, j);
      i = end; continue;
    }
    if (!python && c === '/' && REGEX_BEFORE.test(code.slice(Math.max(0, i - 12), i).join(''))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== '\n' && (inClass || source[j] !== '/')) {
        if (source[j] === '\\') j++;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        j++;
      }
      blank(i + 1, j);
      i = j + 1; continue;
    }
    i++;
  }
  return { code: code.join(''), strings };
}

// Árbol de paréntesis, corchetes y llaves, y la profundidad de cada posición. Un cierre que no corresponde al último
// abierto cierra hasta su par (código a medio escribir o una regex que no se reconoció); si no tiene par, se ignora.
function brackets(code) {
  const PAIR = { ')': '(', ']': '[', '}': '{' };
  const nodes = [];
  const stack = [];
  const depth = new Uint16Array(code.length + 1);
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    depth[i] = stack.length;
    if (c === '(' || c === '[' || c === '{') {
      const node = { open: c, start: i, end: -1, parent: stack.at(-1) || null };
      stack.push(node);
      nodes.push(node);
    } else if (PAIR[c]) {
      const k = stack.map((x) => x.open).lastIndexOf(PAIR[c]);
      if (k < 0) continue;
      for (const x of stack.splice(k)) x.end = i;
    }
  }
  return { nodes: nodes.filter((x) => x.end >= 0), depth };
}

// Primer separador de primer nivel en code[a, b): `:` en objetos y diccionarios, `=` en argumentos con nombre de Python
// (no `==`, `<=`, `>=`, `!=`).
function separator(code, a, b, sep) {
  let level = 0;
  for (let i = a; i < b; i++) {
    const c = code[i];
    if ('([{'.includes(c)) level++;
    else if (')]}'.includes(c)) level--;
    else if (level === 0 && c === sep) {
      if (sep === '=' && (code[i + 1] === '=' || '=!<>'.includes(code[i - 1]))) continue;
      return i;
    }
  }
  return -1;
}

export default function detectSamplingParams({ source, file, pack }) {
  const rules = pack.detect.sampling_params;
  const python = PY.test(file);
  if (!rules || (!python && !JS.test(file))) return { findings: [], usages: [] };
  // La mayoría de los archivos no tiene ni el parámetro ni un modelo afectado: no hace falta tokenizarlos.
  if (!PARAMS.some((p) => source.includes(p)) || !rules.models.some((m) => source.includes(m))) return { findings: [], usages: [] };

  const { code, strings } = tokenize(source, python);
  const { nodes, depth } = brackets(code);
  const stringAt = new Map(strings.map((s) => [s.start, s]));
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (pos) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  // Texto de code[a, b) sin los espacios (ni los comentarios) de los bordes, tomado del original. Sin `as const` ni
  // `satisfies T` de TypeScript al final.
  const trimmed = (a, b) => {
    while (a < b && /\s/.test(code[a])) a++;
    while (b > a && /\s/.test(code[b - 1])) b--;
    const cast = python ? null : code.slice(a, b).match(/\s+(?:as|satisfies)\s+[\w$.<>\[\]]+$/);
    if (cast) b -= cast[0].length;
    return { at: a, end: b, text: source.slice(a, b) };
  };
  const literal = (v) => { const s = stringAt.get(v.at); return s && s.end === v.end ? s.value : null; };
  const before = (node) => code.slice(Math.max(0, node.start - 160), node.start);
  const nodeAt = (pos) => nodes.find((x) => x.start === pos) || null;

  // Asignaciones del archivo. Una variable cuenta como constante si se asigna una sola vez, en una declaración
  // (`const X = …` en JS; `X = …` fuera de paréntesis en Python) y con el valor en la misma línea. Todo lo demás que
  // le da un valor a un nombre (parámetros de funciones, desestructuración, imports, `for`, `+=`) cuenta como otra
  // asignación: así un parámetro que se llama igual que una constante no hace leer un valor que no es.
  let assigned = null;
  const assignments = () => {
    if (assigned) return assigned;
    assigned = new Map();
    const add = (name, at, valueAt) => {
      const list = assigned.get(name) || [];
      if (!list.some((x) => x.at === at)) list.push({ at, valueAt });
      assigned.set(name, list);
    };
    const bind = (a, b) => { for (const m of code.slice(a, b).matchAll(NAMES)) add(m[0], a + m.index, null); };
    if (python) {
      for (const m of code.matchAll(/^[ \t]*([A-Za-z_]\w*)[ \t]*(?::[^=\n]*)?=(?!=)/gm)) {
        const at = m.index + m[0].indexOf(m[1]);
        if (depth[at] === 0) add(m[1], at, m.index + m[0].length);
      }
      for (const m of code.matchAll(/^[ \t]*([A-Za-z_]\w*)[ \t]*(?:[-+*/%@&|^]|\/\/|\*\*|>>|<<)=/gm)) add(m[1], m.index + m[0].indexOf(m[1]), null);
      for (const m of code.matchAll(/^[ \t]*([\w \t*]+,[\w \t*,]*)=(?!=)/gm)) bind(m.index, m.index + m[1].length + m[0].indexOf(m[1]));
      for (const m of code.matchAll(/\b(?:for|as|global|nonlocal)\s+([A-Za-z_]\w*)\b|\b([A-Za-z_]\w*)\s*:=/g)) add(m[1] || m[2], m.index + m[0].indexOf(m[1] || m[2]), null);
      for (const m of code.matchAll(/^[ \t]*(?:from\s+\S+\s+)?import\s+([^\n]+)/gm)) bind(m.index + m[0].length - m[1].length, m.index + m[0].length);
      for (const x of nodes) if (x.open === '(' && /\bdef\s+\w+\s*$/.test(before(x))) bind(x.start + 1, x.end);
    } else {
      for (const m of code.matchAll(/(?<![\w$.])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]*)?=(?![=>])/g)) {
        add(m[1], m.index + m[0].indexOf(m[1], m[0].search(/\s/)), m.index + m[0].length);
      }
      for (const m of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:[-+*/%&|^]|\*\*|\?\?|\|\||&&|>>>?|<<)?=(?![=>])/g)) add(m[1], m.index, null);
      for (const m of code.matchAll(/(?<![\w$.])(?:const|let|var)\s*([{[])/g)) {
        const x = nodeAt(m.index + m[0].length - 1);
        if (x) bind(x.start, x.end);
      }
      for (const m of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1], m.index, null);
      for (const m of code.matchAll(/^[ \t]*import\s+([^;\n]*?)\s+from\b/gm)) bind(m.index, m.index + m[0].length);
      for (const x of nodes) {
        if (x.open === '(' && !CONTROL.test(before(x)) && /^\s*(?::[^={;]*)?(?:=>|\{)/.test(code.slice(x.end + 1, x.end + 120))) bind(x.start + 1, x.end);
      }
    }
    const lineEnd = (i) => { const e = code.indexOf('\n', i); return e < 0 ? code.length : e; };
    for (const list of assigned.values()) {
      for (const x of list) {
        if (x.valueAt === null) continue;
        let { at, end } = trimmed(x.valueAt, lineEnd(x.valueAt));
        while (end > at && (code[end - 1] === ';' || code[end - 1] === ',' || /\s/.test(code[end - 1]))) end--;
        x.value = trimmed(at, end);
      }
    }
    return assigned;
  };
  const constant = (name) => {
    const list = assignments().get(name) || [];
    return list.length === 1 && list[0].value ? list[0].value : null;
  };

  // El modelo de un valor: literal, constante o el valor por defecto de una variable. `from` dice de dónde sale.
  const modelOf = (v, nested = false) => {
    const lit = literal(v);
    if (lit !== null) return { id: lit, from: null };
    const t = v.text;
    if (IDENT.test(t)) { const c = !nested && constant(t); return c ? modelOf(c, true) : null; }
    const js = !python && t.match(/^(process\.env(?:\.\w+|\[\s*(['"])\w+\2\s*\])|[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\s*(?:\|\||\?\?)\s*(['"`])([^'"`\\$]*)\3$/);
    if (js) return { id: js[4], from: `\`${js[1]}\`` };
    const env = python && t.match(/^(?:os\.)?(?:getenv|environ\.get)\(\s*(['"])(\w+)\1\s*,\s*(['"])([^'"\\]*)\3\s*\)$/);
    if (env) return { id: env[4], from: `la variable de entorno \`${env[2]}\`` };
    const or = python && t.match(/^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+or\s+(['"])([^'"\\]*)\2$/);
    if (or) return { id: or[3], from: `\`${or[1]}\`` };
    return null;
  };
  // El número de un valor: literal o constante. `via` es el nombre de la constante.
  const numberOf = (v) => {
    if (NUMBER.test(v.text)) return { value: Number(v.text), via: null };
    const c = IDENT.test(v.text) && constant(v.text);
    return c && NUMBER.test(c.text) ? { value: Number(c.text), via: v.text } : null;
  };

  // Entradas de primer nivel de un nodo: { key, sep, keyAt, value }. En JS, `clave: valor`, `'clave': valor` y la forma
  // corta `{ temperature }` (sep null); en Python, `"clave": valor` en diccionarios y `clave=valor` en argumentos.
  const entriesOf = (node) => {
    const sep = node.open === '{' ? ':' : '=';
    const out = [];
    const push = (a, b) => {
      const s = separator(code, a, b, sep);
      if (s < 0) {
        const v = trimmed(a, b);
        if (!python && sep === ':' && IDENT.test(v.text)) out.push({ key: v.text, sep: null, keyAt: v.at, value: v });
        return;
      }
      const k = trimmed(a, s);
      const key = IDENT.test(k.text) ? k.text : literal(k);
      if (key !== null) out.push({ key, sep, keyAt: k.at, value: trimmed(s + 1, b) });
    };
    let level = 0;
    let a = node.start + 1;
    for (let i = node.start + 1; i < node.end; i++) {
      const c = code[i];
      if ('([{'.includes(c)) level++;
      else if (')]}'.includes(c)) level--;
      else if (c === ',' && level === 0) { push(a, i); a = i + 1; }
    }
    push(a, node.end);
    return out;
  };

  // Los pedidos: nodo → 'sdk' o 'http'.
  const requests = new Map();
  const paramVars = new Set();
  for (const call of nodes.filter((x) => x.open === '(' && MESSAGES_CALL.test(before(x)))) {
    const comma = separator(code, call.start + 1, call.end, ',');
    const first = trimmed(call.start + 1, comma < 0 ? call.end : comma);
    if (python) requests.set(call, 'sdk');
    else if (code[first.at] === '{') requests.set(nodeAt(first.at), 'sdk');
    const name = first.text.replace(/^\*\*/, '');
    if (IDENT.test(name)) paramVars.add(name);
  }
  const http = /api\.anthropic\.com/.test(source) && /v1\/messages/.test(source);
  for (const node of nodes) {
    if (node.open !== '{' || requests.has(node)) continue;
    const head = before(node);
    const target = head.match(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?::[^=;\n]*)?=\s*$/);
    if ((target && paramVars.has(target[1])) || TYPED_PARAMS.test(head)) { requests.set(node, 'sdk'); continue; }
    if (!http) continue;
    let openai = false;
    for (let p = node.parent; p && !openai; p = p.parent) openai = p.open === '(' && OPENAI_CALL.test(before(p));
    if (!openai) requests.set(node, 'http');
  }

  const findings = [];
  const usages = [];
  const report = (at, message, op) => {
    findings.push({ pack: PACK, file, line: lineOf(at), status: 'detect-only', message });
    usages.push({ provider: 'ia', op, line: lineOf(at) });
  };
  for (const [node, via] of requests) {
    if (!node) continue;
    const byKey = new Map(entriesOf(node).map((e) => [e.key, e]));
    if (via === 'http' && !byKey.has('messages') && !byKey.has('max_tokens')) continue;
    const model = byKey.has('model') ? modelOf(byKey.get('model').value) : null;
    if (!model || !rules.models.includes(model.id)) continue;
    const override = rules.overrides?.[model.id] || {};
    const scope = override.scope_es || rules.scope_es;
    const accepted = { ...rules.accepted, ...override.accepted };
    const modelText = `\`${model.id}\`${model.from ? ` (el valor por defecto de ${model.from})` : ''}`;
    const tail = (params, zero) => `Recomendación oficial de Anthropic: ${rules.recommendation_es.replace('{params}', params.map((p) => `\`${p}\``).join(' y '))}.`
      + (zero ? ` ${rules.temperature_zero_es}` : '') + (python && via === 'sdk' ? ` ${rules.python_sdk_es}` : '');
    const present = [];
    let flagged = 0;
    for (const param of PARAMS) {
      const e = byKey.get(param);
      const num = e && numberOf(e.value);
      if (!num) continue;
      present.push({ param, e });
      const ok = accepted[param];
      if (ok.min !== undefined && num.value >= ok.min && num.value <= ok.max) continue;
      flagged++;
      const shown = (e.sep === '=' ? `${param}=${e.value.text}` : e.sep ? `${param}: ${e.value.text}` : param) + (num.via ? ` (${num.value})` : '');
      report(e.keyAt, `\`${shown}\` con el modelo ${modelText} da un error 400: ${scope}, \`${param}\` ${ok.es}. ${tail([param], param === 'temperature' && num.value === 0)}`,
        `Anthropic ${param} (Claude 4.7+)`);
    }
    const together = override.exclusive || [];
    if (together.length && !flagged && together.every((p) => present.some((x) => x.param === p))) {
      const last = present.filter((x) => together.includes(x.param)).at(-1);
      report(last.e.keyAt, `${together.map((p) => `\`${p}\``).join(' y ')} juntos con el modelo ${modelText} dan un error 400: ${override.exclusive_es}. ${tail(together, false)}`,
        `Anthropic ${together.join(' + ')} (Claude 4.7+)`);
    }
  }
  // Los pedidos salen en el orden del árbol (de afuera hacia adentro); el reporte va en el orden del archivo.
  const byLine = (a, b) => a.line - b.line;
  return { findings: findings.sort(byLine), usages: usages.sort(byLine) };
}
