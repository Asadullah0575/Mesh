// api/migrate.js (CommonJS)
// GET /api/migrate?secret=mesh-init-2026
// Safely adds missing columns to existing tables

const { getDB, cors, ok, err } = require('./_lib');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.query.secret !== 'mesh-init-2026') return err(res, 'Forbidden', 403);

  const db = getDB();
  const results = [];

  async function run(label, sql) {
    try {
      await db.execute(sql);
      results.push({ label, status: 'ok' });
    } catch (e) {
      // ignore "duplicate column" errors — means it already exists
      if (e.message.includes('duplicate column') || e.message.includes('already exists')) {
        results.push({ label, status: 'already exists' });
      } else {
        results.push({ label, status: 'error', error: e.message });
      }
    }
  }

  // Add missing columns to invites
  await run('invites.to_user_id',   'ALTER TABLE invites ADD COLUMN to_user_id TEXT');
  await run('invites.status',       "ALTER TABLE invites ADD COLUMN status TEXT DEFAULT 'pending'");

  // Add missing columns to users (for password reset)
  await run('users.reset_token',    'ALTER TABLE users ADD COLUMN reset_token TEXT');
  await run('users.reset_expiry',   'ALTER TABLE users ADD COLUMN reset_expiry TEXT');

  // Create new tables if they don't exist
  await run('teams table', `
    CREATE TABLE IF NOT EXISTS teams (
      id         TEXT PRIMARY KEY,
      user1_id   TEXT NOT NULL,
      user2_id   TEXT NOT NULL,
      invite_id  TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user1_id, user2_id)
    )
  `);

  await run('messages table', `
    CREATE TABLE IF NOT EXISTS messages (
      id           TEXT PRIMARY KEY,
      team_id      TEXT NOT NULL,
      from_user_id TEXT NOT NULL,
      body         TEXT NOT NULL,
      read         INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now'))
    )
  `);

  await run('drafts table', `
    CREATE TABLE IF NOT EXISTS drafts (
      id         TEXT PRIMARY KEY,
      team_id    TEXT NOT NULL UNIQUE,
      content    TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      updated_by TEXT
    )
  `);

  // Add social + photo columns to profiles
  await run('profiles.avatar_url', 'ALTER TABLE profiles ADD COLUMN avatar_url TEXT');
  await run('profiles.twitter',    'ALTER TABLE profiles ADD COLUMN twitter TEXT');
  await run('profiles.github',     'ALTER TABLE profiles ADD COLUMN github TEXT');
  await run('profiles.website',    'ALTER TABLE profiles ADD COLUMN website TEXT');

  // Backfill to_user_id for existing invites using profile's user_id
  await run('messages.team_id', 'ALTER TABLE messages ADD COLUMN team_id TEXT');
  await run('messages.from_user_id', 'ALTER TABLE messages ADD COLUMN from_user_id TEXT');
  await run('messages.body', 'ALTER TABLE messages ADD COLUMN body TEXT');
  await run('messages.read', 'ALTER TABLE messages ADD COLUMN read INTEGER DEFAULT 0');
  // Add social links and avatar to profiles
  await run('profiles.avatar_url', 'ALTER TABLE profiles ADD COLUMN avatar_url TEXT');
  await run('profiles.github',     'ALTER TABLE profiles ADD COLUMN github TEXT');
  await run('profiles.twitter',    'ALTER TABLE profiles ADD COLUMN twitter TEXT');
  await run('profiles.website',    'ALTER TABLE profiles ADD COLUMN website TEXT');

  // Groups
  await run('groups table', `
    CREATE TABLE IF NOT EXISTS groups (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TEXT DEFAULT (datetime('now'))
    )
  `);

  await run('group_members table', `
    CREATE TABLE IF NOT EXISTS group_members (
      id         TEXT PRIMARY KEY,
      group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(group_id, user_id)
    )
  `);

  await run('group_messages table', `
    CREATE TABLE IF NOT EXISTS group_messages (
      id           TEXT PRIMARY KEY,
      group_id     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body         TEXT NOT NULL,
      created_at   TEXT DEFAULT (datetime('now'))
    )
  `);

  // Add type and file_url columns to group_messages
  await run('group_messages.type',     "ALTER TABLE group_messages ADD COLUMN type TEXT DEFAULT 'text'");
  await run('group_messages.file_url', 'ALTER TABLE group_messages ADD COLUMN file_url TEXT');
  await run('group_messages.deleted',  'ALTER TABLE group_messages ADD COLUMN deleted INTEGER DEFAULT 0');
  // Add admin tracking to groups
  await run('groups.admin_id', 'ALTER TABLE groups ADD COLUMN admin_id TEXT');

  await run('idx group_members', 'CREATE INDEX IF NOT EXISTS idx_group_members ON group_members(group_id, user_id)');
  await run('idx group_messages', 'CREATE INDEX IF NOT EXISTS idx_group_messages ON group_messages(group_id, created_at ASC)');

  // Admin flag
  await run('users.is_admin', 'ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0');
  await run('users.is_banned', 'ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0');

  // Grant admin to platform owner
  await run('grant admin', `UPDATE users SET is_admin = 1 WHERE email = 'adetayomuhsin@gmail.com'`);

  await run('backfill to_user_id', `
    UPDATE invites
    SET to_user_id = (
      SELECT p.user_id FROM profiles p WHERE p.id = invites.to_profile_id
    )
    WHERE to_user_id IS NULL
  `);

  // Add indexes
  await run('idx invites to_user', 'CREATE INDEX IF NOT EXISTS idx_invites_to ON invites(to_user_id, status)');
  // run messages index last with a retry after table creation
  await new Promise(r => setTimeout(r, 500));
  await run('idx messages team',   'CREATE INDEX IF NOT EXISTS idx_messages_team ON messages(team_id, created_at ASC)');
  await run('idx teams users',     'CREATE INDEX IF NOT EXISTS idx_teams_users ON teams(user1_id, user2_id)');

  return ok(res, { message: 'Migration complete', results });
};