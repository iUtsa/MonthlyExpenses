// Accounts: scrypt password hashes, random session tokens (only their SHA-256 is stored),
// HttpOnly SameSite=Lax cookies, login rate limiting and a same-origin check on writes.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import * as store from './store.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 30;
const COOKIE = 'sid';
const N = 16384; const R = 8; const P = 1; const KEYLEN = 64;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [algo, n, r, p, salt, hash] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use at least 8 characters for your password.';
  if (pw.length > 200) return 'That password is too long.';
  return null;
}

function cookieHeader(req, value, maxAge) {
  const secure = req.secure ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readCookie(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

export async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await store.createSession(sha256(token), userId, new Date(Date.now() + SESSION_DAYS * 86400000));
  res.setHeader('Set-Cookie', cookieHeader(req, token, SESSION_DAYS * 86400));
  return sha256(token);
}

export async function endSession(req, res) {
  const token = readCookie(req);
  if (token) await store.deleteSession(sha256(token));
  res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
}

// Attaches req.user (or null). Sessions slide: used within 15 days of expiry → renewed.
export async function loadUser(req, res, next) {
  req.user = null;
  try {
    const token = readCookie(req);
    if (token) {
      const tokenHash = sha256(token);
      const row = await store.getSession(tokenHash);
      if (row) {
        req.user = { id: row.id, email: row.email, name: row.name, isAdmin: row.is_admin };
        req.sessionHash = tokenHash;
        if (new Date(row.expires_at) - Date.now() < 15 * 86400000) {
          await store.extendSession(tokenHash, new Date(Date.now() + SESSION_DAYS * 86400000));
          res.setHeader('Set-Cookie', cookieHeader(req, token, SESSION_DAYS * 86400));
        }
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

// Writes must come from this site (SameSite cookies already block most cross-site requests).
export function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request blocked.' });
    } catch {
      return res.status(403).json({ error: 'Bad origin.' });
    }
  }
  next();
}

// Simple in-memory sliding-window limiter, keyed per IP and per email.
const hits = new Map();
export function tooMany(key, limit, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 10000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return list.length > limit;
}
