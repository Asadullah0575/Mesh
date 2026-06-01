// api/init.js (CommonJS)
const { getDB, cors, ok, err } = require('./_lib');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.query.secret !== 'mesh-init-2026') return err(res, 'Forbidden', 403);

  const db = getDB();
  try {
    await db.executeMultiple(`
      CREATE TABLE IF NOT EXISTS users (
        id           TEXT PRIMARY KEY,
        email        TEXT UNIQUE NOT NULL,
        password     TEXT NOT NULL,
        reset_token  TEXT,
        reset_expiry TEXT,
        created_at   TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        role        TEXT NOT NULL,
        track       TEXT NOT NULL,
        timezone    TEXT NOT NULL,
        bio         TEXT NOT NULL,
        country     TEXT DEFAULT '??',
        skills      TEXT DEFAULT '[]',
        looking_for TEXT DEFAULT '[]',
        is_active   INTEGER DEFAULT 1,
        created_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS invites (
        id            TEXT PRIMARY KEY,
        from_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        to_user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        to_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        status        TEXT DEFAULT 'pending',
        created_at    TEXT DEFAULT (datetime('now')),
        UNIQUE(from_user_id, to_profile_id)
      );

      CREATE TABLE IF NOT EXISTS teams (
        id         TEXT PRIMARY KEY,
        user1_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user2_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invite_id  TEXT REFERENCES invites(id),
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user1_id, user2_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id           TEXT PRIMARY KEY,
        team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body         TEXT NOT NULL,
        read         INTEGER DEFAULT 0,
        created_at   TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS drafts (
        id         TEXT PRIMARY KEY,
        team_id    TEXT NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
        content    TEXT DEFAULT '',
        updated_at TEXT DEFAULT (datetime('now')),
        updated_by TEXT REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_profiles_track    ON profiles(track);
      CREATE INDEX IF NOT EXISTS idx_profiles_timezone ON profiles(timezone);
      CREATE INDEX IF NOT EXISTS idx_invites_to        ON invites(to_user_id, status);
      CREATE INDEX IF NOT EXISTS idx_messages_team     ON messages(team_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_teams_users       ON teams(user1_id, user2_id);
    `);
    ok(res, { message: 'Tables created successfully' });
  } catch (e) {
    err(res, e.message, 500);
  }
};