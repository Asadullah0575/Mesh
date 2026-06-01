// api/groups.js (CommonJS)
const { getDB, verifyToken, getToken, cors, ok, err } = require('./_lib');
const { randomUUID } = require('crypto');
const crypto = require('crypto');

async function uploadToCloudinary(base64, userId) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) throw new Error('Cloudinary not configured');

  const timestamp = Math.floor(Date.now() / 1000);
  const folder    = 'mesh/group-files';
  const publicId  = `group-files/${userId}/${randomUUID()}`;
  const sigStr    = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha1').update(sigStr).digest('hex');

  const body = new URLSearchParams();
  body.append('file',      base64);
  body.append('api_key',   apiKey);
  body.append('timestamp', String(timestamp));
  body.append('signature', signature);
  body.append('folder',    folder);
  body.append('public_id', publicId);
  body.append('resource_type', 'auto');

  const res  = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, { method:'POST', body });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return { url: data.secure_url, resourceType: data.resource_type };
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await verifyToken(getToken(req));
  if (!user) return err(res, 'Unauthorised', 401);

  const db = getDB();
  const { id, msgs, msg, add, remove, leave, deleteMsg, editMsg } = req.query;

  // ── GET my groups ────────────────────────────────────
  if (req.method === 'GET' && !id) {
    try {
      const result = await db.execute({
        sql: `SELECT g.id, g.name, g.created_by, g.admin_id, g.created_at,
                     (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count,
                     (SELECT body FROM group_messages gm2 WHERE gm2.group_id = g.id AND gm2.deleted = 0 ORDER BY gm2.created_at DESC LIMIT 1) as last_message,
                     (SELECT p.name FROM profiles p WHERE p.user_id = g.created_by) as creator_name
              FROM groups g
              JOIN group_members m ON m.group_id = g.id
              WHERE m.user_id = ?
              ORDER BY g.created_at DESC`,
        args: [user.sub],
      });
      return ok(res, { groups: result.rows });
    } catch(e) { return err(res, e.message, 500); }
  }

  // ── GET group messages + members ─────────────────────
  if (req.method === 'GET' && id && msgs) {
    const { after } = req.query;
    const member = await db.execute({
      sql: 'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      args: [id, user.sub],
    });
    if (!member.rows.length) return err(res, 'Not a group member', 403);

    let sql = `SELECT gm.id, gm.group_id, gm.from_user_id, gm.body, gm.type, gm.file_url, gm.deleted, gm.created_at,
                      p.name as from_name, p.avatar_url as from_avatar
               FROM group_messages gm
               LEFT JOIN profiles p ON p.user_id = gm.from_user_id
               WHERE gm.group_id = ?`;
    const args = [id];
    if (after) { sql += ' AND gm.created_at > ?'; args.push(after); }
    sql += ' ORDER BY gm.created_at ASC LIMIT 150';

    const result = await db.execute({ sql, args });

    const members = await db.execute({
      sql: `SELECT u.id, p.name, p.avatar_url, p.role
            FROM group_members gm
            JOIN users u ON u.id = gm.user_id
            LEFT JOIN profiles p ON p.user_id = gm.user_id
            WHERE gm.group_id = ?`,
      args: [id],
    });

    const group = await db.execute({ sql: 'SELECT * FROM groups WHERE id = ?', args: [id] });

    return ok(res, {
      messages: result.rows,
      members:  members.rows,
      group:    group.rows[0] || null,
      isAdmin:  group.rows[0]?.created_by === user.sub || group.rows[0]?.admin_id === user.sub,
    });
  }

  // ── POST create group ────────────────────────────────
  if (req.method === 'POST' && !id) {
    const { name, memberUserIds } = req.body || {};
    if (!name?.trim()) return err(res, 'Group name required');

    const teamCheck = await db.execute({
      sql: 'SELECT id FROM teams WHERE user1_id = ? OR user2_id = ? LIMIT 1',
      args: [user.sub, user.sub],
    });
    if (!teamCheck.rows.length) return err(res, 'You must form a team before creating groups');

    const groupId = randomUUID();
    const now = new Date().toISOString().replace('T',' ').replace('Z','');

    await db.execute({
      sql: 'INSERT INTO groups (id, name, created_by, admin_id, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [groupId, name.trim(), user.sub, user.sub, now],
    });
    await db.execute({
      sql: 'INSERT INTO group_members (id, group_id, user_id) VALUES (?, ?, ?)',
      args: [randomUUID(), groupId, user.sub],
    });

    if (Array.isArray(memberUserIds)) {
      for (const uid of memberUserIds) {
        const shared = await db.execute({
          sql: `SELECT id FROM teams WHERE (user1_id=? AND user2_id=?) OR (user1_id=? AND user2_id=?)`,
          args: [user.sub, uid, uid, user.sub],
        });
        if (shared.rows.length) {
          try {
            await db.execute({
              sql: 'INSERT INTO group_members (id, group_id, user_id) VALUES (?, ?, ?)',
              args: [randomUUID(), groupId, uid],
            });
          } catch(e) {}
        }
      }
    }

    const group = await db.execute({ sql: 'SELECT * FROM groups WHERE id = ?', args: [groupId] });
    return ok(res, { group: group.rows[0] }, 201);
  }

  // ── POST send message (text or file) ─────────────────
  if (req.method === 'POST' && id && msg) {
    const { body, fileBase64, fileName } = req.body || {};
    if (!body?.trim() && !fileBase64) return err(res, 'Message or file required');

    const member = await db.execute({
      sql: 'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      args: [id, user.sub],
    });
    if (!member.rows.length) return err(res, 'Not a group member', 403);

    let type = 'text', fileUrl = null, msgBody = body?.trim() || '';

    if (fileBase64) {
      if (fileBase64.length > 5000000) return err(res, 'File too large. Max 3MB.');
      try {
        const uploaded = await uploadToCloudinary(fileBase64, user.sub);
        fileUrl = uploaded.url;
        type = uploaded.resourceType === 'image' ? 'image' : 'file';
        if (!msgBody) msgBody = fileName || (type === 'image' ? 'Image' : 'File');
      } catch(e) { return err(res, 'Upload failed: ' + e.message, 500); }
    }

    const msgId = randomUUID();
    const now   = new Date().toISOString().replace('T',' ').replace('Z','');
    await db.execute({
      sql: 'INSERT INTO group_messages (id, group_id, from_user_id, body, type, file_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [msgId, id, user.sub, msgBody, type, fileUrl, now],
    });

    const row = await db.execute({
      sql: `SELECT gm.*, p.name as from_name, p.avatar_url as from_avatar
            FROM group_messages gm LEFT JOIN profiles p ON p.user_id = gm.from_user_id
            WHERE gm.id = ?`,
      args: [msgId],
    });
    return ok(res, { message: row.rows[0] }, 201);
  }

  // ── DELETE message ───────────────────────────────────
  if (req.method === 'DELETE' && id && deleteMsg) {
    const msgRow = await db.execute({
      sql: 'SELECT from_user_id FROM group_messages WHERE id = ? AND group_id = ?',
      args: [deleteMsg, id],
    });
    if (!msgRow.rows.length) return err(res, 'Message not found', 404);

    // only sender or group admin can delete
    const group = await db.execute({ sql: 'SELECT created_by, admin_id FROM groups WHERE id = ?', args: [id] });
    const isAdmin = group.rows[0]?.created_by === user.sub || group.rows[0]?.admin_id === user.sub;
    if (msgRow.rows[0].from_user_id !== user.sub && !isAdmin) return err(res, 'Cannot delete this message', 403);

    await db.execute({
      sql: "UPDATE group_messages SET deleted = 1, body = 'This message was deleted' WHERE id = ?",
      args: [deleteMsg],
    });
    return ok(res, { message: 'Message deleted' });
  }

  // ── POST add member ──────────────────────────────────
  if (req.method === 'POST' && id && add) {
    const { userIdToAdd } = req.body || {};
    if (!userIdToAdd) return err(res, 'userIdToAdd required');

    const inGroup = await db.execute({
      sql: 'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      args: [id, user.sub],
    });
    if (!inGroup.rows.length) return err(res, 'Not a group member', 403);

    const shared = await db.execute({
      sql: `SELECT id FROM teams WHERE (user1_id=? AND user2_id=?) OR (user1_id=? AND user2_id=?)`,
      args: [user.sub, userIdToAdd, userIdToAdd, user.sub],
    });
    if (!shared.rows.length) return err(res, 'Can only add team members');

    try {
      await db.execute({
        sql: 'INSERT INTO group_members (id, group_id, user_id) VALUES (?, ?, ?)',
        args: [randomUUID(), id, userIdToAdd],
      });
      return ok(res, { message: 'Member added' });
    } catch(e) {
      if (e.message.includes('UNIQUE')) return err(res, 'Already a member');
      return err(res, e.message, 500);
    }
  }

  // ── DELETE remove member (admin only) ────────────────
  if (req.method === 'DELETE' && id && remove) {
    const group = await db.execute({ sql: 'SELECT created_by, admin_id FROM groups WHERE id = ?', args: [id] });
    const isAdmin = group.rows[0]?.created_by === user.sub || group.rows[0]?.admin_id === user.sub;
    if (!isAdmin) return err(res, 'Only admins can remove members', 403);
    if (remove === user.sub) return err(res, 'Cannot remove yourself. Use leave instead.');

    await db.execute({
      sql: 'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      args: [id, remove],
    });
    return ok(res, { message: 'Member removed' });
  }

  // ── DELETE leave group ───────────────────────────────
  if (req.method === 'DELETE' && id && leave) {
    await db.execute({
      sql: 'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      args: [id, user.sub],
    });
    const remaining = await db.execute({
      sql: 'SELECT COUNT(*) as n FROM group_members WHERE group_id = ?',
      args: [id],
    });
    if (!remaining.rows[0]?.n) {
      await db.execute({ sql: 'DELETE FROM groups WHERE id = ?', args: [id] });
    }
    return ok(res, { message: 'Left group' });
  }

  // ── PUT edit message ──────────────────────────────────
  if (req.method === 'PUT' && id && editMsg) {
    const { body } = req.body || {};
    if (!body?.trim()) return err(res, 'body required');

    const msgRow = await db.execute({
      sql: 'SELECT from_user_id FROM group_messages WHERE id = ? AND group_id = ? AND deleted = 0',
      args: [editMsg, id],
    });
    if (!msgRow.rows.length) return err(res, 'Message not found', 404);
    if (msgRow.rows[0].from_user_id !== user.sub) return err(res, 'Can only edit your own messages', 403);

    await db.execute({
      sql: 'UPDATE group_messages SET body = ? WHERE id = ?',
      args: [body.trim(), editMsg],
    });
    return ok(res, { message: 'Message updated', body: body.trim() });
  }

  return err(res, 'Method not allowed', 405);
};