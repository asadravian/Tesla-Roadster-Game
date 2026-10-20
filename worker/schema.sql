CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  distance INTEGER NOT NULL,
  top_speed INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ip TEXT NOT NULL -- salted hash, used only for rate limiting
);
CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_ip ON scores(ip, created_at);
