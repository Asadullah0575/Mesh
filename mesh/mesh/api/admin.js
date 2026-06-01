// api/admin.js (CommonJS)
// All routes require is_admin = 1 on the user account
// GET  /api/admin?section=stats|users|profiles|teams|groups|messages
// PUT  /api/admin?action=ban|unban|makeAdmin|removeAdmin&userId=
// DELETE /api/admin?action=deleteUser|deleteProfile|dissolveTeam|dissolveGroup|deleteMessage&id=

const { getDB, verifyToken, getToken, cors, ok, err } = require('./_lib');

async function requireAdmin(req, res, db) {
  const user = await verifyToken(getToken(req));
  if (!user) { err(res, 'Unauthorised', 401); return null; }
  const row = await db.execute({
    sql: 'SELECT is_admin FROM users WHERE id = ?',
    args: [user.sub],
  });
  if (!row.rows[0]?.is_admin) { err(res, 'Forbidden — admin only', 403); return null; }
  return user;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = getDB();
  const admin = await requireAdmin(req, res, db);
  if (!admin) return;

  const { section, action, userId, id } = req.query;

  // ── GET sections ─────────────────────────────────────
  if (req.method === 'GET') {

    // STATS
    if (section === 'stats') {
      const [users, profiles, teams, groups, messages, gmessages] = await Promise.all([
        db.execute('SELECT COUNT(*) as n FROM users'),
        db.execute('SELECT COUNT(*) as n FROM profiles'),
        db.execute('SELECT COUNT(*) as n FROM teams'),
        db.execute('SELECT COUNT(*) as n FROM groups'),
        db.execute('SELECT COUNT(*) as n FROM messages'),
        db.execute('SELECT COUNT(*) as n FROM group_messages WHERE deleted = 0'),
      ]);
      const banned   = await db.execute('SELECT COUNT(*) as n FROM users WHERE is_banned = 1');
      const admins   = await db.execute('SELECT COUNT(*) as n FROM users WHERE is_admin = 1');
      // recent signups (last 7 days)
      const recent   = await db.execute("SELECT COUNT(*) as n FROM users WHERE created_at >= datetime('now','-7 days')");
      return ok(res, {
        stats: {
          users:       users.rows[0]?.n || 0,
          profiles:    profiles.rows[0]?.n || 0,
          teams:       teams.rows[0]?.n || 0,
          groups:      groups.rows[0]?.n || 0,
          messages:    (messages.rows[0]?.n || 0) + (gmessages.rows[0]?.n || 0),
          banned:      banned.rows[0]?.n || 0,
          admins:      admins.rows[0]?.n || 0,
          recentSignups: recent.rows[0]?.n || 0,
        }
      });
    }

    // USERS
    if (section === 'users') {
      const result = await db.execute(`
        SELECT u.id, u.email, u.is_admin, u.is_banned, u.created_at,
               p.name, p.role, p.avatar_url
        FROM users u
        LEFT JOIN profiles p ON p.user_id = u.id
        ORDER BY u.created_at DESC
        LIMIT 200
      `);
      return ok(res, { users: result.rows });
    }

    // PROFILES
    if (section === 'profiles') {
      const result = await db.execute(`
        SELECT p.*, u.email, u.is_banned
        FROM profiles p
        JOIN users u ON u.id = p.user_id
        ORDER BY p.created_at DESC
        LIMIT 200
      `);
      return ok(res, { profiles: result.rows.map(r => ({
        ...r,
        skills:      safeJSON(r.skills, []),
        looking_for: safeJSON(r.looking_for, []),
      }))});
    }

    // TEAMS
    if (section === 'teams') {
      const result = await db.execute(`
        SELECT t.id, t.created_at,
               p1.name as user1_name, p1.avatar_url as user1_avatar,
               p2.name as user2_name, p2.avatar_url as user2_avatar,
               (SELECT COUNT(*) FROM messages m WHERE m.team_id = t.id) as msg_count
        FROM teams t
        LEFT JOIN profiles p1 ON p1.user_id = t.user1_id
        LEFT JOIN profiles p2 ON p2.user_id = t.user2_id
        ORDER BY t.created_at DESC
        LIMIT 200
      `);
      return ok(res, { teams: result.rows });
    }

    // GROUPS
    if (section === 'groups') {
      const result = await db.execute(`
        SELECT g.id, g.name, g.created_at,
               p.name as creator_name,
               (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count,
               (SELECT COUNT(*) FROM group_messages gm2 WHERE gm2.group_id = g.id AND gm2.deleted = 0) as msg_count
        FROM groups g
        LEFT JOIN profiles p ON p.user_id = g.created_by
        ORDER BY g.created_at DESC
        LIMIT 200
      `);
      return ok(res, { groups: result.rows });
    }

    // MESSAGES (recent 100 across both tables)
    if (section === 'messages') {
      const direct = await db.execute(`
        SELECT m.id, m.body, m.created_at, 'direct' as type,
               pf.name as from_name, pt.name as to_name
        FROM messages m
        LEFT JOIN profiles pf ON pf.user_id = m.from_user_id
        LEFT JOIN teams t ON t.id = m.team_id
        LEFT JOIN profiles pt ON pt.user_id = CASE WHEN t.user1_id = m.from_user_id THEN t.user2_id ELSE t.user1_id END
        ORDER BY m.created_at DESC LIMIT 50
      `);
      const group = await db.execute(`
        SELECT gm.id, gm.body, gm.created_at, 'group' as type,
               p.name as from_name, g.name as to_name, gm.deleted
        FROM group_messages gm
        LEFT JOIN profiles p ON p.user_id = gm.from_user_id
        LEFT JOIN groups g ON g.id = gm.group_id
        ORDER BY gm.created_at DESC LIMIT 50
      `);
      const all = [...direct.rows, ...group.rows]
        .sort((a,b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 100);
      return ok(res, { messages: all });
    }

    return err(res, 'Unknown section');
  }

  // ── PUT actions ───────────────────────────────────────
  if (req.method === 'PUT') {
    if (!userId) return err(res, 'userId required');
    // prevent self-demotion
    if (userId === admin.sub && (action === 'removeAdmin' || action === 'ban'))
      return err(res, 'Cannot modify your own admin account');

    if (action === 'ban')         await db.execute({ sql: 'UPDATE users SET is_banned = 1 WHERE id = ?', args: [userId] });
    else if (action === 'unban')  await db.execute({ sql: 'UPDATE users SET is_banned = 0 WHERE id = ?', args: [userId] });
    else if (action === 'makeAdmin')   await db.execute({ sql: 'UPDATE users SET is_admin = 1 WHERE id = ?', args: [userId] });
    else if (action === 'removeAdmin') await db.execute({ sql: 'UPDATE users SET is_admin = 0 WHERE id = ?', args: [userId] });
    else return err(res, 'Unknown action');

    return ok(res, { message: 'Done' });
  }

  // ── DELETE actions ────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!id) return err(res, 'id required');

    if (action === 'deleteUser') {
      if (id === admin.sub) return err(res, 'Cannot delete your own account');
      await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [id] });
    }
    else if (action === 'deleteProfile') {
      await db.execute({ sql: 'DELETE FROM profiles WHERE id = ?', args: [id] });
    }
    else if (action === 'dissolveTeam') {
      await db.execute({ sql: 'DELETE FROM teams WHERE id = ?', args: [id] });
    }
    else if (action === 'dissolveGroup') {
      await db.execute({ sql: 'DELETE FROM groups WHERE id = ?', args: [id] });
    }
    else if (action === 'deleteMessage') {
      await db.execute({ sql: 'DELETE FROM messages WHERE id = ?', args: [id] });
      await db.execute({ sql: "UPDATE group_messages SET deleted=1,body='Deleted by admin' WHERE id = ?", args: [id] });
    }
    else return err(res, 'Unknown action');

    return ok(res, { message: 'Deleted' });
  }

  return err(res, 'Method not allowed', 405);
};

function safeJSON(s, fb) { try { return JSON.parse(s); } catch { return fb; } }