// api/messages.js (CommonJS)
// GET  /api/messages?teamId=&after=  — fetch messages in a team chat
// POST /api/messages                 — send message to team

const { getDB, verifyToken, getToken, cors, ok, err } = require('./_lib');
const { randomUUID } = require('crypto');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyToken(getToken(req));
  if (!user) return err(res, 'Unauthorised', 401);

  const db = getDB();

  // verify user is in this team
  async function verifyTeamMember(teamId) {
    const r = await db.execute({
      sql: 'SELECT id FROM teams WHERE id = ? AND (user1_id = ? OR user2_id = ?)',
      args: [teamId, user.sub, user.sub],
    });
    return r.rows.length > 0;
  }

  // ── GET messages ─────────────────────────────────────
  if (req.method === 'GET') {
    const { teamId, after } = req.query;
    if (!teamId) return err(res, 'teamId required');
    if (!await verifyTeamMember(teamId)) return err(res, 'Not a team member', 403);

    let sql = `SELECT m.*, p.name as from_name
               FROM messages m
               LEFT JOIN profiles p ON p.user_id = m.from_user_id
               WHERE m.team_id = ?`;
    const args = [teamId];
    if (after) { sql += ' AND m.created_at > ?'; args.push(after); }
    sql += ' ORDER BY m.created_at ASC LIMIT 100';

    const result = await db.execute({ sql, args });

    // mark as read
    await db.execute({
      sql: 'UPDATE messages SET read = 1 WHERE team_id = ? AND from_user_id != ? AND read = 0',
      args: [teamId, user.sub],
    });

    return ok(res, { messages: result.rows });
  }

  // ── POST send ────────────────────────────────────────
  if (req.method === 'POST') {
    const { teamId, body } = req.body || {};
    if (!teamId || !body?.trim()) return err(res, 'teamId and body required');
    if (body.length > 2000) return err(res, 'Message too long');
    if (!await verifyTeamMember(teamId)) return err(res, 'Not a team member', 403);

    const id = randomUUID();
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
    await db.execute({
      sql: 'INSERT INTO messages (id, team_id, from_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [id, teamId, user.sub, body.trim(), now],
    });

    const row = await db.execute({ sql: 'SELECT * FROM messages WHERE id = ?', args: [id] });
    return ok(res, { message: row.rows[0] }, 201);
  }

  // ── PUT edit message ──────────────────────────────────
  if (req.method === 'PUT') {
    const { editMsg } = req.query;
    if (!editMsg) return err(res, 'editMsg required');

    const msgRow = await db.execute({
      sql: 'SELECT from_user_id FROM messages WHERE id = ? AND team_id = ?',
      args: [editMsg, req.query.teamId || ''],
    });
    if (!msgRow.rows.length) return err(res, 'Message not found', 404);
    if (msgRow.rows[0].from_user_id !== user.sub) return err(res, 'Can only edit your own messages', 403);

    const { body } = req.body || {};
    if (!body?.trim()) return err(res, 'body required');

    await db.execute({
      sql: 'UPDATE messages SET body = ? WHERE id = ?',
      args: [body.trim(), editMsg],
    });
    return ok(res, { message: 'Message updated', body: body.trim() });
  }

  return err(res, 'Method not allowed', 405);
};