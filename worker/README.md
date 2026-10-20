# Roadster Rush leaderboard

A Cloudflare Worker plus a D1 database that stores nickname scores. No accounts, no personal data: the only extra field is a salted hash of the IP address, used for rate limiting (one score per 10 seconds).

The D1 database `roadster-rush-leaderboard` and its table already exist (see `schema.sql`).

## Deploy

```bash
cd worker
npx wrangler login      # first time only
npx wrangler deploy
```

Wrangler prints the Worker URL, for example `https://roadster-rush-leaderboard.<your-subdomain>.workers.dev`. Put it in `js/leaderboard.js`:

```js
export const API = 'https://roadster-rush-leaderboard.<your-subdomain>.workers.dev';
```

Push, and the leaderboard appears in the game.

## API

- `GET /scores` returns the top 10 (best run per nickname).
- `POST /scores` with `{ name, score, distance, topSpeed, duration }` returns `{ rank, top }`.

Nicknames must be 2 to 16 letters, numbers, spaces, dots, dashes or underscores, and a small word filter rejects offensive ones. Runs are checked for plausibility (score against distance, top speed, run time). A browser game cannot be made fully cheat-proof, so the checks only stop obviously fake scores.

## Moderation

Remove a score from the Cloudflare dashboard (D1, Console) with:

```sql
DELETE FROM scores WHERE lower(name) = lower('nickname');
```
