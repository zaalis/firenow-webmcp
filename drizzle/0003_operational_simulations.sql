CREATE TABLE IF NOT EXISTS operational_simulations (
  user_id TEXT PRIMARY KEY,
  simulation_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
