// =============================================================================
// build.mjs — makes the minified copy of the demo, in dist/.
//
// The demo needs no build: index.html, js/ and static/ run as they are, and
// are meant to be read (every file starts with a plain-language explanation).
// This makes a second copy for publishing, with the comments and spaces taken
// out, which the browser loads faster. Run it with
//     npm install     (once: fetches esbuild, the minifier)
//     npm run build
// and upload what is in dist/.
//
// Each script is minified on its own, not bundled into one: the page loads
// them as separate modules (with the version in their addresses, see
// index.html), and the physics worker loads its own. The shaders are text
// inside the scripts (marked /* glsl */ or /* wgsl */): from them only the
// comments and the indentation are taken out, line by line, as their lines
// matter (#version must stay on a line of its own).
// =============================================================================

import { transform } from 'esbuild';
import { readFile, writeFile, mkdir, rm, readdir, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const TARGET = 'es2022';   // (top-level await, class fields: every current browser)

let before = 0, after = 0;
const note = (name, a, b) => {
  before += a; after += b;
  console.log(`${name.padEnd(28)} ${(a / 1024).toFixed(1).padStart(7)} kB → ${(b / 1024).toFixed(1).padStart(6)} kB`);
};

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'js'), { recursive: true });
await mkdir(join(dist, 'static'), { recursive: true });

// Shader text: no comments, no indentation, no empty lines. (Shaders have no
// strings, so // and /* always start a comment; ${...} parts are left alone.)
function squeezeShaders(code) {
  return code.replace(/\/\* (glsl|wgsl) \*\/ `([^`]*)`/g, (whole, kind, text) => {
    const pieces = text.split(/(\$\{[^}]*\})/);   // (the ${...} parts stay as they are)
    const squeezed = pieces.map((piece, i) => (i % 2 ? piece : piece
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/^ +| +$/gm, '')
      .replace(/\n+/g, '\n'))).join('');
    return `/* ${kind} */ \`${squeezed}\``;
  });
}

// The scripts.
for (const name of (await readdir(join(root, 'js'))).filter((n) => n.endsWith('.js')).sort()) {
  const code = await readFile(join(root, 'js', name), 'utf8');
  const out = await transform(squeezeShaders(code), { loader: 'js', format: 'esm', minify: true, target: TARGET, legalComments: 'none' });
  await writeFile(join(dist, 'js', name), out.code);
  note(`js/${name}`, Buffer.byteLength(code), Buffer.byteLength(out.code));
}

// The page: its style and its little script minified, its comments out.
let html = await readFile(join(root, 'index.html'), 'utf8');
const htmlBefore = Buffer.byteLength(html);
const replaceAsync = async (text, pattern, fn) => {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    parts.push(text.slice(last, m.index), await fn(m));
    last = m.index + m[0].length;
  }
  return parts.join('') + text.slice(last);
};
html = await replaceAsync(html, /<style>([\s\S]*?)<\/style>/g, async (m) =>
  `<style>${(await transform(m[1], { loader: 'css', minify: true })).code.trim()}</style>`);
html = await replaceAsync(html, /<script>([\s\S]*?)<\/script>/g, async (m) =>
  `<script>${(await transform(m[1], { loader: 'js', minify: true, target: TARGET })).code.trim()}</script>`);
html = html.replace(/<!--[\s\S]*?-->/g, '')          // comments
  .replace(/\n\s*\n/g, '\n')                          // empty lines
  .replace(/^\s+/gm, '');                             // indentation
await writeFile(join(dist, 'index.html'), html);
note('index.html', htmlBefore, Buffer.byteLength(html));

// Pictures, sounds and the font, as they are (but not the script that draws
// the icons).
for (const name of await readdir(join(root, 'static'))) {
  if (name.endsWith('.py')) continue;
  await copyFile(join(root, 'static', name), join(dist, 'static', name));
}

console.log(`${'all of it'.padEnd(28)} ${(before / 1024).toFixed(1).padStart(7)} kB → ${(after / 1024).toFixed(1).padStart(6)} kB`);
