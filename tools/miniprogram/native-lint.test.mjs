// Static WXML/WXSS/JSON checks. These catch the errors WeChat DevTools would report at compile
// time (unclosed tags, undeclared components, missing handlers, bad wx:key), but they are NOT a
// replacement for compiling in DevTools or running on a device.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = path.join(root, 'miniprogram/src');
const build = path.join(root, 'miniprogram/build');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

const BUILTIN = new Set([
  'block','template','import','include','wxs','slot',
  'view','text','image','button','icon','progress','rich-text','navigator','camera','canvas','map','video','audio','live-player','live-pusher',
  'scroll-view','swiper','swiper-item','movable-area','movable-view','cover-view','cover-image','share-element','page-container','root-portal',
  'input','textarea','picker','picker-view','picker-view-column','slider','switch','label','form','checkbox','checkbox-group','radio','radio-group','editor',
  'web-view','official-account','open-data','ad','page-meta','navigation-bar','match-media','aria-component',
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const files = ext => walk(src).filter(f => f.endsWith(ext)).sort();

function scanWxml(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const text = raw.replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));
  const issues = [];
  const stack = [];
  const tags = [];
  const re = /<\/?([a-zA-Z][\w.-]*)((?:\s+[^\s/>=]+(?:="[^"]*")?)*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(text))) {
    const [full, name, attrText, slash] = m;
    const line = text.slice(0, m.index).split('\n').length;
    if (full.startsWith('</')) {
      const open = stack.pop();
      if (open !== name) issues.push(`line ${line}: </${name}> closes <${open}>`);
      continue;
    }
    const attrs = {};
    for (const a of attrText.matchAll(/([^\s/>=]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
    tags.push({ name, attrs, line });
    if (slash !== '/') stack.push(name);
  }
  if (stack.length) issues.push('unclosed tags: ' + stack.join(', '));
  const openings = (raw.match(/\{\{/g) || []).length, closings = (raw.match(/\}\}/g) || []).length;
  if (openings !== closings) issues.push(`unbalanced mustaches: ${openings} '{{' vs ${closings} '}}'`);
  // Bare `&&` is not valid XML and `&amp;&amp;` depends on entity decoding: both are avoided.
  if (raw.includes('&&') || raw.includes('&amp;&amp;')) issues.push('template uses && inside WXML; precompute the flag in the page data');
  // WXML text nodes do NOT decode HTML entities. `&amp;` reaches the renderer verbatim, so a reader
  // literally sees "&amp;". Proven with wcc on DevTools 2.02.2608070: `<view>A &amp; B</view>`
  // compiles to the string "A &amp; B", while a plain `&` compiles to "A &". Use the plain character.
  for (const m of raw.matchAll(/&[a-zA-Z][a-zA-Z0-9]*;|&#[0-9]+;/g)) {
    const line = raw.slice(0, m.index).split('\n').length;
    issues.push(`line ${line}: '${m[0]}' is not decoded by WXML and would render literally — write the plain character`);
  }
  return { raw, tags, issues };
}

function scanWxss(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const issues = [];
  const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const open = (stripped.match(/\{/g) || []).length, close = (stripped.match(/\}/g) || []).length;
  if (open !== close) issues.push(`unbalanced braces: ${open} '{' vs ${close} '}'`);
  const media = /@media\s*\(([^)]*)\)/g;
  const allowed = /^(min-width|max-width|min-height|max-height|orientation|prefers-reduced-motion|prefers-color-scheme)/;
  for (const m of stripped.matchAll(media)) for (const part of m[1].split(/\s+and\s+/)) if (!allowed.test(part.trim())) issues.push(`unsupported media query: ${part.trim()}`);
  for (const m of stripped.matchAll(/@import\s+["']([^"']+)["']/g)) {
    const target = m[1].startsWith('/') ? path.join(src, m[1]) : path.resolve(path.dirname(file), m[1]);
    if (!fs.existsSync(target)) issues.push(`missing @import: ${m[1]}`);
  }
  // WXSS does not support the universal selector in ANY form (`*`, `.a *`, `.a > *`, `*.b`).
  // wcsc aborts the whole file with "unexpected token `*`", which blanks every page at runtime.
  // Verified against DevTools 2.02.2608070: see docs/miniprogram-verification.md.
  const selectors = (() => {
    let text = stripped;
    for (let prev; prev !== text; ) { prev = text; text = text.replace(/\{[^{}]*\}/g, ' '); }
    return text;
  })();
  for (const m of selectors.matchAll(/\*/g)) {
    const line = selectors.slice(0, m.index).split('\n').length;
    issues.push(`line ${line}: universal selector '*' is not valid WXSS — wcsc aborts the file; list the classes instead`);
  }
  return issues;
}

test('WXML templates are well formed and only use declared components', () => {
  const problems = [];
  for (const file of files('.wxml')) {
    const relative = path.relative(src, file);
    const configPath = path.join(path.dirname(file), 'index.json');
    const config = fs.existsSync(configPath) ? json(configPath) : {};
    const custom = new Set(Object.keys(config.usingComponents || {}));
    const { tags, issues } = scanWxml(file);
    for (const issue of issues) problems.push(`${relative}: ${issue}`);
    for (const tag of tags) {
      if (!BUILTIN.has(tag.name) && !custom.has(tag.name)) problems.push(`${relative}:${tag.line}: <${tag.name}> is not a built-in or declared component`);
      const { 'wx:for': forExpr, 'wx:key': key, 'wx:for-item': item, 'wx:for-index': index } = tag.attrs;
      if (key !== undefined && forExpr === undefined) problems.push(`${relative}:${tag.line}: wx:key without wx:for`);
      if ((item !== undefined || index !== undefined) && forExpr === undefined) problems.push(`${relative}:${tag.line}: wx:for-item/index without wx:for`);
      if (key !== undefined && (key === 'index' || key.endsWith('Index') || key === item || key === index)) problems.push(`${relative}:${tag.line}: wx:key="${key}" resolves to a duplicate or missing value`);
      // WeChat promotes a <text> carrying both user-select and wx:for to block level, which breaks
      // inline flow: bullet markers end up alone on their own line and multi-run paragraphs split
      // one line per run. Verified in DevTools 2.02.2608070 — see docs/miniprogram-verification.md.
      if (tag.attrs['user-select'] !== undefined && forExpr !== undefined) problems.push(`${relative}:${tag.line}: <${tag.name} user-select wx:for> renders block-level and breaks inline text flow — drop user-select`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every WXML event handler exists in the compiled page or component script', () => {
  const problems = [];
  for (const file of files('.wxml')) {
    const relative = path.relative(src, file);
    const script = path.join(build, relative.replace(/\.wxml$/, '.js'));
    if (!fs.existsSync(script)) { problems.push(`${relative}: no compiled script at ${script}`); continue; }
    const compiled = fs.readFileSync(script, 'utf8');
    const { tags } = scanWxml(file);
    for (const tag of tags) for (const [attr, handler] of Object.entries(tag.attrs)) {
      if (!/^(bind|catch|mut-bind|capture-bind|capture-catch):?[a-zA-Z]\w*$/.test(attr) || !handler) continue;
      if (!new RegExp(`(^|[\\s,{])${handler}\\s*[(]`).test(compiled)) problems.push(`${relative}:${tag.line}: ${handler} is not defined in the compiled script`);
    }
  }
  assert.deepEqual(problems, []);
});

test('app.json, page configs and tab bar match the generated build output', () => {
  const app = json(path.join(src, 'app.json'));
  assert.ok(app.pages.length > 0);
  assert.ok(app.pages.every(p => fs.existsSync(path.join(build, `${p}.js`))));
  assert.ok(app.tabBar.list.length >= 2 && app.tabBar.list.length <= 5);
  for (const item of app.tabBar.list) assert.ok(app.pages.includes(item.pagePath), `tab ${item.pagePath} is not registered`);
  assert.equal(path.join(build, app.sitemapLocation), path.join(build, 'sitemap.json'));
  for (const file of files('.json')) {
    if (file.endsWith('app.json') || file.endsWith('sitemap.json') || file.includes('generated')) continue;
    const config = json(file);
    for (const [name, target] of Object.entries(config.usingComponents || {})) {
      const dir = path.join(build, target.replace(/^\//, ''));
      for (const ext of ['js', 'json', 'wxml']) assert.ok(fs.existsSync(`${dir}.${ext}`), `${path.relative(src, file)}: ${name} missing ${dir}.${ext}`);
    }
  }
  assert.deepEqual(json(path.join(build, 'app.json')), app);
});

test('WXSS files are balanced, avoid unsupported at-rules and never use the universal selector', () => {
  const problems = [];
  for (const file of files('.wxss')) for (const issue of scanWxss(file)) problems.push(`${path.relative(src, file)}: ${issue}`);
  assert.deepEqual(problems, []);
});

// WeChat DevTools resolves require() by appending ".js" to the argument, so requiring a packaged
// ".json" file fails at runtime with "module 'x.json.js' is not defined". Verified against a real
// first launch: the home page threw MiniProgramError before this guard existed.
test('packaged scripts never require a .json file and every required module is present', () => {
  const problems = [];
  for (const file of walk(build).filter(f => f.endsWith('.js'))) {
    const relative = path.relative(build, file);
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
      const arg = m[1];
      if (arg.endsWith('.json')) { problems.push(`${relative}: require("${arg}") — DevTools appends .js, use a generated .js module`); continue; }
      if (!arg.startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), arg);
      if (!fs.existsSync(target) && !fs.existsSync(`${target}.js`) && !fs.existsSync(path.join(target, 'index.js'))) problems.push(`${relative}: require("${arg}") does not resolve inside the package`);
    }
  }
  for (const entry of ['generated/catalog.js']) assert.ok(fs.existsSync(path.join(build, entry)), `missing packaged module ${entry}`);
  assert.deepEqual(problems, []);
});

// The strongest guard available offline: WeChat ships its own compilers (wcc for WXML, wcsc for
// WXSS) inside DevTools, and running them locally reproduces the exact "编译 .wxss 文件错误" the IDE
// otherwise surfaces only as a blank simulator with no page-level stack trace.
// Skipped rather than failed when DevTools is absent, so CI machines without the IDE still pass.
const DEVTOOLS_APPS = [
  path.join(os.homedir(), 'Applications', 'wechatwebdevtools.app'),
  '/Applications/wechatwebdevtools.app',
];

function findCompiler(name) {
  for (const app of DEVTOOLS_APPS) {
    const bin = path.join(app, 'Contents/Resources/app.asar.unpacked/node_modules/wcc-exec', name);
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

test('packaged WXML/WXSS compile with the real WeChat compilers when DevTools is installed', () => {
  const wcc = findCompiler('wcc');
  const wcsc = findCompiler('wcsc');
  if (!wcc || !wcsc) {
    console.warn('[skip] WeChat DevTools compilers not found — verify WXML/WXSS manually by importing miniprogram/ in DevTools');
    return;
  }
  const out = path.join(os.tmpdir(), `mp-compile-${process.pid}.js`);
  const problems = [];
  // wcsc aborts the whole file on the first bad token, so every file is compiled on its own and
  // each is reported separately (one broken file must not mask the others).
  for (const file of walk(build).filter(f => f.endsWith('.wxss'))) {
    const res = spawnSync(wcsc, ['-lc', file, '-o', out], { encoding: 'utf8' });
    const lines = `${res.stdout || ''}${res.stderr || ''}`.trim().split('\n').filter(l => /ERR:/.test(l));
    if (lines.length) problems.push(`wcsc ${path.relative(build, file)}: ${lines.join(' | ')}`);
  }
  for (const file of walk(build).filter(f => f.endsWith('.wxml'))) {
    const res = spawnSync(wcc, [file, '-o', out], { encoding: 'utf8' });
    const text = `${res.stdout || ''}${res.stderr || ''}`.trim();
    if (text) problems.push(`wcc ${path.relative(build, file)}: ${text}`);
  }
  assert.deepEqual(problems, []);
});
