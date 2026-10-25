import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import multer from 'multer';
import * as store from './store.js';
import {
  hashPassword, verifyPassword, normalizeEmail, validEmail, passwordProblem,
  startSession, endSession, loadUser, requireUser, sameOrigin, tooMany,
} from './auth.js';
import { aiStatus, parseReceipt, parseSchedule, parsePaystub } from './ai.js';
import { VENDOR_FILES } from './vendor.js';

const ROOT = process.cwd();
const MIME_OK = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/csv', 'text/calendar']);
const UPLOAD_KINDS = ['receipts', 'schedules', 'paystubs'];
const today = () => new Date().toISOString().slice(0, 10);
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (status, message) => Object.assign(new Error(message), { status });

const config = () => ({
  allowSignup: process.env.ALLOW_SIGNUP !== 'false',
  adminEmail: normalizeEmail(process.env.ADMIN_EMAIL || ''),
  aiDailyLimit: Number(process.env.AI_DAILY_LIMIT || 25),
  storageMb: Number(process.env.USER_STORAGE_MB || 100),
});

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Render's HTTPS proxy: req.secure → Secure cookies
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });
  app.use(express.json({ limit: '25mb' }));
  app.use(loadUser);
  app.use('/api', sameOrigin);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 6 },
    fileFilter: (req, file, cb) => cb(null, MIME_OK.has(file.mimetype)),
  });

  /* ---------- Public ---------- */
  app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'server', signup: config().allowSignup }));

  app.post('/api/auth/signup', asyncRoute(async (req, res) => {
    if (!config().allowSignup) throw fail(403, 'Sign-up is closed on this site.');
    if (tooMany(`signup:${req.ip}`, 10, 60 * 60 * 1000)) throw fail(429, 'Too many sign-ups from this network. Try again later.');
    const email = normalizeEmail(req.body.email);
    const name = String(req.body.name || '').trim().slice(0, 80);
    if (!validEmail(email)) throw fail(400, 'Enter a valid email address.');
    const problem = passwordProblem(req.body.password);
    if (problem) throw fail(400, problem);
    if (await store.findUserByEmail(email)) throw fail(409, 'An account with that email already exists. Sign in instead.');
    const firstUser = (await store.countUsers()) === 0;
    const { adminEmail } = config();
    const user = await store.createUser({ email, name, passwordHash: await hashPassword(req.body.password), isAdmin: adminEmail ? email === adminEmail : firstUser });
    if (firstUser) await adoptLegacyData(user.id);
    await startSession(req, res, user.id);
    res.status(201).json({ user: { email, name, isAdmin: user.is_admin } });
  }));

  app.post('/api/auth/login', asyncRoute(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (tooMany(`login-ip:${req.ip}`, 30, 15 * 60 * 1000) || tooMany(`login:${email}`, 10, 15 * 60 * 1000)) {
      throw fail(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
    }
    const user = await store.findUserByEmail(email);
    const ok = user && await verifyPassword(String(req.body.password || ''), user.password_hash);
    if (!ok) throw fail(401, 'Email or password is incorrect.');
    await startSession(req, res, user.id);
    res.json({ user: { email: user.email, name: user.name, isAdmin: user.is_admin } });
  }));

  app.post('/api/auth/logout', asyncRoute(async (req, res) => {
    await endSession(req, res);
    res.json({ ok: true });
  }));

  /* ---------- Everything below needs a signed-in user ---------- */
  app.use('/api', requireUser);

  const aiInfo = async (user) => {
    const status = aiStatus();
    const unlimited = user.isAdmin || !status.enabled;
    return { ...status, mode: 'server', limit: unlimited ? null : config().aiDailyLimit, used: await store.aiUsageToday(user.id) };
  };

  app.get('/api/auth/me', asyncRoute(async (req, res) => {
    res.json({ user: { email: req.user.email, name: req.user.name, isAdmin: req.user.isAdmin }, ai: await aiInfo(req.user) });
  }));

  app.post('/api/auth/password', asyncRoute(async (req, res) => {
    const user = await store.findUserByEmail(req.user.email);
    if (!(await verifyPassword(String(req.body.current || ''), user.password_hash))) throw fail(401, 'Current password is incorrect.');
    const problem = passwordProblem(req.body.next);
    if (problem) throw fail(400, problem);
    await store.setPassword(user.id, await hashPassword(req.body.next));
    await store.deleteUserSessions(user.id, req.sessionHash); // sign out other devices
    res.json({ ok: true });
  }));

  app.post('/api/auth/delete', asyncRoute(async (req, res) => {
    const user = await store.findUserByEmail(req.user.email);
    if (!(await verifyPassword(String(req.body.password || ''), user.password_hash))) throw fail(401, 'Password is incorrect.');
    await store.deleteUser(user.id); // cascades to sessions, data, files, usage
    res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ ok: true });
  }));

  app.get('/api/state', asyncRoute(async (req, res) => res.json(await store.getState(req.user.id))));
  app.put('/api/state/:key', asyncRoute(async (req, res) => {
    await store.setKey(req.user.id, req.params.key, req.body);
    res.json({ ok: true });
  }));

  app.get('/api/ai/status', asyncRoute(async (req, res) => res.json(await aiInfo(req.user))));

  app.post('/api/upload/:kind', upload.array('files', 6), asyncRoute(async (req, res) => {
    if (!req.files?.length) throw fail(400, 'No supported files were uploaded.');
    const incoming = req.files.reduce((a, f) => a + f.size, 0);
    if ((await store.storageUsed(req.user.id)) + incoming > config().storageMb * 1024 * 1024) {
      throw fail(413, `Your ${config().storageMb} MB upload space is full. Delete old receipts to free space.`);
    }
    const kind = UPLOAD_KINDS.includes(req.params.kind) ? req.params.kind : 'misc';
    const files = [];
    for (const f of req.files) {
      const id = await store.saveFile(req.user.id, { kind, mime: f.mimetype, name: f.originalname.slice(0, 200), buffer: f.buffer });
      files.push({ url: `files/${id}`, type: f.mimetype, name: f.originalname, size: f.size });
    }
    res.json({ files });
  }));

  // Resolve client file references ("files/<id>") to the signed-in user's stored files.
  async function loadFiles(req) {
    const refs = Array.isArray(req.body.files) ? req.body.files.slice(0, 6) : [];
    if (!refs.length) throw fail(400, 'No files given.');
    return Promise.all(refs.map(async (ref) => {
      const id = String(ref.url || '').replace(/^\/?files\//, '');
      const file = await store.getFile(req.user.id, id);
      if (!file) throw fail(404, 'File not found.');
      return { buffer: file.data, mimeType: file.mime, name: file.name };
    }));
  }

  // Shared NVIDIA key: each user gets AI_DAILY_LIMIT reads per day (admins unlimited).
  const aiQuota = asyncRoute(async (req, res, next) => {
    if (aiStatus().enabled && !req.user.isAdmin) {
      const used = await store.bumpAiUsage(req.user.id);
      if (used > config().aiDailyLimit) throw fail(429, `You've used today's ${config().aiDailyLimit} AI reads. On-device reading still works, and the limit resets at midnight UTC.`);
    }
    next();
  });

  app.post('/api/ai/receipt', aiQuota, asyncRoute(async (req, res) => {
    const files = await loadFiles(req);
    const { categories } = await store.getState(req.user.id);
    res.json(await parseReceipt({ files, categories, today: today() }));
  }));
  app.post('/api/ai/schedule', aiQuota, asyncRoute(async (req, res) => {
    const files = await loadFiles(req);
    const { settings } = await store.getState(req.user.id);
    const aliases = Array.isArray(req.body.aliases) ? req.body.aliases : [settings.schedulePerson, ...(settings.scheduleAliases || [])].filter(Boolean);
    res.json(await parseSchedule({ files, aliases, today: today(), debug: Boolean(req.body.debug) && req.user.isAdmin }));
  }));
  app.post('/api/ai/paystub', aiQuota, asyncRoute(async (req, res) => {
    res.json(await parsePaystub({ files: await loadFiles(req), today: today() }));
  }));

  app.delete('/api/files', asyncRoute(async (req, res) => {
    for (const ref of (req.body.files || []).slice(0, 50)) await store.deleteFile(req.user.id, String(ref.url || '').replace(/^\/?files\//, ''));
    res.json({ ok: true });
  }));

  app.post('/api/restore', asyncRoute(async (req, res) => {
    await store.replaceState(req.user.id, req.body);
    res.json({ ok: true });
  }));
  app.post('/api/reset', asyncRoute(async (req, res) => {
    if (req.body?.confirm !== 'RESET') throw fail(400, 'Confirmation missing');
    await store.resetState(req.user.id);
    res.json({ ok: true });
  }));

  // Uploaded files: only their owner can read them.
  app.get('/files/:id', asyncRoute(async (req, res) => {
    if (!req.user) return res.status(401).end();
    const file = await store.getFile(req.user.id, req.params.id);
    if (!file) return res.status(404).end();
    const type = file.mime.startsWith('image/') || file.mime === 'application/pdf' ? file.mime : 'text/plain; charset=utf-8';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Disposition', 'inline');
    res.end(file.data);
  }));

  app.get('/vendor/:file', (req, res) => {
    const rel = VENDOR_FILES[req.params.file];
    if (!rel) return res.sendStatus(404);
    res.sendFile(path.join(ROOT, rel), { maxAge: '7d' });
  });
  app.use(express.static(path.join(ROOT, 'public')));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server.' : err.message });
  });
  return app;
}

// Single-user data from before accounts existed (data/db.json) becomes the first account's data.
async function adoptLegacyData(userId) {
  const legacy = path.join(store.DATA_DIR, 'db.json');
  if (!fs.existsSync(legacy)) return;
  try {
    await store.replaceState(userId, JSON.parse(fs.readFileSync(legacy, 'utf8')));
    fs.renameSync(legacy, `${legacy}.imported`);
    console.log('Imported existing data into the first account.');
  } catch (err) {
    console.warn('Could not import data/db.json:', err.message);
  }
}
