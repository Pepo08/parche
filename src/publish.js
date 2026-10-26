// Publica el PR de un pack: lo abre o, si ya hay uno abierto para su rama, lo actualiza sin pisar el trabajo de otros
// (P9, 0.7.6). Hasta la 0.7.5, `parche pr` pusheaba la rama con --force y pedía otro PR: si alguien le había sumado un
// commit al PR, se perdía; y GitHub rechazaba el PR repetido, así que con un PR abierto cada corrida semanal fallaba y
// los packs que venían después no corrían (lo encontró el chat de página el 25/10, F2).
import * as git from './git.js';

// El commit que escribe Parche: título "Parche: …" y la línea "Pack <id> v<versión>." (bin/parche.js, `commitAll`).
export const isParcheCommit = (message, pack) => /^Parche: /.test(message) && message.includes(`\nPack ${pack.id} v`);

// status: 'opened' (PR nuevo), 'updated' (el PR abierto tenía solo el commit de Parche y el arreglo cambió),
// 'unchanged' (mismo arreglo: no se pushea ni se toca) o 'kept' (la rama remota tiene commits de otra persona, con PR
// abierto o sin él: no se toca). La regla: Parche nunca hace force push sobre un commit que no escribió.
export async function publishPr({ root, client, target, pushTo, pushRemote, branch, base, pack, title, body, draft }) {
  const head = pushTo.owner !== target.owner ? `${pushTo.owner}:${branch}` : branch;
  const existing = await client.findOpenPull({ ...target, head: `${pushTo.owner}:${branch}` });
  const found = existing ? { url: existing.html_url, number: existing.number } : { url: null, number: null };
  const remote = git.fetchBranch(root, pushRemote, branch);
  if (remote) {
    // Un commit que no es de Parche (de una persona, o el "Update branch" de GitHub) hace que la rama sea de alguien más.
    const others = git.commitsBetween(root, base, remote).filter((c) => !isParcheCommit(c.message, pack));
    if (others.length) return { status: 'kept', ...found, others: others.length };
    if (existing && git.patchId(root, base, remote) === git.patchId(root, base, branch)) return { status: 'unchanged', ...found };
  }
  git.push(root, branch, pushRemote);
  if (!existing) {
    const pr = await client.openPull({ ...target, head, base, title, body, draft });
    return { status: 'opened', url: pr.html_url, number: pr.number };
  }
  await client.updatePull({ ...target, number: existing.number, title, body });
  return { status: 'updated', ...found };
}
