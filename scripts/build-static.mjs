// Builds the browser-only version of the site into dist/ for GitHub Pages:
// the public/ folder, the vendored libraries, and a browser bundle of the Anthropic SDK.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { VENDOR_FILES } from '../server/vendor.js';

const OUT = 'dist';
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync('public', OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });
for (const [name, src] of Object.entries(VENDOR_FILES)) fs.copyFileSync(src, path.join(OUT, 'vendor', name));

await build({
  stdin: { contents: "export { default } from '@anthropic-ai/sdk';", resolveDir: process.cwd(), loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  outfile: path.join(OUT, 'vendor', 'anthropic-sdk.mjs'),
  logLevel: 'warning',
});

fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
// Answers the app's server probe so it switches to browser storage without a 404 in the console.
fs.mkdirSync(path.join(OUT, 'api', 'ai'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'api', 'ai', 'status'), JSON.stringify({ mode: 'browser' }));
const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`Static site built in ${OUT}/ (${(size(OUT) / 1e6).toFixed(1)} MB)`);
