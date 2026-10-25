// Server-side document reading. Prompts, schemas and response handling live in
// public/js/ai-core.js so the browser-only build behaves the same way.
// Provider: NVIDIA when NVIDIA_API_KEY is set, otherwise Anthropic when ANTHROPIC_API_KEY is set.
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import {
  AIError, DEFAULT_MODEL, DEFAULT_EFFORT, NVIDIA_MODELS, extract, extractNvidia, fileBlock,
  receiptRequest, scheduleRequest, paystubRequest, mergeScheduleReads,
} from '../public/js/ai-core.js';
import { personMatches } from '../public/js/parse.js';
import { DATA_DIR } from './store.js';

export { AIError };

// Schedule passes, e.g. SCHEDULE_PASSES="think:0.1,fast:0.3" (think = reasoning on).
const schedulePasses = () => (process.env.SCHEDULE_PASSES || 'think:0.1,fast:0.3,fast:0.1').split(',').map((p) => {
  const [mode, t] = p.trim().split(':');
  return { label: p.trim(), thinking: mode === 'think', temperature: Number(t) || 0.1 };
});
const nvidiaModels = () => (process.env.NVIDIA_MODEL ? process.env.NVIDIA_MODEL.split(',').map((m) => m.trim()) : NVIDIA_MODELS);

let client = null;
function getClient() {
  client ??= new Anthropic();
  return client;
}

export function aiStatus() {
  if (process.env.NVIDIA_API_KEY) return { enabled: true, provider: 'nvidia', model: nvidiaModels()[0], mode: 'server' };
  const enabled = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.AI_ENABLED === 'true');
  return { enabled, provider: 'anthropic', model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL, mode: 'server' };
}

// files: [{ buffer, mimeType, name }] loaded from the user's uploads.
const blocksFrom = (files) => files.map(({ buffer, mimeType, name }) => fileBlock({ mimeType, base64: buffer.toString('base64'), name }));

function run(request) {
  const status = aiStatus();
  if (!status.enabled) throw new AIError('AI parsing is not configured. Add NVIDIA_API_KEY (or ANTHROPIC_API_KEY) to .env.', 501);
  if (status.provider === 'nvidia') return extractNvidia({ apiKey: process.env.NVIDIA_API_KEY, models: nvidiaModels(), ...request });
  return extract({ Anthropic, client: getClient(), model: status.model, effort: process.env.ANTHROPIC_EFFORT || DEFAULT_EFFORT, ...request });
}

export const parseReceipt = ({ files, categories, today }) => run(receiptRequest({ blocks: blocksFrom(files), categories, today }));
// OCR text is handed to the vision models as a cross-check for small or tilted text.
let ocrWorker = null;
async function ocrText(files) {
  if (process.env.OCR_HINT === 'off') return '';
  try {
    if (!ocrWorker) {
      const { createWorker } = await import('tesseract.js');
      const cachePath = path.join(DATA_DIR, 'ocr-cache');
      fs.mkdirSync(cachePath, { recursive: true });
      ocrWorker = createWorker('eng', 1, { cachePath });
    }
    const worker = await ocrWorker;
    let text = '';
    for (const f of files.filter((x) => x.mimeType.startsWith('image/'))) text += (await worker.recognize(f.buffer)).data.text + '\n';
    return text.trim();
  } catch (err) {
    console.warn('OCR hint skipped:', err.message);
    ocrWorker = null;
    return '';
  }
}

// Schedules: every reader transcribes the whole roster independently, the readings are
// merged (agreement = votes), and shifts matching the user's names are flagged `mine`.
export async function parseSchedule({ files, aliases = [], today, debug = false }) {
  const status = aiStatus();
  if (!status.enabled) throw new AIError('AI parsing is not configured. Add NVIDIA_API_KEY (or ANTHROPIC_API_KEY) to .env.', 501);
  const request = scheduleRequest({ blocks: blocksFrom(files), today, ocrText: await ocrText(files) });
  let reads;
  if (status.provider === 'nvidia') {
    // Two independent passes of the strongest model (different sampling) catch what a single
    // pass misses; weaker models only step in if both passes fail.
    const [primary, ...fallbacks] = nvidiaModels();
    const key = process.env.NVIDIA_API_KEY;
    const pass = async ({ label, temperature, thinking }) => {
      const t0 = Date.now();
      try {
        return { ...(await extractNvidia({ apiKey: key, models: [primary], temperature, thinking, ...request })), _pass: label, _ms: Date.now() - t0 };
      } catch (err) {
        console.warn(`Schedule pass ${label} failed after ${Date.now() - t0}ms: ${err.message}`);
        return null;
      }
    };
    // All passes run together. The reasoning passes are the accurate ones, so we always wait for
    // one of them; after the first finishes, the others get a 45-second grace period.
    reads = await new Promise((resolve) => {
      const passes = schedulePasses();
      const results = [];
      let pendingThink = passes.filter((p) => p.thinking).length;
      let pendingAll = passes.length;
      let timer = null;
      const finish = () => { clearTimeout(timer); resolve(results.filter(Boolean)); };
      for (const p of passes) {
        pass(p).then((r) => {
          results.push(r);
          pendingAll--;
          if (p.thinking) pendingThink--;
          if (pendingAll === 0) return finish();
          const thinkDone = results.some((x) => x && x._pass.startsWith('think'));
          if (thinkDone && !timer) timer = setTimeout(finish, 45000);
          if (pendingThink === 0 && !thinkDone && !timer) timer = setTimeout(finish, 45000); // every reasoning pass failed
        });
      }
    });
    if (!reads.length) {
      const retry = await pass({ label: 'retry:0.1', temperature: 0.1, thinking: false });
      if (retry) reads = [retry];
    }
    if (!reads.length && fallbacks.length) reads = [{ ...(await extractNvidia({ apiKey: key, models: fallbacks, ...request })), _pass: 'fallback' }];
  } else {
    reads = [await run(request)];
  }
  const merged = mergeScheduleReads(reads);
  const solo = merged.people.length <= 1;
  for (const s of merged.shifts) s.mine = solo || !s.person || personMatches(s.person, aliases);
  if (debug) merged.reads = reads;
  return merged;
}

export const parsePaystub = ({ files, today }) => run(paystubRequest({ blocks: blocksFrom(files), today }));
