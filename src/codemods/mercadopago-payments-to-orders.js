// Pack mercadopago.payments-to-orders
// Migra la CREACIÓN de pagos del SDK Node (Payment.create) a Orders API (Order.create) y
// adapta el manejo de la respuesta. Consultas, capturas, cancelaciones y reembolsos de pagos
// existentes NO se migran: según la guía oficial, siguen en la API con la que se crearon.
import {
  jFor, detectQuote, eolOf, getProp, hasSpread, keyName, literalValue, isStringLit, resolveBinding,
  memberChain, buildMember, isReference, cloneNode, finding, tidy, snippet,
} from '../ast.js';

const PACK = 'mercadopago.payments-to-orders';
const DEBIT = new Set(['debvisa', 'debmaster', 'debcabal', 'maestro']);
const CREDIT = new Set(['visa', 'master', 'amex', 'naranja', 'cabal', 'tarshop', 'cencosud', 'diners', 'argencard', 'cmr']);
const TICKET = new Set(['rapipago', 'pagofacil']);
const PASS_THROUGH = new Set(['description', 'external_reference', 'payer', 'items']);
const PM_ORDER = ['id', 'type', 'token', 'installments', 'statement_descriptor'];
const PM_SOURCE = { payment_method_id: 'id', payment_type_id: 'type', token: 'token', installments: 'installments', statement_descriptor: 'statement_descriptor' };
const P0 = ['transactions', 'payments', 0, 'payment_method'];
const RESPONSE_RENAMES = {
  date_created: ['created_date'],
  date_last_updated: ['last_updated_date'],
  transaction_amount: ['total_amount'],
  payment_method_id: [...P0, 'id'],
  payment_type_id: [...P0, 'type'],
  'transaction_details.external_resource_url': [...P0, 'ticket_url'],
  'point_of_interaction.transaction_data.qr_code': [...P0, 'qr_code'],
  'point_of_interaction.transaction_data.qr_code_base64': [...P0, 'qr_code_base64'],
  'point_of_interaction.transaction_data.ticket_url': [...P0, 'ticket_url'],
};
const READ_METHODS = new Set(['get', 'search', 'cancel', 'capture', 'update']);

