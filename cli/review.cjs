#!/usr/bin/env node
/* Static skill review for terminals, CI and Claude Code.
   node cli/review.cjs <skill-folder|skills-repo> [--json] [--out=reports] [--fail-on=blocker|major|none]
   - One report per SKILL.md found (a whole skills repo works).
   - --out writes reports/<skill>/static.json and reports/<skill>/static.md
   - Exit 1 when a finding at or above --fail-on exists (default from skill-review.config.json, else blocker). */
const fs = require('fs'), path = require('path');
const E = require('../src/engine.cjs');
const args = process.argv.slice(2);
const flag = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const target = args.find(a => !a.startsWith('--'));
if (!target) { console.error('Usage: node cli/review.cjs <skill-folder|skills-repo> [--json] [--out=reports] [--fail-on=blocker|major|none]'); process.exit(2); }
const cfgPath = path.resolve(__dirname, '..', 'skill-review.config.json');
const config = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
const failOn = flag('fail-on', config.failOn || 'blocker');
const outDir = flag('out', null);

const abs = path.resolve(target);
if (!fs.existsSync(abs)) { console.error(`Not found: ${abs}`); process.exit(2); }
const files = [];
(function walk(d) {
  for (const n of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, n.name), rel = path.relative(path.dirname(abs), p).split(path.sep).join('/');
    if (n.isSymbolicLink()) continue;
    if (n.isDirectory()) { walk(p); continue; }
    const size = fs.statSync(p).size;
    const read = !E.DEP_DIRS.test(rel) && size < 2e6 && (E.TEXT_EXT.test(rel) || /(^|\/)(\.env[^/]*|SKILL\.md)$/i.test(rel));
    files.push({ path: rel, size, text: read ? fs.readFileSync(p, 'utf8') : null });
  }
})(abs);

const roots = files.filter(f => /(^|\/)SKILL\.md$/i.test(f.path) && !E.DEP_DIRS.test(f.path)).map(f => path.posix.dirname(f.path));
const groups = roots.length > 1 ? roots.map(r => files.filter(f => f.path.startsWith(r + '/'))) : [files];
const reports = groups.map(g => E.analyze(g, config));

const md = r => [
  `# Static review: ${r.name}`, '', `**${r.gate}** · ${r.score}/100 (${r.grade}) · engine ${E.VERSION} · ${r.at}`, '',
  '| Category | Score |', '|---|---:|', ...r.cats.map(c => `| ${c.name} | ${c.score} |`), '',
  '| Severity | ID | Check | Evidence | Fix |', '|---|---|---|---|---|',
  ...r.findings.map(f => `| ${f.sev} | ${f.id} | ${f.title} | ${String(f.evidence).replace(/\|/g, '/')} | ${f.fix} |`), '',
  ...(r.strengths.length ? ['**Strengths**', '', ...r.strengths.map(s => `- ${s}`)] : []),
].join('\n');

let fail = false;
for (const r of reports) {
  if (failOn !== 'none' && (r.counts.blocker || (failOn === 'major' && r.counts.major))) fail = true;
  if (outDir) {
    const d = path.resolve(outDir, r.name); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'static.json'), JSON.stringify(r, null, 2));
    fs.writeFileSync(path.join(d, 'static.md'), md(r));
  }
  if (args.includes('--json')) continue;
  console.log(`\n${r.name}: ${r.score}/100 (${r.grade}) — ${r.gate}  [${r.counts.blocker} blocker, ${r.counts.major} major, ${r.counts.minor} minor, ${r.counts.info} info]`);
  for (const f of r.findings) console.log(`  [${f.sev}] ${f.id} ${f.title}\n      ${f.evidence}\n      fix: ${f.fix}`);
  if (outDir) console.log(`  → ${path.join(outDir, r.name)}/static.md`);
}
if (args.includes('--json')) console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
process.exit(fail ? 1 : 0);
