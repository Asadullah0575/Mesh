// api/draft.js (CommonJS)
// GET /api/draft?teamId=  — get shared draft
// PUT /api/draft?teamId=  — update shared draft

const { getDB, verifyToken, getToken, cors, ok, err } = require('./_lib');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyToken(getToken(req));
  if (!user) return err(res, 'Unauthorised', 401);

  const db = getDB();
  const { teamId } = req.query;
  if (!teamId) return err(res, 'teamId required');

  // verify membership
  const member = await db.execute({
    sql: 'SELECT id FROM teams WHERE id = ? AND (user1_id = ? OR user2_id = ?)',
    args: [teamId, user.sub, user.sub],
  });
  if (!member.rows.length) return err(res, 'Not a team member', 403);

  // ── GET draft ────────────────────────────────────────
  if (req.method === 'GET') {
    const result = await db.execute({ sql: 'SELECT * FROM drafts WHERE team_id = ?', args: [teamId] });
    return ok(res, { draft: result.rows[0] || { content: '', updated_at: null, updated_by: null } });
  }

  // ── PUT update draft ─────────────────────────────────
  if (req.method === 'PUT') {
    const { content } = req.body || {};
    if (content === undefined) return err(res, 'content required');
    if (content.length > 50000) return err(res, 'Draft too large');

    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
    await db.execute({
      sql: `INSERT INTO drafts (id, team_id, content, updated_at, updated_by)
            VALUES ((SELECT id FROM drafts WHERE team_id = ?), ?, ?, ?, ?)
            ON CONFLICT(team_id) DO UPDATE SET content = ?, updated_at = ?, updated_by = ?`,
      args: [teamId, teamId, content, now, user.sub, content, now, user.sub],
    });

    return ok(res, { message: 'Draft saved', updated_at: now });
  }

  return err(res, 'Method not allowed', 405);
};