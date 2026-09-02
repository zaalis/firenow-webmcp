CREATE TABLE IF NOT EXISTS operational_drafts (
  user_id TEXT PRIMARY KEY,
  plan_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'review')),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
