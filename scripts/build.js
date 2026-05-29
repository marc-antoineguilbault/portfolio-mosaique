// Build pipeline pour GitHub Pages :
// 1. Minif app.js (esbuild bundle + minify, garde data.js inline) → dist/app.js
// 2. Minif styles.css (esbuild minify only) → dist/styles.css
// 3. Copy index.html, sw.js, favicon.svg, assets/ vers dist/
//
// Le contenu dist/ est ensuite uploadé comme artifact GitHub Pages.

import { build } from 'esbuild';
import { cp, mkdir, rm, stat, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DIST = 'dist';

async function clean() {
  if (existsSync(DIST)) await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
}

async function buildJs() {
  await build({
    entryPoints: ['app.js'],
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['es2020'],
    outfile: `${DIST}/app.js`,
    legalComments: 'none',
  });
}

async function buildCss() {
  await build({
    entryPoints: ['styles.css'],
    minify: true,
    outfile: `${DIST}/styles.css`,
    loader: { '.css': 'css' },
  });
}

async function hashFile(path) {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex').slice(0, 10);
}

async function copyStatic() {
  // index.html : remplace les cache-busters ?v=NN par un hash du CONTENU bundlé
  // (app.js / styles.css). Le service worker sert les assets versionnés en
  // cache-first ; un hash garantit qu'un changement de contenu change l'URL,
  // donc invalide le cache (plus de bump manuel oubliable de ?v=).
  const jsHash = await hashFile(`${DIST}/app.js`);
  const cssHash = await hashFile(`${DIST}/styles.css`);
  const html = (await readFile('index.html', 'utf8'))
    .replace(/app\.js\?v=[^"']*/g, `app.js?v=${jsHash}`)
    .replace(/styles\.css\?v=[^"']*/g, `styles.css?v=${cssHash}`);
  await writeFile(`${DIST}/index.html`, html);
  console.log(`cache-bust : app.js?v=${jsHash}  styles.css?v=${cssHash}`);

  await cp('favicon.svg', `${DIST}/favicon.svg`);
  await cp('sw.js', `${DIST}/sw.js`);
  await cp('CNAME', `${DIST}/CNAME`);
  await cp('assets', `${DIST}/assets`, { recursive: true });
}

async function reportSizes() {
  const before = {
    js: (await stat('app.js')).size,
    css: (await stat('styles.css')).size,
  };
  const after = {
    js: (await stat(`${DIST}/app.js`)).size,
    css: (await stat(`${DIST}/styles.css`)).size,
  };
  const pct = (a, b) => Math.round((a / b) * 100);
  console.log(`app.js   : ${before.js} → ${after.js} bytes (${pct(after.js, before.js)}%)`);
  console.log(`styles.css : ${before.css} → ${after.css} bytes (${pct(after.css, before.css)}%)`);
}

await clean();
await buildJs();
await buildCss();
await copyStatic();
await reportSizes();
console.log(`Build → ${DIST}/`);
