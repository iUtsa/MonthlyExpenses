import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { loadEnv } from './env.js';
import * as db from './db.js';
import { aiStatus, parseReceipt, parseSchedule, parsePaystub } from './ai.js';
import { VENDOR_FILES } from './vendor.js';

loadEnv();
db.load();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = process.cwd();

const UPLOAD_KINDS = ['receipts', 'schedules', 'paystubs'];
const MIME_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'application/pdf': '.pdf', 'text/csv': '.csv', 'text/calendar': '.ics',
};

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const kind = UPLOAD_KINDS.includes(req.params.kind) ? req.params.kind : 'misc';
      const dir = path.join(db.UPLOAD_DIR, kind);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = MIME_EXT[file.mimetype] || path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
      cb(null, `${new Date().toISOString().slice(0, 10)}_${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 6 },
  fileFilter(req, file, cb) {
    cb(null, Boolean(MIME_EXT[file.mimetype]));
  },
});

app.use(express.json({ limit: '25mb' }));

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const today = () => new Date().toISOString().slice(0, 10);

// Resolve file references sent by the client ("/files/receipts/x.jpg") to disk paths,
// refusing anything outside the uploads directory.
function resolveUploads(refs = []) {
  return refs.map((ref) => {
    const rel = String(ref.url || '').replace(/^\/files\//, '');
    const filePath = path.resolve(db.UPLOAD_DIR, rel);
    if (!filePath.startsWith(db.UPLOAD_DIR + path.sep) || !fs.existsSync(filePath)) {
      throw Object.assign(new Error(`File not found: ${ref.url}`), { status: 400 });
    }
    return { filePath, mimeType: ref.type };
  });
}

app.get('/api/state', (req, res) => res.json(db.getAll()));

app.put('/api/state/:key', asyncRoute(async (req, res) => {
  await db.setKey(req.params.key, req.body);
  res.json({ ok: true });
}));

app.get('/api/ai/status', (req, res) => res.json(aiStatus()));

app.post('/api/upload/:kind', upload.array('files', 6), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No supported files were uploaded.' });
  res.json({
    files: req.files.map((f) => ({
      url: `/files/${path.relative(db.UPLOAD_DIR, f.path).split(path.sep).join('/')}`,
      type: f.mimetype,
      name: f.originalname,
      size: f.size,
    })),
  });
});

app.post('/api/ai/receipt', asyncRoute(async (req, res) => {
  const files = resolveUploads(req.body.files);
  res.json(await parseReceipt({ files, categories: db.getAll().categories, today: today() }));
}));

app.post('/api/ai/schedule', asyncRoute(async (req, res) => {
  const files = resolveUploads(req.body.files);
  res.json(await parseSchedule({ files, person: req.body.person || db.getAll().settings.schedulePerson, today: today() }));
}));

app.post('/api/ai/paystub', asyncRoute(async (req, res) => {
  const files = resolveUploads(req.body.files);
  res.json(await parsePaystub({ files, today: today() }));
}));

app.delete('/api/files', asyncRoute(async (req, res) => {
  for (const { filePath } of resolveUploads(req.body.files)) await fs.promises.unlink(filePath);
  res.json({ ok: true });
}));

app.get('/api/backup', (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="finance-backup-${today()}.json"`);
  res.json(db.getAll());
});

app.post('/api/restore', asyncRoute(async (req, res) => {
  await db.replaceAll(req.body);
  res.json({ ok: true });
}));

app.post('/api/reset', asyncRoute(async (req, res) => {
  if (req.body?.confirm !== 'RESET') return res.status(400).json({ error: 'Confirmation missing' });
  await db.reset();
  res.json({ ok: true });
}));

app.use('/files', express.static(db.UPLOAD_DIR, { fallthrough: false }));

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
  res.status(status).json({ error: err.message || 'Server error' });
});

app.listen(PORT, HOST, () => {
  const ai = aiStatus();
  console.log(`Finance manager running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Data file: ${path.join(db.DATA_DIR, 'db.json')}`);
  console.log(ai.enabled ? `AI document parsing: on (${ai.model})` : 'AI document parsing: off — add ANTHROPIC_API_KEY to .env (on-device OCR is used instead)');
});
