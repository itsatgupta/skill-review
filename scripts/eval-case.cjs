#!/usr/bin/env node
/* Per-case helpers for /run-evals. Never trust a runner's "done" reply: these check the files on disk.
   node scripts/eval-case.cjs check   <case-dir>   exit 0 if with_skill/ and without_skill/ both have a non-empty output.md
   node scripts/eval-case.cjs blind   <case-dir>   check, then flip a coin: writes mapping.json and blind/A.md, blind/B.md
                                                   (neutral names, so the grader cannot tell from the path which is which)
   node scripts/eval-case.cjs unblind <case-dir>   raw-grade.json + mapping.json -> grading.json
   node scripts/eval-case.cjs error   <case-dir> "<reason>"   record a case that failed after its retry (error.json) */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [cmd, dir, ...rest] = process.argv.slice(2);
if (!cmd || !dir || !fs.existsSync(dir)) {
  console.error('Usage: node scripts/eval-case.cjs <check|blind|unblind|error> <case-dir> [reason]');
  process.exit(2);
}
const MODES = ['with_skill', 'without_skill'];
const out = m => path.join(dir, m, 'output.md');

function problems() {
  return MODES.flatMap(m => {
    const p = out(m);
    if (!fs.existsSync(p)) return [`${m}/output.md is missing`];
    if (!fs.readFileSync(p, 'utf8').trim()) return [`${m}/output.md is empty`];
    return [];
  });
}

if (cmd === 'check' || cmd === 'blind') {
  const bad = problems();
  if (bad.length) {
    console.error(`${path.basename(dir)}: not ready to grade: ${bad.join('; ')}. Re-run that runner once; if it fails again, record the case with "error".`);
    process.exit(1);
  }
  if (cmd === 'check') { console.log(`${path.basename(dir)}: both outputs present`); process.exit(0); }
  const aIsWith = crypto.randomInt(2) === 0;
  const mapping = aIsWith ? { A: 'with_skill', B: 'without_skill' } : { A: 'without_skill', B: 'with_skill' };
  const blind = path.join(dir, 'blind');
  fs.rmSync(blind, { recursive: true, force: true });
  fs.mkdirSync(blind);
  fs.copyFileSync(out(mapping.A), path.join(blind, 'A.md'));
  fs.copyFileSync(out(mapping.B), path.join(blind, 'B.md'));
  fs.writeFileSync(path.join(dir, 'mapping.json'), JSON.stringify(mapping) + '\n');
  fs.rmSync(path.join(dir, 'raw-grade.json'), { force: true }); // a grade from an earlier coin flip no longer matches
  console.log(`${path.basename(dir)}: blinded -> ${path.join(blind, 'A.md')}, ${path.join(blind, 'B.md')}`);
} else if (cmd === 'unblind') {
  const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const m = read('mapping.json'), r = read('raw-grade.json');
  if (!Array.isArray(r.A) || !Array.isArray(r.B) || r.A.length !== r.B.length) {
    console.error(`${path.basename(dir)}: raw-grade.json needs "A" and "B" arrays of the same length`);
    process.exit(1);
  }
  const label = { with_skill: 'with skill', without_skill: 'without skill' };
  const g = {
    with_skill: m.A === 'with_skill' ? r.A : r.B,
    without_skill: m.A === 'with_skill' ? r.B : r.A,
    notes: String(r.notes || '').replace(/\b(?:Output )?([AB])\b/g, (s, l) => label[m[l]]),
  };
  fs.writeFileSync(path.join(dir, 'grading.json'), JSON.stringify(g, null, 2) + '\n');
  console.log(`${path.basename(dir)}: with skill ${g.with_skill.filter(Boolean).length}/${g.with_skill.length}, without ${g.without_skill.filter(Boolean).length}/${g.without_skill.length}`);
} else if (cmd === 'error') {
  const reason = rest.join(' ') || problems().join('; ') || 'runner failed';
  fs.writeFileSync(path.join(dir, 'error.json'), JSON.stringify({ error: reason, at: new Date().toISOString() }, null, 2) + '\n');
  console.log(`${path.basename(dir)}: recorded as error (${reason})`);
} else {
  console.error(`Unknown command "${cmd}". Use check, blind, unblind or error.`);
  process.exit(2);
}
