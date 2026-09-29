const { getDB, verifyToken, getToken, cors, ok, err } = require('./_lib');
const { randomUUID } = require('crypto');

async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'MESH <onboarding@resend.dev>', to: [to], subject, html }),
    });
    if (!res.ok) console.error('Resend Error:', await res.text());
  } catch (e) { console.error('Email error:', e.message); }
}

function inviteEmail(fromName, toName, appUrl) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0f0f11;color:#f4f2ee;border-radius:8px">
      <h2 style="font-size:20px;font-weight:600;margin-bottom:12px">You have a new invite</h2>
      <p style="color:#7a7870;font-size:14px;"><strong>${fromName}</strong> wants to connect and build with you on Mesh.</p>
      <a href="${appUrl}" style="display:inline-block;background:#d4f53c;color:#0a0a0a;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:bold;">VIEW INVITE ON MESH →</a>
    </div>`;
}

function acceptEmail(acceptorName, appUrl) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0f0f11;color:#f4f2ee;border-radius:8px">
      <h2 style="font-size:20px;font-weight:600;">Your invite was accepted! 🎉</h2>
      <p style="color:#7a7870;"><strong>${acceptorName}</strong> accepted your invite.</p>
      <a href="${appUrl}" style="display:inline-block;background:#d4f53c;color:#0a0a0a;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:bold;">OPEN MESH →</a>
    </div>`;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyToken(getToken(req));
  if (!user) return err(res, 'Unauthorised', 401);

  const db = getDB();
  const appUrl = process.env.APP_URL || 'https://mesh-amber.vercel.app/';

  // ── GET sent invite IDs ──────────────────────────────
  if (req.method === 'GET' && req.query.type !== 'inbox') {
    const result = await db.execute({ sql: 'SELECT to_profile_id FROM invites WHERE from_user_id = ?', args: [user.sub] });
    return ok(res, { invites: result.rows.map(r => r.to_profile_id) });
  }

  // ── GET received invites (bell) ──────────────────────
  if (req.method === 'GET' && req.query.type === 'inbox') {
    try {
      const result = await db.execute({
        sql: `SELECT i.id, i.status, i.created_at,
                     p.name as from_name, p.role as from_role, p.id as from_profile_id,
                     u.email as from_email
              FROM invites i
              LEFT JOIN users u ON u.id = i.from_user_id
              LEFT JOIN profiles p ON p.user_id = i.from_user_id
              WHERE i.to_user_id = ?
              ORDER BY i.created_at DESC`,
        args: [user.sub],
      });
      return ok(res, { invites: result.rows });
    } catch (e) {
      return ok(res, { invites: [] });
    }
  }

  // ── POST send invite ─────────────────────────────────
  if (req.method === 'POST') {
    const { toProfileId } = req.body || {};
    if (!toProfileId) return err(res, 'toProfileId is required');

    const target = await db.execute({
      sql: 'SELECT p.id, p.name, u.id as uid, u.email FROM profiles p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?',
      args: [toProfileId],
    });
    if (!target.rows.length) return err(res, 'Profile not found', 404);
    const toUser = target.rows[0];

    const sender = await db.execute({ sql: 'SELECT name FROM profiles WHERE user_id = ?', args: [user.sub] });
    const fromName = sender.rows[0]?.name || 'A builder';

    const existing = await db.execute({
      sql: 'SELECT id FROM invites WHERE from_user_id = ? AND to_profile_id = ?',
      args: [user.sub, toProfileId],
    });

    if (existing.rows.length) {
      await db.execute({
        sql: "UPDATE invites SET status = 'pending', to_user_id = ?, created_at = datetime('now') WHERE from_user_id = ? AND to_profile_id = ?",
        args: [toUser.uid || '', user.sub, toProfileId],
      });
    } else {
      try {
        await db.execute({
          sql: 'INSERT INTO invites (id, from_user_id, to_user_id, to_profile_id) VALUES (?, ?, ?, ?)',
          args: [randomUUID(), user.sub, toUser.uid || '', toProfileId],
        });
      } catch (e) {
        return err(res, e.message, 500);
      }
    }

    if (toUser.email) {
      await sendEmail(toUser.email, `${fromName} wants to connect on Mesh`, inviteEmail(fromName, toUser.name, appUrl));
    }

    return ok(res, { message: 'Invite sent' }, 201);
  }

  // ── PUT accept/decline ───────────────────────────────
  if (req.method === 'PUT') {
    const { id, action } = req.query;
    if (!id || !action) return err(res, 'id and action required');

    const invite = await db.execute({
      sql: 'SELECT * FROM invites WHERE id = ?',
      args: [id],
    });
    if (!invite.rows.length) return err(res, 'Invite not found', 404);
    const inv = invite.rows[0];

    await db.execute({ sql: 'UPDATE invites SET status = ? WHERE id = ?', args: [action === 'accept' ? 'accepted' : 'declined', id] });

    if (action === 'accept') {
      const [u1, u2] = [inv.from_user_id, user.sub].sort();
      const teamId = randomUUID();
      try {
        await db.execute({
          sql: 'INSERT INTO teams (id, user1_id, user2_id, invite_id) VALUES (?, ?, ?, ?)',
          args: [teamId, u1, u2, id],
        });
        await db.execute({
          sql: 'INSERT INTO drafts (id, team_id, content) VALUES (?, ?, ?)',
          args: [randomUUID(), teamId, ''],
        });
      } catch (e) {
        if (!e.message.includes('UNIQUE')) return err(res, e.message, 500);
      }

      return ok(res, { message: 'Invite accepted — team formed!', teamId });
    }

    return ok(res, { message: 'Invite declined' });
  }

  return err(res, 'Method not allowed', 405);
};