export default function transform({ source, file, pack }) {
  const findings = [];
  const usages = [];
  if (!/mercadopago/.test(source)) return { output: null, findings, usages };
  const j = jFor(file);
  let root;
  try {
    root = j(source);
  } catch {
    return { output: null, findings, usages };
  }
  const id = (n) => j.identifier(n);
  const prop = (k, v) => {
    const node = j.objectProperty(id(k), typeof v === 'string' ? j.stringLiteral(v) : v);
    if (v && v.type === 'Identifier' && v.name === k) node.shorthand = true;
    return node;
  };
  const review = (node, text) => {
    node.comments = [...(node.comments || []), j.commentBlock(` parche: REVISAR — ${text} `, true, false)];
    return node;
  };
  let changed = false;
  let needUUID = false;

  textDetections(source, file, findings, usages);

  const mp = findMpImport(j, root);
  if (!mp) return finish();
  if (mp.local('PaymentRefund')) {
    findings.push({ pack: PACK, file, line: mp.line, status: 'needs-review',
      message: 'Usás PaymentRefund. Los reembolsos de pagos creados con Payments API siguen por Payments API; los de órdenes nuevas van por POST /v1/orders/{id}/refund (parciales: con el id de la transacción).' });
  }
  const paymentLocal = mp.local('Payment');
  if (!paymentLocal) return finish();

  // Instancias: const payment = new Payment(client)
  const instances = new Map();
  root.find(j.NewExpression, { callee: { type: 'Identifier', name: paymentLocal } }).forEach((p) => {
    const parent = p.parent.node;
    if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
      instances.set(parent.id.name, { declPath: p.parent, clientExpr: p.node.arguments[0], orderName: null });
    }
  });

  const orderLocal = () => {
    if (!mp.local('Order')) mp.addSpecifier('Order');
    return mp.local('Order');
  };

  root.find(j.CallExpression).forEach((p) => {
    const callee = p.node.callee;
    if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return;
    const method = callee.property.name;
    let inst = null;
    let inlineNew = null;
    if (callee.object.type === 'Identifier' && instances.has(callee.object.name)) inst = callee.object.name;
    else if (callee.object.type === 'NewExpression' && callee.object.callee.name === paymentLocal) inlineNew = callee.object;
    else return;
    usages.push({ provider: 'mercadopago', op: `Payment.${method}`, line: p.node.loc?.start.line });

    if (READ_METHODS.has(method)) {
      findings.push(finding(PACK, file, p.node, 'needs-review',
        `\`${inst || 'payment'}.${method}()\` opera sobre pagos de Payments API: se deja como está (los pagos existentes se siguen consultando por la API con la que se crearon). Para órdenes nuevas usá \`Order.${method === 'search' ? 'search' : method}\`.`));
      return;
    }
    if (method !== 'create') return;
    if (migrateCreate(p)) {
      changed = true;
      if (inst) {
        const info = instances.get(inst);
        if (!info.orderName) {
          info.orderName = uniqueName(j, root, 'order');
          const decl = j.variableDeclaration('const', [
            j.variableDeclarator(id(info.orderName), j.newExpression(id(orderLocal()), info.clientExpr ? [cloneNode(info.clientExpr)] : [])),
          ]);
          j(info.declPath.parent).insertAfter(decl);
        }
        p.node.callee.object = id(info.orderName);
      } else {
        inlineNew.callee = id(orderLocal());
      }
    }
  });

  if (changed) {
    // Si la instancia de Payment quedó sin usos, se borra (y el import si corresponde).
    for (const [name, info] of instances) {
      if (!info.orderName) continue;
      const refs = root.find(j.Identifier, { name }).filter(isReference).size();
      if (refs === 0 && info.declPath.parent.node.declarations.length === 1) j(info.declPath.parent).remove();
    }
    const paymentRefs = root.find(j.Identifier, { name: paymentLocal }).filter(isReference).size();
    if (paymentRefs === 0) mp.removeSpecifier('Payment');
    if (needUUID) ensureRandomUUID(j, root, mp, detectQuote(source) === 'double' ? '"' : "'");
  }

  webhookDetections(j, root, file, findings);
  return finish();

  function finish() {
    if (!changed) return { output: null, findings: dedupe(findings), usages };
    const trailingComma = /,\s*\n\s*[}\]]/.test(source);
    const out = tidy(source, root.toSource({ quote: detectQuote(source), trailingComma, lineTerminator: eolOf(source) }));
    return { output: out, findings: dedupe(findings), usages };
  }

  function migrateCreate(p) {
    const call = p.node;
    const arg = call.arguments[0];
    if (!arg || arg.type !== 'ObjectExpression' || hasSpread(arg)) {
      findings.push(finding(PACK, file, call, 'needs-input', 'No pude leer los argumentos de `create()` (no es un objeto literal). Migrar a mano.'));
      return false;
    }
    const bodyProp = getProp(arg, 'body');
    if (!bodyProp) return false;
    let body = bodyProp.value;
    let setBody = (n) => { bodyProp.value = n; if (bodyProp.shorthand) bodyProp.shorthand = false; };
    if (body.type === 'Identifier') {
      const decl = resolveBinding(p, body.name);
      if (decl && decl.node.init && decl.node.init.type === 'ObjectExpression') {
        body = decl.node.init;
        setBody = (n) => { decl.node.init = n; };
      }
    }
    if (body.type !== 'ObjectExpression' || hasSpread(body)) {
      findings.push(finding(PACK, file, call, 'needs-input', 'El body del pago no es un objeto literal (o usa spread). Migrar a mano siguiendo el checklist.'));
      return false;
    }
    if (getProp(body, 'transactions') || getProp(body, 'total_amount')) return false; // ya tiene forma de orden
    if (getProp(body, 'application_fee')) {
      findings.push(finding(PACK, file, call, 'blocked',
        'Usa `application_fee` (Marketplace / Split 1:1). Orders API todavía no tiene un equivalente documentado: NO migrar este flujo hasta que Mercado Pago lo soporte.'));
      return false;
    }
    const amount = getProp(body, 'transaction_amount');
    if (!amount) {
      findings.push(finding(PACK, file, call, 'needs-input', 'El pago no tiene `transaction_amount` literal en el body. Migrar a mano.'));
      return false;
    }

    const pm = {};
    const passthrough = [];
    let captureMode = null;
    let config = null;
    let integration = null;
    for (const pr of body.properties) {
      const k = keyName(pr);
      const v = pr.value;
      if (k === 'transaction_amount') continue;
      if (k in PM_SOURCE) { pm[PM_SOURCE[k]] = v; continue; }
      if (k === 'notification_url') {
        findings.push(finding(PACK, file, pr, 'needs-review',
          'Se quitó `notification_url`: en Orders las notificaciones se configuran solo en Tus integraciones. Activá el tópico `orders` (y mantené `payment` en paralelo durante la transición).'));
        continue;
      }
      if (k === 'issuer_id') {
        findings.push(finding(PACK, file, pr, 'auto', 'Se quitó `issuer_id`: Orders no tiene ese campo, el emisor se resuelve por el medio de pago.'));
        continue;
      }
      if (k === 'capture') {
        const lit = literalValue(v);
        if (lit === false) captureMode = j.stringLiteral('manual');
        else if (lit === true) captureMode = j.stringLiteral('automatic');
        else captureMode = j.conditionalExpression(v, j.stringLiteral('automatic'), j.stringLiteral('manual'));
        if (lit !== true) {
          findings.push(finding(PACK, file, pr, 'needs-review',
            'Captura manual: en Orders se captura con POST /v1/orders/{id}/capture, solo captura total y dentro de los 5 días (si no, la orden se cancela sola).'));
        }
        continue;
      }
      if (k === 'three_d_secure_mode') {
        const lit = literalValue(v);
        if (lit === 'optional') {
          config = prop('config', j.objectExpression([prop('online', j.objectExpression([
            prop('transaction_security', j.objectExpression([prop('validation', 'on_fraud_risk'), prop('liability_shift', 'required')])),
          ]))]));
        } else if (lit !== 'not_supported') {
          passthrough.push(review(pr, '`three_d_secure_mode` pasa a `config.online.transaction_security`'));
        }
        continue;
      }
      if (k === 'sponsor_id') {
        integration = prop('integration_data', j.objectExpression([prop('sponsor', j.objectExpression([prop('id', v)]))]));
        continue;
      }
      if (k === 'payer' && v.type === 'ObjectExpression') {
        const t = getProp(v, 'type');
        const pid = getProp(v, 'id');
        if (t && literalValue(t.value) === 'customer' && pid) {
          v.properties = v.properties.filter((x) => x !== t);
          v.properties[v.properties.indexOf(pid)] = prop('customer_id', pid.value);
        }
      }
      if (k === 'items' && v.type === 'ArrayExpression') {
        for (const it of v.elements) {
          if (it && it.type === 'ObjectExpression') {
            const iid = getProp(it, 'id');
            if (iid) it.properties[it.properties.indexOf(iid)] = prop('external_code', iid.value);
          }
        }
      }
      if (PASS_THROUGH.has(k)) { passthrough.push(pr); continue; }
      passthrough.push(review(pr, `\`${k}\` no tiene equivalente directo en Orders API`));
      findings.push(finding(PACK, file, pr, 'needs-review', `\`${k}\` no tiene equivalente directo documentado en Orders API: quedó marcado en el código para revisar.`));
    }

    // Tipo de medio de pago (obligatorio en Orders).
    if (!pm.type) {
      const pmId = literalValue(pm.id);
      if (DEBIT.has(pmId)) pm.type = j.stringLiteral('debit_card');
      else if (CREDIT.has(pmId)) pm.type = j.stringLiteral('credit_card');
      else if (TICKET.has(pmId)) pm.type = j.stringLiteral('ticket');
      else {
        pm.type = j.stringLiteral('credit_card');
        pm.typeReview = true;
        findings.push(finding(PACK, file, call, 'needs-review',
          'Orders exige `payment_method.type` (credit_card | debit_card | ticket). Se puso `credit_card` por defecto: pasá el tipo real (el Card Payment Brick lo devuelve como payment_type_id).'));
      }
    }
    const pmProps = PM_ORDER.filter((k) => pm[k]).map((k) => {
      const node = prop(k, pm[k]);
      if (k === 'type' && pm.typeReview) review(node, 'confirmar credit_card o debit_card');
      return node;
    });

    const props = [prop('type', 'online'), prop('processing_mode', 'automatic')];
    if (captureMode) props.push(prop('capture_mode', captureMode));
    props.push(prop('total_amount', toAmount(j, amount.value)));
    props.push(...passthrough);
    if (config) props.push(config);
    if (integration) props.push(integration);
    props.push(prop('transactions', j.objectExpression([
      prop('payments', j.arrayExpression([j.objectExpression([
        prop('amount', toAmount(j, cloneNode(amount.value))),
        prop('payment_method', j.objectExpression(pmProps)),
      ])])),
    ])));
    setBody(j.objectExpression(props));

    if (!getProp(body, 'external_reference')) {
      findings.push(finding(PACK, file, call, 'needs-review', 'No hay `external_reference`: Orders lo exige para algunos medios de pago y sirve para conciliar.'));
    }

    // Idempotencia obligatoria en todas las escrituras de Orders.
    const ro = getProp(arg, 'requestOptions');
    const idem = prop('idempotencyKey', j.callExpression(id('randomUUID'), []));
    if (!ro) {
      arg.properties.push(prop('requestOptions', snippet(j, 'x = { idempotencyKey: randomUUID() };', 'ObjectExpression')));
      needUUID = true;
      findings.push(finding(PACK, file, call, 'auto', 'Se agregó `idempotencyKey` (X-Idempotency-Key es obligatorio en Orders).'));
    } else if (ro.value.type === 'ObjectExpression' && !getProp(ro.value, 'idempotencyKey')) {
      ro.value.properties.push(idem);
      needUUID = true;
    }

    rewriteResponse(p);
    findings.push(finding(PACK, file, call, 'auto', 'Creación migrada de `Payment.create` a `Order.create` con el body en formato Orders.'));
    return true;
  }

  function rewriteResponse(p) {
    let resultName = null;
    let scope = null;
    let cur = p.parent;
    if (cur.node.type === 'AwaitExpression') cur = cur.parent;
    if (cur.node.type === 'VariableDeclarator' && cur.node.id.type === 'Identifier') {
      resultName = cur.node.id.name;
      const fn = j(cur).closest(j.Function);
      scope = fn.size() ? fn : root;
    } else if (p.parent.node.type === 'MemberExpression' && p.parent.node.property.name === 'then') {
      const fn = p.parent.parent.node.arguments[0];
      if (fn && fn.params && fn.params[0] && fn.params[0].type === 'Identifier') {
        resultName = fn.params[0].name;
        scope = j(fn);
      }
    }
    if (!resultName) return;
    const sm = pack.status_map;
    const dm = pack.status_detail_map;
    const mapLit = (lit, map, field) => {
      const old = lit.value;
      const nu = map[old];
      if (!nu || nu === old) return;
      lit.value = nu;
      delete lit.extra;
      if (field === 'status' && (old === 'authorized' || old === 'in_mediation')) {
        findings.push(finding(PACK, file, lit, 'needs-review',
          `'${old}' pasa a '${nu}' pero se distingue por status_detail (${old === 'authorized' ? "'waiting_capture'" : "'in_process'"}). Revisá la condición.`));
      }
    };
    scope.find(j.BinaryExpression).forEach((bp) => {
      const { left, right, operator } = bp.node;
      if (!['===', '==', '!==', '!='].includes(operator)) return;
      for (const [mem, lit] of [[left, right], [right, left]]) {
        const ch = memberChain(mem);
        if (!ch || ch.root !== resultName || !isStringLit(lit)) continue;
        const field = ch.path.join('.');
        if (field === 'status') mapLit(lit, sm, field);
        if (field === 'status_detail') mapLit(lit, dm, field);
      }
    });
    scope.find(j.SwitchStatement).forEach((sp) => {
      const ch = memberChain(sp.node.discriminant);
      if (!ch || ch.root !== resultName) return;
      const field = ch.path.join('.');
      const map = field === 'status' ? sm : field === 'status_detail' ? dm : null;
      if (!map) return;
      for (const c of sp.node.cases) if (c.test && isStringLit(c.test)) mapLit(c.test, map, field);
    });
    let idFlagged = false;
    scope.find(j.MemberExpression).forEach((mp2) => {
      const ch = memberChain(mp2.node);
      if (!ch || ch.root !== resultName) return;
      const key = ch.path.join('.');
      if (RESPONSE_RENAMES[key]) {
        if (key === 'transaction_amount') {
          findings.push(finding(PACK, file, mp2.node, 'needs-review', '`transaction_amount` pasa a `total_amount` y ahora es un string ("50.00").'));
        }
        j(mp2).replaceWith(buildMember(j, resultName, RESPONSE_RENAMES[key]));
      } else if (key === 'id') {
        const parent = mp2.parent.node;
        const numeric = parent.type === 'CallExpression' && parent.callee.type === 'Identifier' && ['Number', 'parseInt', 'parseFloat'].includes(parent.callee.name);
        if (numeric) {
          findings.push(finding(PACK, file, mp2.node, 'needs-review',
            `\`${parent.callee.name}(${resultName}.id)\`: el id de una orden es alfanumérico (ej. "ORD01JS2V…"). Esto va a dar NaN: guardalo como string y revisá la columna en la base.`));
          idFlagged = true;
        } else if (!idFlagged) {
          findings.push(finding(PACK, file, mp2.node, 'needs-review', 'El id pasa de numérico a alfanumérico con prefijo ORD. Revisá dónde lo guardás.'));
          idFlagged = true;
        }
      }
    });
  }
}

