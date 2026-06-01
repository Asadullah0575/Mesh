// api/_lib.js — shared helpers (CommonJS)

const { createClient } = require('@libsql/client');
const { SignJWT, jwtVerify } = require('jose');
const bcrypt = require('bcryptjs');

function getDB() {
  let url = process.env.TURSO_DATABASE_URL || '';
  // Use libsql:// protocol — https:// causes schema changes not to persist
  if (url.startsWith('https://')) url = url.replace('https://', 'libsql://');
  if (!url.startsWith('libsql://')) url = 'libsql://' + url;
  return createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

const secret = () => Buffer.from(process.env.JWT_SECRET || 'fallback-secret', 'utf-8');

async function signToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(await secret());
}

async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, await secret());
    return payload;
  } catch {
    return null;
  }
}

function getToken(req) {
  const auth = req.headers['authorization'] || '';
  return auth.replace('Bearer ', '').trim() || null;
}

const hashPassword    = (p) => bcrypt.hash(p, 10);
const comparePassword = (p, h) => bcrypt.compare(p, h);

function ok(res, data, status = 200) {
  res.status(status).json({ ok: true, ...data });
}

function err(res, message, status = 400) {
  res.status(status).json({ ok: false, error: message });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

module.exports = { getDB, signToken, verifyToken, getToken, hashPassword, comparePassword, ok, err, cors };