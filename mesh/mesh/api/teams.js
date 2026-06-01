// api/teams.js (CommonJS)
// GET /api/teams — list my teams with partner info

const { getDB, verifyToken, getToken, cors, ok, err } = require('./_lib');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);

  const user = await verifyToken(getToken(req));
  if (!user) return err(res, 'Unauthorised', 401);

  const db = getDB();

  try {
    // Get all teams the user belongs to
    const teamsResult = await db.execute({
      sql: `SELECT * FROM teams WHERE user1_id = ? OR user2_id = ? ORDER BY created_at DESC`,
      args: [user.sub, user.sub],
    });

    if (!teamsResult.rows.length) return ok(res, { teams: [] });

    // For each team, get partner profile and unread count
    const teams = [];
    for (const team of teamsResult.rows) {
      const partnerId = team.user1_id === user.sub ? team.user2_id : team.user1_id;

      const profileResult = await db.execute({
        sql: `SELECT id, name, role, user_id, avatar_url FROM profiles WHERE user_id = ?`,
        args: [partnerId],
      });

      let unreadResult = { rows: [{ n: 0 }] };
      try {
        unreadResult = await db.execute({
          sql: `SELECT COUNT(*) as n FROM messages WHERE team_id = ? AND from_user_id != ? AND read = 0`,
          args: [team.id, user.sub],
        });
      } catch(e) {}

      teams.push({
        team_id:            team.id,
        created_at:         team.created_at,
        partner_user_id:    partnerId,
        partner_profile_id: profileResult.rows[0]?.id || null,
        partner_name:       profileResult.rows[0]?.name || 'Unknown',
        partner_role:       profileResult.rows[0]?.role || '',
        partner_avatar_url: profileResult.rows[0]?.avatar_url || null,
        unread:             unreadResult.rows[0]?.n || 0,
      });
    }

    return ok(res, { teams });
  } catch (e) {
    return err(res, e.message, 500);
  }
};