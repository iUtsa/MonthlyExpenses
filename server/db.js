// Single-file JSON store. The whole database lives in memory and is flushed to
// data/db.json with an atomic write (tmp file + rename) after every change.
import fs from 'node:fs';
import path from 'node:path';
import { createSeed, migrate } from './seed.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Top-level keys the client is allowed to replace through PUT /api/state/:key.
export const KEYS = [
  'settings', 'categories', 'incomeSources', 'budgets', 'transactions', 'receipts',
  'rules', 'jobs', 'shifts', 'paystubs', 'bills', 'sinkingFunds', 'debts',
  'debtStrategy', 'netWorth', 'goals', 'reviews', 'investing',
];

let data = null;
let writing = Promise.resolve();

function ensureDirs() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function load() {
  ensureDirs();
  if (fs.existsSync(DB_FILE)) {
    data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    // Upgrade older data first (it moves values between keys), then fill keys added later.
    migrate(data);
    const seed = createSeed();
    for (const key of KEYS) if (data[key] === undefined) data[key] = seed[key];
    data.settings = { ...seed.settings, ...data.settings, tax: { ...seed.settings.tax, ...data.settings?.tax } };
  } else {
    data = createSeed();
    flush();
  }
  return data;
}

function flush() {
  const snapshot = JSON.stringify(data, null, 1);
  writing = writing.then(async () => {
    const tmp = `${DB_FILE}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, DB_FILE);
  }).catch((err) => console.error('Failed to save database:', err));
  return writing;
}

export function getAll() {
  return data;
}

export function setKey(key, value) {
  if (!KEYS.includes(key)) throw Object.assign(new Error(`Unknown key: ${key}`), { status: 400 });
  data[key] = value;
  return flush();
}

export function replaceAll(next) {
  if (!next || typeof next !== 'object' || !next.settings || !Array.isArray(next.categories)) {
    throw Object.assign(new Error('Not a valid backup file'), { status: 400 });
  }
  migrate(next);
  const seed = createSeed();
  data = { version: seed.version };
  for (const key of KEYS) data[key] = next[key] ?? seed[key];
  return flush();
}

export function reset() {
  data = createSeed();
  return flush();
}
