// api/inbox.js (CommonJS)
// GET /api/inbox — list all conversations for current user

const { getDB, verifyToken, getToken, cors, ok, err } = require('./_lib');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);

  const user = await verifyToken(getToken(req));
  if (!user) return err(res, 'Unauthorised', 401);

  const db = getDB();

  // Get all unique conversation partners with last message + unread count
  const result = await db.execute({
    sql: `
      SELECT
        other_id,
        p.name       as other_name,
        p.role       as other_role,
        last_body,
        last_time,
        unread_count
      FROM (
        SELECT
          CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END as other_id,
          body  as last_body,
          created_at as last_time,
          SUM(CASE WHEN to_user_id = ? AND read = 0 THEN 1 ELSE 0 END) as unread_count,
          ROW_NUMBER() OVER (
            PARTITION BY CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END
            ORDER BY created_at DESC
          ) as rn
        FROM messages
        WHERE from_user_id = ? OR to_user_id = ?
        GROUP BY other_id, body, created_at
      ) sub
      LEFT JOIN profiles p ON p.user_id = sub.other_id
      WHERE rn = 1
      ORDER BY last_time DESC
    `,
    args: [user.sub, user.sub, user.sub, user.sub, user.sub],
  });

  return ok(res, { conversations: result.rows });
};