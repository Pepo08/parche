// Carga de packs (la base de cambios) y el registro de transformaciones.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import arca from './codemods/arca-wsfe-condicion-iva.js';
import mercadopago from './codemods/mercadopago-payments-to-orders.js';
import aiModels from './detectors/ai-model-retirements.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PACKS_DIR = path.join(HERE, '..', 'packs');

const TRANSFORMS = {
  'arca.wsfe.condicion-iva-receptor': arca,
  'mercadopago.payments-to-orders': mercadopago,
  'ai.model-retirements': aiModels,
};

export const REQUIRED_FIELDS = ['id', 'version', 'provider', 'title', 'kind', 'severity', 'deadline', 'last_verified',
  'summary_es', 'why_es', 'sources', 'detect', 'codemod', 'review_checklist_es'];

export function validatePack(pack) {
  const missing = REQUIRED_FIELDS.filter((f) => !(f in pack));
  if (missing.length) throw new Error(`Pack ${pack.id || '?'}: faltan campos ${missing.join(', ')}`);
  if (!Array.isArray(pack.sources) || pack.sources.some((s) => !s.url)) throw new Error(`Pack ${pack.id}: sources inválidas`);
  if (!['critical', 'high', 'medium', 'low'].includes(pack.severity)) throw new Error(`Pack ${pack.id}: severity inválida`);
  return true;
}

export function loadPacks(dir = PACKS_DIR) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .map((p) => (validatePack(p), p))
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
}

export function transformFor(packId) {
  return TRANSFORMS[packId] || null;
}
