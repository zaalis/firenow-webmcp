export const authSchema = [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)",
  "CREATE TABLE IF NOT EXISTS login_attempts (identifier TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, last_failed_at INTEGER NOT NULL, locked_until INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)",
] as const;

export const operationalDraftSchema = [
  "CREATE TABLE IF NOT EXISTS operational_drafts (user_id TEXT PRIMARY KEY, plan_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'review')), revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)",
] as const;

export const operationalSimulationSchema = [
  "CREATE TABLE IF NOT EXISTS operational_simulations (user_id TEXT PRIMARY KEY, simulation_json TEXT NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)",
] as const;
