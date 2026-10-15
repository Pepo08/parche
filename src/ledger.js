// Registro append-only de eventos. En el producto real esto se sube (anonimizado) y es lo que
// hace que la base de packs mejore: qué fixes se mergean, cuáles se editan y cuáles se rechazan.
import fs from 'node:fs';
import path from 'node:path';

export function record(root, event) {
  const dir = path.join(root, '.parche');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'ledger.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
}

export function read(root) {
  const f = path.join(root, '.parche', 'ledger.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
