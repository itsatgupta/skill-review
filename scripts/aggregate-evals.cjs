#!/usr/bin/env node
/* Aggregates graded eval runs into benchmark.json + benchmark.md.
   node scripts/aggregate-evals.cjs reports/<skill>/iteration-<n>
   Expects: <iteration>/<case-id>/grading.json  ->  {"with_skill":[bool...],"without_skill":[bool...],"notes":"..."}
            <iteration>/trigger.json (optional)   ->  [{"query":"...","should_trigger":true,"picked":"name"}]
            <iteration>/<case-id>/{with_skill,without_skill}/timing.json (optional) -> {"duration_s":n,"tokens":n} */
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) { console.error('Usage: node scripts/aggregate-evals.cjs reports/<skill>/iteration-<n>'); process.exit(2); }
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
// The skill name comes from the evals.json copied into the iteration; the folder name is only a fallback.
const skill = (readJson(path.join(dir, 'evals.json')) || {}).skill_name || path.basename(path.dirname(path.resolve(dir)));
const cases = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
const rows = [], errors = [];
for (const c of cases) {
  const err = readJson(path.join(dir, c, 'error.json'));
  if (err) { errors.push({ case: c, error: err.error }); continue; }
  const g = readJson(path.join(dir, c, 'grading.json')); if (!g) continue;
  const tw = readJson(path.join(dir, c, 'with_skill', 'timing.json')) || {}, to = readJson(path.join(dir, c, 'without_skill', 'timing.json')) || {};
  const w = (g.with_skill || []).filter(Boolean).length, o = (g.without_skill || []).filter(Boolean).length, n = Math.max((g.with_skill || []).length, 1);
  rows.push({ case: c, assertions: n, with_skill: w, without_skill: o, with_rate: w / n, without_rate: o / n, with_s: tw.duration_s, without_s: to.duration_s, with_tokens: tw.tokens, without_tokens: to.tokens, notes: g.notes || '' });
}
const sum = k => rows.reduce((a, r) => a + (r[k] || 0), 0);
const tot = sum('assertions') || 1;
const trig = readJson(path.join(dir, 'trigger.json'));
let trigger = null;
if (Array.isArray(trig) && trig.length) {
  const fired = t => t.picked === skill;
  const tp = trig.filter(t => fired(t) && t.should_trigger).length, fp = trig.filter(t => fired(t) && !t.should_trigger).length, fn = trig.filter(t => !fired(t) && t.should_trigger).length;
  trigger = { n: trig.length, accuracy: trig.filter(t => fired(t) === !!t.should_trigger).length / trig.length, precision: tp + fp ? tp / (tp + fp) : 0, recall: tp + fn ? tp / (tp + fn) : 0 };
}
const bench = { skill, iteration: path.basename(dir), at: new Date().toISOString(), cases: rows.length,
  with_skill_pass_rate: sum('with_skill') / tot, without_skill_pass_rate: sum('without_skill') / tot,
  uplift_pts: Math.round((sum('with_skill') - sum('without_skill')) / tot * 100), trigger, rows, errors };
const pct = x => x == null ? '—' : Math.round(x * 100) + '%';
const gate = bench.with_skill_pass_rate >= bench.without_skill_pass_rate && (!trigger || trigger.accuracy >= 0.8) ? 'PASS' : 'HOLD';
const md = [
  `# Eval benchmark: ${skill} (${bench.iteration})`, '',
  `**Eval gate: ${gate}** · with skill ${pct(bench.with_skill_pass_rate)} vs without ${pct(bench.without_skill_pass_rate)} (${bench.uplift_pts >= 0 ? '+' : ''}${bench.uplift_pts} pts)` + (trigger ? ` · trigger accuracy ${pct(trigger.accuracy)} (precision ${pct(trigger.precision)}, recall ${pct(trigger.recall)})` : ''), '',
  '| Case | With skill | Without | Time with / without (s) | Notes |', '|---|---:|---:|---:|---|',
  ...rows.map(r => `| ${r.case} | ${r.with_skill}/${r.assertions} | ${r.without_skill}/${r.assertions} | ${r.with_s ?? '—'} / ${r.without_s ?? '—'} | ${String(r.notes).replace(/\|/g, '/')} |`),
  ...(errors.length ? ['', `**Not graded (runner failed after a retry):** ${errors.map(e => `${e.case} (${e.error})`).join('; ')}. These cases are left out of the pass rates.`] : []),
].join('\n');
fs.writeFileSync(path.join(dir, 'benchmark.json'), JSON.stringify(bench, null, 2));
fs.writeFileSync(path.join(dir, 'benchmark.md'), md);
console.log(md);
