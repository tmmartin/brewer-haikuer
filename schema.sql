-- Brewer Haikuer: reader submissions awaiting (or past) review.
-- Apply with:  npx wrangler d1 execute brewer-haikuer --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS submissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT NOT NULL,                    -- ISO timestamp (UTC)
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  lines        TEXT NOT NULL,                    -- JSON array of 3 strings
  name         TEXT,                             -- shown publicly if present
  date         TEXT NOT NULL,                    -- game date, YYYY-MM-DD
  note         TEXT,                             -- private note to the owner
  ip_hash      TEXT,                             -- salted hash, for rate limiting only
  game         TEXT,                             -- JSON {pk,opp,rs,ra,n,post,year} or NULL = off-field
  reviewed_at  TEXT,
  reviewed_by  TEXT,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_ip ON submissions(ip_hash, created_at);
