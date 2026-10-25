// Server-side document reading. Prompts, schemas and response handling live in
// public/js/ai-core.js so the browser-only build behaves the same way.
// Provider: NVIDIA when NVIDIA_API_KEY is set, otherwise Anthropic when ANTHROPIC_API_KEY is set.
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import {
  AIError, DEFAULT_MODEL, DEFAULT_EFFORT, NVIDIA_MODELS, extract, extractNvidia, fileBlock,
  receiptRequest, scheduleRequest, paystubRequest,
} from '../public/js/ai-core.js';

export { AIError };

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

const blocksFrom = (files) => files.map(({ filePath, mimeType }) => fileBlock({
  mimeType, base64: fs.readFileSync(filePath).toString('base64'), name: path.basename(filePath),
}));

function run(request) {
  const status = aiStatus();
  if (!status.enabled) throw new AIError('AI parsing is not configured. Add NVIDIA_API_KEY (or ANTHROPIC_API_KEY) to .env.', 501);
  if (status.provider === 'nvidia') return extractNvidia({ apiKey: process.env.NVIDIA_API_KEY, models: nvidiaModels(), ...request });
  return extract({ Anthropic, client: getClient(), model: status.model, effort: process.env.ANTHROPIC_EFFORT || DEFAULT_EFFORT, ...request });
}

export const parseReceipt = ({ files, categories, today }) => run(receiptRequest({ blocks: blocksFrom(files), categories, today }));
export const parseSchedule = ({ files, person, today }) => run(scheduleRequest({ blocks: blocksFrom(files), person, today }));
export const parsePaystub = ({ files, today }) => run(paystubRequest({ blocks: blocksFrom(files), today }));
