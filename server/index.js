import { loadEnv } from './env.js';

loadEnv();

const store = await import('./store.js');
const { createApp } = await import('./app.js');
const { aiStatus } = await import('./ai.js');

await store.open();
await store.purgeExpiredSessions();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

createApp().listen(PORT, HOST, () => {
  const ai = aiStatus();
  console.log(`Finance manager running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Database: ${store.kind() === 'postgres' ? 'Postgres (DATABASE_URL)' : `embedded (${store.DATA_DIR}/pglite)`}`);
  console.log(ai.enabled ? `AI document parsing: on (${ai.model})` : 'AI document parsing: off — add NVIDIA_API_KEY to .env (on-device OCR is used instead)');
});
