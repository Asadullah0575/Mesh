// api/profiles.js (CommonJS)
const { getDB, verifyToken, getToken, cors, ok, err } = require('./_lib');
const { randomUUID } = require('crypto');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = getDB();

  // ── GET all ──────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const result = await db.execute('SELECT * FROM profiles ORDER BY created_at DESC');
      return ok(res, { profiles: result.rows.map(parse) });
    } catch (e) {
      return err(res, e.message, 500);
    }
  }

  // ── POST create ──────────────────────────────────────
  if (req.method === 'POST') {
    const user = await verifyToken(getToken(req));
    if (!user) return err(res, 'Unauthorised', 401);

    const { name, role, track, timezone, bio, country, skills, lookingFor, avatarUrl, twitter, github, website } = req.body || {};
    if (!name || !role || !track || !timezone || !bio) return err(res, 'Missing required fields');

    const existing = await db.execute({ sql: 'SELECT id FROM profiles WHERE user_id = ?', args: [user.sub] });
    if (existing.rows.length) return err(res, 'You already have a profile. Edit or delete it first.');

    const id = randomUUID();
    await db.execute({
      sql: `INSERT INTO profiles (id, user_id, name, role, track, timezone, bio, country, skills, looking_for, avatar_url, twitter, github, website)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, user.sub, name, role, track, timezone, bio,
        country || '??',
        JSON.stringify(skills || []),
        JSON.stringify(lookingFor || []),
        avatarUrl || null, twitter || null, github || null, website || null],
    });

    const row = await db.execute({ sql: 'SELECT * FROM profiles WHERE id = ?', args: [id] });
    return ok(res, { profile: parse(row.rows[0]) }, 201);
  }

  // ── PUT edit ─────────────────────────────────────────
  if (req.method === 'PUT') {
    const user = await verifyToken(getToken(req));
    if (!user) return err(res, 'Unauthorised', 401);

    const { id } = req.query;
    if (!id) return err(res, 'Profile id required');

    const { name, role, track, timezone, bio, country, skills, lookingFor, avatarUrl, twitter, github, website } = req.body || {};
    if (!name || !role || !track || !timezone || !bio) return err(res, 'Missing required fields');

    const result = await db.execute({
      sql: `UPDATE profiles SET
              name = ?, role = ?, track = ?, timezone = ?, bio = ?,
              country = ?, skills = ?, looking_for = ?,
              avatar_url = ?, twitter = ?, github = ?, website = ?
            WHERE id = ? AND user_id = ?`,
      args: [name, role, track, timezone, bio,
        country || '??',
        JSON.stringify(skills || []),
        JSON.stringify(lookingFor || []),
        avatarUrl || null, twitter || null, github || null, website || null,
        id, user.sub],
    });

    if (result.rowsAffected === 0) return err(res, 'Profile not found or not yours', 404);
    const row = await db.execute({ sql: 'SELECT * FROM profiles WHERE id = ?', args: [id] });
    return ok(res, { profile: parse(row.rows[0]) });
  }

  // ── DELETE ───────────────────────────────────────────
  if (req.method === 'DELETE') {
    const user = await verifyToken(getToken(req));
    if (!user) return err(res, 'Unauthorised', 401);

    const { id } = req.query;
    if (!id) return err(res, 'Profile id required');

    const result = await db.execute({
      sql: 'DELETE FROM profiles WHERE id = ? AND user_id = ?', args: [id, user.sub],
    });
    if (result.rowsAffected === 0) return err(res, 'Profile not found or not yours', 404);
    return ok(res, { message: 'Profile deleted' });
  }

  return err(res, 'Method not allowed', 405);
};

function parse(row) {
  return {
    ...row,
    skills:      safeJSON(row.skills,      []),
    looking_for: safeJSON(row.looking_for, []),
    is_active:   row.is_active === 1 || row.is_active === true,
  };
}

function safeJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}