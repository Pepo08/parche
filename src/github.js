// La API REST de GitHub para los PRs de Parche (sin dependencias).
export function parseGithubRemote(url) {
  if (!url) return null;
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// GitHub responde 403 con este mensaje cuando el repo (o su organización) tiene apagado "Allow GitHub Actions to create
// and approve pull requests". Viene apagado en los repos personales y las organizaciones nuevas (docs de GitHub,
// verificado el 25/10/2026): la primera corrida fallaba con el error en inglés y sin decir dónde se arregla (P8, 0.7.6).
const ACTIONS_CANNOT_OPEN_PRS = /not permitted to create or approve pull requests/i;

export const ACTIONS_CANNOT_OPEN_PRS_MESSAGE = 'GitHub no deja que GitHub Actions abra PRs en este repo. Prendelo en '
  + 'Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests" '
  + '(si el repo es de una organización, el ajuste está en la configuración de la organización). O pasale a la Action '
  + 'un token de una GitHub App o uno personal, con el input `token`. La rama del arreglo ya quedó pusheada: con el '
  + 'ajuste prendido, la próxima corrida abre el PR.';

export function apiError(status, data) {
  const message = data?.message || JSON.stringify(data);
  if (status === 403 && ACTIONS_CANNOT_OPEN_PRS.test(message)) return new Error(ACTIONS_CANNOT_OPEN_PRS_MESSAGE);
  return new Error(`GitHub respondió ${status}: ${message}`);
}

// Un cliente con el token de quien corre Parche. `request` es `fetch` (los tests le pasan uno propio, sin red).
export function githubClient(token, request = fetch) {
  const call = async (method, route, body) => {
    const res = await request(`https://api.github.com${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw apiError(res.status, data);
    return data;
  };
  return {
    // El PR abierto cuya rama es `head` ("dueño:rama"), o null.
    async findOpenPull({ owner, repo, head }) {
      const list = await call('GET', `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(head)}&per_page=1`);
      return Array.isArray(list) && list.length ? list[0] : null;
    },
    openPull: ({ owner, repo, head, base, title, body, draft }) => call('POST', `/repos/${owner}/${repo}/pulls`, { title, head, base, body, draft }),
    updatePull: ({ owner, repo, number, title, body }) => call('PATCH', `/repos/${owner}/${repo}/pulls/${number}`, { title, body }),
  };
}
