// Carga de packs (la base de cambios) y el registro de transformaciones.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import arca from './codemods/arca-wsfe-condicion-iva.js';
import arcaPhp from './codemods/arca-wsfe-condicion-iva-php.js';
import mercadopago from './codemods/mercadopago-payments-to-orders.js';
import aiModels from './detectors/ai-model-retirements.js';
import { wsdlDetection, soapOnly } from './codemods/arca-rules.js';
import { isPhp } from './php.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PACKS_DIR = path.join(HERE, '..', 'packs');

// Una transformación por pack y por lenguaje. Si un pack no tiene versión para un lenguaje,
// ese pack no corre sobre esos archivos.
const TRANSFORMS = {
  // js y php: codemod; wsdl: WSDL de WSFEv1 sin el campo; text (Python, C#, Java, Go, VB.NET): solo SOAP propio.
  'arca.wsfe.condicion-iva-receptor': { js: arca, php: arcaPhp, wsdl: wsdlDetection, text: soapOnly },
  'mercadopago.payments-to-orders': { js: mercadopago },
  'ai.model-retirements': { js: aiModels, php: aiModels, text: aiModels }, // detector de texto: sirve para cualquier lenguaje
};

const TEXT_ONLY = /\.(py|cs|java|go|vb)$/i;

export function languageOf(file) {
  if (isPhp(file)) return 'php';
  if (/\.wsdl$/i.test(file)) return 'wsdl';
  if (TEXT_ONLY.test(file)) return 'text';
  return 'js';
}

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

export function transformFor(packId, file = 'x.js') {
  const byLang = TRANSFORMS[packId];
  return (byLang && byLang[languageOf(file)]) || null;
}