function toAmount(j, expr) {
  const v = literalValue(expr);
  if (typeof v === 'number') return j.stringLiteral(v.toFixed(2));
  const toFixed = (e) => j.callExpression(j.memberExpression(e, j.identifier('toFixed')), [j.numericLiteral(2)]);
  if (expr.type === 'CallExpression' && expr.callee.type === 'Identifier' && expr.callee.name === 'Number') return toFixed(expr);
  return toFixed(j.callExpression(j.identifier('Number'), [expr]));
}

function uniqueName(j, root, base) {
  const taken = new Set(root.find(j.Identifier).nodes().map((n) => n.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}

function findMpImport(j, root) {
  const esm = root.find(j.ImportDeclaration, { source: { value: 'mercadopago' } });
  if (esm.size()) {
    const path = esm.paths()[0];
    const node = path.node;
    return {
      line: node.loc?.start.line,
      kind: 'esm',
      local: (name) => node.specifiers.find((s) => s.type === 'ImportSpecifier' && s.imported.name === name)?.imported.name && (node.specifiers.find((s) => s.type === 'ImportSpecifier' && s.imported.name === name).local || node.specifiers.find((s) => s.type === 'ImportSpecifier' && s.imported.name === name).imported).name || null,
      addSpecifier: (name) => node.specifiers.push(j.importSpecifier(j.identifier(name))),
      removeSpecifier: (name) => { node.specifiers = node.specifiers.filter((s) => !(s.type === 'ImportSpecifier' && s.imported.name === name)); },
      statement: path,
    };
  }
  const cjs = root.find(j.VariableDeclarator, {
    init: { type: 'CallExpression', callee: { name: 'require' }, arguments: [{ value: 'mercadopago' }] },
    id: { type: 'ObjectPattern' },
  });
  if (cjs.size()) {
    const path = cjs.paths()[0];
    const keyOf = (pr) => pr.key && (pr.key.name || pr.key.value);
    let names = path.node.id.properties.map((pr) => [keyOf(pr), pr.value.name]);
    const rebuild = () => {
      const txt = names.map(([k, v]) => (k === v ? k : `${k}: ${v}`)).join(', ');
      path.node.id = snippet(j, `const { ${txt} } = x;`, 'VariableDeclarator').id;
    };
    return {
      line: path.node.loc?.start.line,
      kind: 'cjs',
      local: (name) => names.find(([k]) => k === name)?.[1] || null,
      addSpecifier: (name) => { names.push([name, name]); rebuild(); },
      removeSpecifier: (name) => { names = names.filter(([k]) => k !== name); rebuild(); },
      statement: path.parent,
    };
  }
  return null;
}

function ensureRandomUUID(j, root, mp, quoteChar) {
  const already = root.find(j.Identifier, { name: 'randomUUID' }).filter((p) => {
    const parent = p.parent.node;
    return parent.type === 'ImportSpecifier' || parent.type === 'ObjectProperty' || parent.type === 'Property';
  }).size();
  if (already) return;
  const q = quoteChar;
  if (mp.kind === 'esm') {
    const decl = snippet(j, `import { randomUUID } from ${q}node:crypto${q};`, 'ImportDeclaration');
    const imports = root.find(j.ImportDeclaration);
    j(imports.paths()[imports.size() - 1]).insertAfter(decl);
  } else {
    const decl = snippet(j, `const { randomUUID } = require(${q}node:crypto${q});`, 'VariableDeclaration');
    j(mp.statement).insertAfter(decl);
  }
}

function textDetections(source, file, findings, usages) {
  const lines = source.split('\n');
  lines.forEach((l, i) => {
    if (/api\.mercadopago\.com\/v1\/payments/.test(l)) {
      findings.push({ pack: PACK, file, line: i + 1, status: 'needs-review',
        message: 'Llamada REST directa a /v1/payments. El equivalente para pagos nuevos es POST /v1/orders (ver mapeo de campos en la guía).' });
      usages.push({ provider: 'mercadopago', op: 'REST /v1/payments', line: i + 1 });
    }
    if (/mercadopago\.(configure|payment\.(create|save))\(/.test(l)) {
      findings.push({ pack: PACK, file, line: i + 1, status: 'needs-input',
        message: 'SDK v1 de Mercado Pago (deprecado desde la v2). Primero hay que pasar a la v2 del SDK; Parche no migra v1 automáticamente.' });
      usages.push({ provider: 'mercadopago', op: 'SDK v1', line: i + 1 });
    }
  });
}

function webhookDetections(j, root, file, findings) {
  root.find(j.BinaryExpression).forEach((bp) => {
    const { left, right, operator } = bp.node;
    if (!['===', '=='].includes(operator)) return;
    for (const [mem, lit] of [[left, right], [right, left]]) {
      const ch = memberChain(mem);
      if (!ch || !isStringLit(lit) || lit.value !== 'payment') continue;
      const last = ch.path[ch.path.length - 1];
      if (last === 'topic' || last === 'type') {
        findings.push(finding(PACK, file, bp.node, 'needs-review',
          'El webhook solo procesa el tópico `payment`. Las órdenes nuevas notifican por el tópico `orders` (se consulta con GET /v1/orders/{id}): sumá ese handler y mantené ambos durante la transición.'));
        return;
      }
    }
  });
}

function dedupe(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const k = `${f.file}:${f.line}:${f.status}:${f.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
