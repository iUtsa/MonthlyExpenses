import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.ALLOW_SIGNUP = 'true';
process.env.AI_DAILY_LIMIT = '1';
process.env.NVIDIA_API_KEY = 'test-key-not-used';
process.env.OCR_HINT = 'off';
delete process.env.ADMIN_EMAIL;
delete process.env.DATABASE_URL;

const store = await import('../server/store.js');
const { createApp } = await import('../server/app.js');

let server; let base;
before(async () => {
  await store.open({ memory: true });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await store.close(); });

// Minimal cookie-keeping client.
function client() {
  let cookie = '';
  return async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.arrayBuffer(), headers: res.headers };
  };
}

const alice = client(); const bob = client(); const anon = client();

test('health is public; data needs sign-in', async () => {
  assert.equal((await anon('/api/health')).data.mode, 'server');
  assert.equal((await anon('/api/state')).status, 401);
});

test('sign-up validates input and the first user becomes admin', async () => {
  assert.equal((await anon('/api/auth/signup', { method: 'POST', body: { email: 'bad', password: 'longenough' } })).status, 400);
  assert.equal((await anon('/api/auth/signup', { method: 'POST', body: { email: 'a@x.com', password: 'short' } })).status, 400);
  const r = await alice('/api/auth/signup', { method: 'POST', body: { email: 'Alice@X.com', password: 'correct horse', name: 'Alice' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.isAdmin, true);
  assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal((await anon('/api/auth/signup', { method: 'POST', body: { email: 'alice@x.com', password: 'another one' } })).status, 409);
  const b = await bob('/api/auth/signup', { method: 'POST', body: { email: 'bob@x.com', password: 'bob password' } });
  assert.equal(b.data.user.isAdmin, false);
});

test('each user only sees their own data', async () => {
  const a = await alice('/api/state');
  assert.equal(a.status, 200);
  assert.ok(Array.isArray(a.data.categories));
  await alice('/api/state/goals', { method: 'PUT', body: [{ id: 'g1', name: 'Alice secret goal' }] });
  const b = await bob('/api/state');
  assert.ok(!JSON.stringify(b.data.goals).includes('Alice secret goal'));
  assert.equal((await alice('/api/state')).data.goals[0].name, 'Alice secret goal');
  assert.equal((await alice('/api/state/passwords', { method: 'PUT', body: {} })).status, 400);
});

test('uploaded files are private to their owner', async () => {
  const fd = new FormData();
  fd.append('files', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'r.png');
  const up = await alice('/api/upload/receipts', { method: 'POST', body: fd });
  assert.equal(up.status, 200);
  const url = up.data.files[0].url;
  assert.match(url, /^files\/f_/);
  assert.equal((await alice(`/${url}`)).status, 200);
  assert.equal((await bob(`/${url}`)).status, 404);
  assert.equal((await anon(`/${url}`)).status, 401);
});

test('AI reads are capped per day for non-admins', async () => {
  const body = { files: [{ url: 'files/does-not-exist' }] };
  assert.equal((await bob('/api/ai/receipt', { method: 'POST', body })).status, 404); // read 1 of 1 (file missing)
  const second = await bob('/api/ai/receipt', { method: 'POST', body });
  assert.equal(second.status, 429);
  assert.match(second.data.error, /today's 1 AI reads/);
  assert.equal((await alice('/api/ai/receipt', { method: 'POST', body })).status, 404); // admin: no cap
  assert.equal((await bob('/api/ai/status')).data.used, 2);
});

test('cross-site writes are rejected', async () => {
  const r = await alice('/api/state/goals', { method: 'PUT', body: [], headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

test('wrong password is rejected; logout ends the session', async () => {
  const c = client();
  assert.equal((await c('/api/auth/login', { method: 'POST', body: { email: 'bob@x.com', password: 'nope nope' } })).status, 401);
  assert.equal((await c('/api/auth/login', { method: 'POST', body: { email: 'BOB@x.com', password: 'bob password' } })).status, 200);
  assert.equal((await c('/api/state')).status, 200);
  await c('/api/auth/logout', { method: 'POST' });
  assert.equal((await c('/api/state')).status, 401);
});

test('changing password signs out other devices; deleting an account removes everything', async () => {
  const other = client();
  await other('/api/auth/login', { method: 'POST', body: { email: 'bob@x.com', password: 'bob password' } });
  assert.equal((await bob('/api/auth/password', { method: 'POST', body: { current: 'bob password', next: 'new bob password' } })).status, 200);
  assert.equal((await other('/api/state')).status, 401);
  assert.equal((await bob('/api/state')).status, 200);
  assert.equal((await bob('/api/auth/delete', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  assert.equal((await bob('/api/auth/delete', { method: 'POST', body: { password: 'new bob password' } })).status, 200);
  assert.equal((await client()('/api/auth/login', { method: 'POST', body: { email: 'bob@x.com', password: 'new bob password' } })).status, 401);
});
