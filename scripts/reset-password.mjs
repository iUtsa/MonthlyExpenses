// Site-owner tool: set a new password for an account (there is no email-based reset).
// Usage: node scripts/reset-password.mjs someone@example.com "new password"
//   (uses DATABASE_URL from .env / the environment, or the local embedded database)
import { loadEnv } from '../server/env.js';

loadEnv();
const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node scripts/reset-password.mjs <email> "<new password>"');
  process.exit(1);
}
const store = await import('../server/store.js');
const { hashPassword, normalizeEmail, passwordProblem } = await import('../server/auth.js');
const problem = passwordProblem(password);
if (problem) { console.error(problem); process.exit(1); }
await store.open();
const user = await store.findUserByEmail(normalizeEmail(email));
if (!user) { console.error(`No account for ${email}`); process.exit(1); }
await store.setPassword(user.id, await hashPassword(password));
await store.deleteUserSessions(user.id);
console.log(`Password reset for ${user.email}. They've been signed out everywhere.`);
await store.close();
