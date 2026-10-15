// Apertura del PR por la API REST de GitHub (sin dependencias).
export function parseGithubRemote(url) {
  if (!url) return null;
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export async function openPullRequest({ token, owner, repo, head, base, title, body, draft }) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, head, base, body, draft }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data.html_url;
}
