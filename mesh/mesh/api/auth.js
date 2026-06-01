// api/auth.js (CommonJS)
// POST /api/auth?action=signup|signin|forgot|reset

const { getDB, signToken, hashPassword, comparePassword, cors, ok, err } = require('./_lib');
const { randomUUID } = require('crypto');

async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'MESH <onboarding@resend.dev>', to: [to], subject, html }),
    });
  } catch (e) { console.error('Email error:', e.message); }
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);

  const { action } = req.query;
  const body = req.body || {};
  const db = getDB();

  // ── SIGN UP ──────────────────────────────────────────
  if (action === 'signup') {
    const { email, password } = body;
    if (!email || !password) return err(res, 'Email and password required');
    if (password.length < 6) return err(res, 'Password must be at least 6 characters');

    const existing = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email.toLowerCase()] });
    if (existing.rows.length) return err(res, 'Email already in use');

    const id = randomUUID();
    await db.execute({ sql: 'INSERT INTO users (id, email, password) VALUES (?, ?, ?)', args: [id, email.toLowerCase(), await hashPassword(password)] });
    const token = await signToken({ sub: id, email: email.toLowerCase(), isAdmin: false });
    return ok(res, { token, user: { id, email: email.toLowerCase(), isAdmin: false } }, 201);
  }

  // ── SIGN IN ──────────────────────────────────────────
  if (action === 'signin') {
    const { email, password } = body;
    if (!email || !password) return err(res, 'Email and password required');

    const result = await db.execute({ sql: 'SELECT id, email, password, is_admin, is_banned FROM users WHERE email = ?', args: [email.toLowerCase()] });
    if (!result.rows.length) return err(res, 'Invalid email or password', 401);

    const user = result.rows[0];
    if (user.is_banned) return err(res, 'This account has been suspended. Contact support.', 403);
    if (!await comparePassword(password, user.password)) return err(res, 'Invalid email or password', 401);

    const token = await signToken({ sub: user.id, email: user.email, isAdmin: !!user.is_admin });
    return ok(res, { token, user: { id: user.id, email: user.email, isAdmin: !!user.is_admin } });
  }

  // ── FORGOT PASSWORD ──────────────────────────────────
  if (action === 'forgot') {
    const { email } = body;
    if (!email) return err(res, 'Email required');

    const result = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email.toLowerCase()] });
    // always return ok to avoid email enumeration
    if (!result.rows.length) return ok(res, { message: 'If that email exists, a reset link has been sent.' });

    const resetToken = randomUUID();
    const expiry = new Date(Date.now() + 3600000).toISOString(); // 1 hour

    await db.execute({
      sql: 'UPDATE users SET reset_token = ?, reset_expiry = ? WHERE email = ?',
      args: [resetToken, expiry, email.toLowerCase()],
    });

    const resetUrl = `${process.env.APP_URL || 'https://mesh-amber.vercel.app/'}/reset-password.html?token=${resetToken}`;

    await sendEmail(email, 'Reset your MESH password', `
      <div style="font-family:'IBM Plex Sans',sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0f0f11;color:#f4f2ee;border-radius:8px">
        <div style="font-family:monospace;font-weight:700;font-size:16px;color:#f4f2ee;margin-bottom:24px">
          MES<span style="color:#E8C547">H</span>
        </div>
        <h2 style="font-size:20px;font-weight:600;margin-bottom:12px">Reset your password</h2>
        <p style="color:#7a7870;font-size:14px;line-height:1.6;margin-bottom:24px">
          Click the button below to reset your password. This link expires in 1 hour.
        </p>
        <a href="${resetUrl}" style="display:inline-block;background:#d4f53c;color:#0a0a0a;font-family:monospace;font-weight:700;font-size:12px;letter-spacing:0.04em;padding:10px 20px;border-radius:4px;text-decoration:none">
          RESET PASSWORD →
        </a>
        <p style="color:#3a3835;font-size:11px;margin-top:32px">If you didn't request this, ignore this email.</p>
      </div>
    `);

    return ok(res, { message: 'If that email exists, a reset link has been sent.' });
  }

  // ── RESET PASSWORD ───────────────────────────────────
  if (action === 'reset') {
    const { token, password } = body;
    if (!token || !password) return err(res, 'Token and password required');
    if (password.length < 6) return err(res, 'Password must be at least 6 characters');

    const result = await db.execute({
      sql: 'SELECT id, reset_expiry FROM users WHERE reset_token = ?',
      args: [token],
    });
    if (!result.rows.length) return err(res, 'Invalid or expired reset link', 400);

    const user = result.rows[0];
    if (new Date(user.reset_expiry) < new Date()) return err(res, 'Reset link has expired', 400);

    await db.execute({
      sql: 'UPDATE users SET password = ?, reset_token = NULL, reset_expiry = NULL WHERE id = ?',
      args: [await hashPassword(password), user.id],
    });

    return ok(res, { message: 'Password reset successfully. You can now sign in.' });
  }

  return err(res, 'Unknown action');
};