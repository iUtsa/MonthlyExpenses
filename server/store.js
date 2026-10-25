// Data access for every user. Production uses Postgres (DATABASE_URL, e.g. Neon); locally and in
// tests the same SQL runs on PGlite, an embedded Postgres stored under DATA_DIR — no setup needed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createSeed, migrate } from './seed.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');

// Top-level keys of a user's data that the client may replace through PUT /api/state/:key.
export const KEYS = [
  'settings', 'categories', 'incomeSources', 'budgets', 'transactions', 'receipts',
  'rules', 'jobs', 'shifts', 'paystubs', 'bills', 'sinkingFunds', 'debts',
  'debtStrategy', 'netWorth', 'goals', 'reviews', 'investing',
];

const SCHEMA = `
create table if not exists users (
  id text primary key,
  email text unique not null,
  name text not null default '',
  password_hash text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user on sessions(user_id);
create table if not exists user_data (
  user_id text not null references users(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
create table if not exists files (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  kind text not null,
  mime text not null,
  name text not null default '',
  size integer not null,
  data bytea not null,
  created_at timestamptz not null default now()
);
create index if not exists files_user on files(user_id);
create table if not exists ai_usage (
  user_id text not null references users(id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);`;

let db = null;

// `options.memory` gives a throwaway in-memory database (tests).
export async function open(options = {}) {
  if (process.env.DATABASE_URL && !options.memory) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    db = { kind: 'postgres', query: (text, params) => pool.query(text, params), exec: (sql) => pool.query(sql), close: () => pool.end() };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    let lite;
    if (options.memory) lite = new PGlite();
    else {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      lite = new PGlite(path.join(DATA_DIR, 'pglite'));
    }
    db = { kind: 'pglite', query: (text, params) => lite.query(text, params), exec: (sql) => lite.exec(sql), close: () => lite.close() };
  }
  await db.exec(SCHEMA);
  return db;
}

export const close = () => db?.close();
export const kind = () => db?.kind;
const one = async (text, params) => (await db.query(text, params)).rows[0] || null;
const newId = (prefix) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;

/* ---------- Users ---------- */
export async function createUser({ email, name, passwordHash, isAdmin = false }) {
  const id = newId('usr');
  await db.query('insert into users (id, email, name, password_hash, is_admin) values ($1, $2, $3, $4, $5)', [id, email, name, passwordHash, isAdmin]);
  return { id, email, name, is_admin: isAdmin };
}
export const findUserByEmail = (email) => one('select * from users where email = $1', [email]);
export const getUser = (id) => one('select id, email, name, is_admin, created_at from users where id = $1', [id]);
export const countUsers = async () => Number((await one('select count(*)::int as n from users')).n);
export const setPassword = (id, passwordHash) => db.query('update users set password_hash = $2 where id = $1', [id, passwordHash]);
export const deleteUser = (id) => db.query('delete from users where id = $1', [id]);

/* ---------- Sessions ---------- */
export const createSession = (tokenHash, userId, expiresAt) => db.query('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [tokenHash, userId, expiresAt]);
export const getSession = (tokenHash) => one(
  `select s.token_hash, s.expires_at, u.id, u.email, u.name, u.is_admin
   from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()`, [tokenHash],
);
export const extendSession = (tokenHash, expiresAt) => db.query('update sessions set expires_at = $2 where token_hash = $1', [tokenHash, expiresAt]);
export const deleteSession = (tokenHash) => db.query('delete from sessions where token_hash = $1', [tokenHash]);
export const deleteUserSessions = (userId, exceptHash = '') => db.query('delete from sessions where user_id = $1 and token_hash <> $2', [userId, exceptHash]);
export const purgeExpiredSessions = () => db.query('delete from sessions where expires_at < now()');

/* ---------- Per-user data ---------- */
async function saveKeys(userId, data, keys) {
  for (const key of keys) {
    await db.query(
      `insert into user_data (user_id, key, value, updated_at) values ($1, $2, $3::jsonb, now())
       on conflict (user_id, key) do update set value = excluded.value, updated_at = now()`,
      [userId, key, JSON.stringify(data[key])],
    );
  }
}

// A user's whole state. New users start from the workbook defaults; older data is upgraded.
export async function getState(userId) {
  const rows = (await db.query('select key, value from user_data where user_id = $1', [userId])).rows;
  if (!rows.length) {
    const seed = createSeed();
    await saveKeys(userId, seed, [...KEYS, 'version']);
    return seed;
  }
  const data = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const before = data.version;
  migrate(data);
  const seed = createSeed();
  const missing = KEYS.filter((k) => data[k] === undefined);
  for (const k of missing) data[k] = seed[k];
  data.settings = { ...seed.settings, ...data.settings, tax: { ...seed.settings.tax, ...data.settings?.tax } };
  if (before !== data.version || missing.length) await saveKeys(userId, data, [...KEYS, 'version']);
  return data;
}

export async function setKey(userId, key, value) {
  if (!KEYS.includes(key)) throw Object.assign(new Error(`Unknown key: ${key}`), { status: 400 });
  await saveKeys(userId, { [key]: value }, [key]);
}

export async function replaceState(userId, next) {
  if (!next || typeof next !== 'object' || !next.settings || !Array.isArray(next.categories)) {
    throw Object.assign(new Error('Not a valid backup file'), { status: 400 });
  }
  migrate(next);
  const seed = createSeed();
  const data = { version: seed.version };
  for (const key of KEYS) data[key] = next[key] ?? seed[key];
  await saveKeys(userId, data, [...KEYS, 'version']);
}

export async function resetState(userId) {
  await db.query('delete from user_data where user_id = $1', [userId]);
  await db.query('delete from files where user_id = $1', [userId]);
}

/* ---------- Uploaded files ---------- */
export async function saveFile(userId, { kind: fileKind, mime, name, buffer }) {
  const id = newId('f');
  await db.query('insert into files (id, user_id, kind, mime, name, size, data) values ($1, $2, $3, $4, $5, $6, $7)', [id, userId, fileKind, mime, name, buffer.length, buffer]);
  return id;
}
export async function getFile(userId, id) {
  const row = await one('select mime, name, size, data from files where id = $1 and user_id = $2', [id, userId]);
  return row && { ...row, data: Buffer.from(row.data) };
}
export const deleteFile = (userId, id) => db.query('delete from files where id = $1 and user_id = $2', [id, userId]);
export const storageUsed = async (userId) => Number((await one('select coalesce(sum(size), 0)::bigint as n from files where user_id = $1', [userId])).n);

/* ---------- AI usage ---------- */
const utcDay = () => new Date().toISOString().slice(0, 10);
export async function bumpAiUsage(userId) {
  const row = await one(
    `insert into ai_usage (user_id, day, count) values ($1, $2, 1)
     on conflict (user_id, day) do update set count = ai_usage.count + 1 returning count`, [userId, utcDay()],
  );
  return Number(row.count);
}
export const aiUsageToday = async (userId) => Number((await one('select count from ai_usage where user_id = $1 and day = $2', [userId, utcDay()]))?.count || 0);
