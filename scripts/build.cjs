#!/usr/bin/env node
// Builds the web app from the single-source engine and config.
//   public/index.html        -> Vercel / any static host (AI via /api/claude)
//   dist/claude-artifact.html -> claude.ai artifact (AI via the `sample` capability)
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const rd = p => fs.readFileSync(path.join(root, p), 'utf8');
const engine = rd('src/engine.cjs').replace(/if \(typeof module !== 'undefined'\) module\.exports = SR_ENGINE;/, '');
const cfgPath = path.join(root, 'skill-review.config.json');
const config = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
const webConfig = { rules: config.rules || [], allowedHosts: config.allowedHosts || [], weights: config.weights || {}, passScore: config.passScore || 75, platforms: config.platforms || [] };
const tpl = rd('src/web/index.template.html');
if (!tpl.includes('/*__ENGINE__*/') || !tpl.includes('/*__BOOT__*/')) { console.error('Template placeholders missing'); process.exit(1); }
const make = (boot, noAi) => tpl
  .replace('/*__ENGINE__*/', () => engine)
  .replace('/*__CONFIG__*/{}', () => JSON.stringify(webConfig))
  .replace("/*__NOAI__*/''", () => JSON.stringify(noAi))
  .replace('/*__BOOT__*/', () => rd(boot));
const targets = [
  ['public/index.html', 'src/web/boot.vercel.js', 'AI features are off: the server has no ANTHROPIC_API_KEY set. The static report above still works.'],
  ['dist/claude-artifact.html', 'src/web/boot.claude.js', 'Claude isn’t reachable from this view. Open the page on claude.ai to run AI reviews and evals; the static report above still works.'],
];
for (const [out, boot, msg] of targets) {
  const html = make(boot, msg);
  // syntax-check every inline script so a broken build never ships
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) { try { new Function(m[1]); } catch (e) { console.error(`${out}: script error: ${e.message}`); process.exit(1); } }
  fs.mkdirSync(path.dirname(path.join(root, out)), { recursive: true });
  fs.writeFileSync(path.join(root, out), html);
  console.log(`built ${out} (${Math.round(html.length / 1024)} KB)`);
}
