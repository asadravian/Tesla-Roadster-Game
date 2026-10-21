// Global leaderboard client. Set API to the deployed Worker URL (see worker/README.md);
// while it is empty the game hides every leaderboard control.
export const API = 'https://roadster-rush-leaderboard.asadlondon3.workers.dev';

export const enabled = () => !!API;

export async function fetchTop() {
  const r = await fetch(`${API}/scores`);
  const data = r.ok ? await r.json().catch(() => null) : null;
  if (!data || !Array.isArray(data.top)) throw new Error('Leaderboard unavailable');
  return data.top;
}

export async function submitScore(run) {
  const r = await fetch(`${API}/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(run),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Could not submit score');
  if (!Array.isArray(data.top)) throw new Error('Leaderboard is offline right now.');
  return data;
}

// Render rows with textContent only: nicknames are user input.
export function renderList(ol, rows, highlight) {
  ol.innerHTML = '';
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No scores yet. Be the first.';
    ol.appendChild(li);
    return;
  }
  rows.forEach((row, i) => {
    const li = document.createElement('li');
    if (highlight && row.name.toLowerCase() === highlight.toLowerCase()) li.className = 'me';
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = String(i + 1);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = row.name;
    const score = document.createElement('span');
    score.className = 'pts';
    score.textContent = Number(row.score).toLocaleString();
    li.append(rank, name, score);
    ol.appendChild(li);
  });
}
