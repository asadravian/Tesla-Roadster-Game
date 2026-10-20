// Roadster Rush global leaderboard: a tiny Cloudflare Worker backed by D1.
// GET  /scores        -> top 10 (best run per nickname)
// POST /scores        -> { name, score, distance, topSpeed, duration } -> { rank, top }

const ORIGINS = ['https://asadravian.github.io', 'http://localhost:8000', 'http://localhost:8811'];
const NAME_RE = /^[A-Za-z0-9 _.\-]{2,16}$/;
const BLOCKED = ['fuck', 'shit', 'cunt', 'bitch', 'nigg', 'fag', 'rape', 'nazi', 'hitler', 'porn', 'dick', 'pussy', 'whore', 'slut'];

function cors(req) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(req, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(req), ...extra },
  });
}

async function top(db, limit = 10) {
  const { results } = await db
    .prepare(
      `SELECT name, MAX(score) AS score, MAX(top_speed) AS topSpeed
       FROM scores GROUP BY lower(name) ORDER BY score DESC LIMIT ?`
    )
    .bind(limit)
    .all();
  return results;
}

async function hashIp(ip) {
  const data = new TextEncoder().encode('roadster-rush:' + ip);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (url.pathname !== '/scores') return json(req, { error: 'Not found' }, 404);

    if (req.method === 'GET') {
      return json(req, { top: await top(env.DB) }, 200, { 'Cache-Control': 'public, max-age=15' });
    }

    if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);

    let body;
    try {
      body = await req.json();
    } catch {
      return json(req, { error: 'Invalid JSON' }, 400);
    }
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    const score = Math.floor(Number(body.score));
    const distance = Math.floor(Number(body.distance));
    const topSpeed = Math.floor(Number(body.topSpeed));
    const duration = Number(body.duration);

    if (!NAME_RE.test(name)) return json(req, { error: 'Nickname must be 2 to 16 letters, numbers, spaces, dots, dashes or underscores.' }, 400);
    const lower = name.toLowerCase().replace(/[^a-z]/g, '');
    if (BLOCKED.some((w) => lower.includes(w))) return json(req, { error: 'Please choose a different nickname.' }, 400);
    if (![score, distance, topSpeed, duration].every(Number.isFinite)) return json(req, { error: 'Invalid run' }, 400);

    // Plausibility: score comes from distance (x2 while thrusting) plus bonuses,
    // the car tops out around 155 m/s, and a run needs real time to cover its distance.
    const plausible =
      score > 0 &&
      distance > 0 &&
      score <= distance * 34 + 2000 &&
      topSpeed <= 160 &&
      duration >= distance / 160 &&
      duration < 60 * 60 * 3;
    if (!plausible) return json(req, { error: 'Run could not be verified' }, 400);

    const ip = await hashIp(req.headers.get('CF-Connecting-IP') || 'unknown');
    const now = Date.now();
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE ip = ? AND created_at > ?')
      .bind(ip, now - 10_000)
      .first();
    if (recent && recent.n > 0) return json(req, { error: 'Slow down a moment, then try again.' }, 429);

    await env.DB.prepare('INSERT INTO scores (name, score, distance, top_speed, created_at, ip) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(name, score, distance, topSpeed, now, ip)
      .run();

    const better = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM (SELECT MAX(score) AS s FROM scores GROUP BY lower(name)) WHERE s > ?'
    )
      .bind(score)
      .first();
    return json(req, { rank: (better?.n || 0) + 1, top: await top(env.DB) });
  },
};
