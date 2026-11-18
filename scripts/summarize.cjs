#!/usr/bin/env node
/* Builds a plain-language overall summary of a skill from everything the review steps have saved.
   node scripts/summarize.cjs reports/<skill> [--skill=skills/<skill>]
   Reads (all optional except static.json):
     reports/<skill>/static.json            static checks (cli/review.cjs --out=reports)
     reports/<skill>/ai-review.json         skill-auditor rubric (/review-skill)
     <skill folder>/evals/evals.json        eval suite (/draft-evals)
     reports/<skill>/iteration-<n>/         latest eval run (/run-evals): benchmark.json, trigger.json, evals.json
   Writes reports/<skill>/summary.md */
const fs = require('fs'), path = require('path');

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--'));
if (!dir || !fs.existsSync(path.join(dir, 'static.json'))) {
  console.error('Usage: node scripts/summarize.cjs reports/<skill> [--skill=<skill folder>]  (needs static.json; run /review-skill first)');
  process.exit(2);
}
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
const st = readJson(path.join(dir, 'static.json'));
const ai = readJson(path.join(dir, 'ai-review.json'));
const cfg = readJson(path.join(__dirname, '..', 'skill-review.config.json')) || {};
const passScore = cfg.passScore ?? 75;
const name = st.name || path.basename(dir);
const skillArg = args.find(a => a.startsWith('--skill='));
const skillDir = skillArg ? skillArg.slice(8) : path.join('skills', name);
const evalsPath = path.join(skillDir, 'evals', 'evals.json');
const suite = readJson(evalsPath);

const iters = fs.readdirSync(dir).filter(d => /^iteration-\d+$/.test(d)).sort((a, b) => +a.split('-')[1] - +b.split('-')[1]);
const lastIter = iters[iters.length - 1];
const bench = lastIter && readJson(path.join(dir, lastIter, 'benchmark.json'));
const prevBench = iters.length > 1 && readJson(path.join(dir, iters[iters.length - 2], 'benchmark.json'));
const trig = lastIter && readJson(path.join(dir, lastIter, 'trigger.json'));
const iterSuite = lastIter && readJson(path.join(dir, lastIter, 'evals.json'));

// ---- scores and gates (same formulas as /review-skill and aggregate-evals) ----
const rubric = ai && Array.isArray(ai.rubric) ? ai.rubric : [];
const rubricAvg = rubric.length ? rubric.reduce((a, r) => a + r.score, 0) / rubric.length : null;
const combined = rubricAvg == null ? st.score : Math.round(st.score * 0.6 + rubricAvg * 20 * 0.4);
const grade = s => s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : s >= 60 ? 'D' : 'E';
const aiIssues = ai && Array.isArray(ai.issues) ? ai.issues : [];
// An AI issue that "covers" static findings replaces them, and keeps the more serious of the severities.
const coveredBy = new Map();
for (const i of aiIssues) for (const id of (i.covers || [])) coveredBy.set(id, i);
const sevRank = { blocker: 0, major: 1, minor: 2, info: 3 };
for (const i of aiIssues) for (const id of (i.covers || [])) { const f = st.findings.find(f => f.id === id); if (f && sevRank[f.sev] < sevRank[i.severity]) i.severity = f.sev; }
const blockers = st.findings.filter(f => f.sev === 'blocker' && !coveredBy.has(f.id));
const majors = st.findings.filter(f => f.sev === 'major' && !coveredBy.has(f.id));
const aiMajors = aiIssues.filter(i => i.severity === 'major' || i.severity === 'blocker');
const blockerCount = blockers.length + aiIssues.filter(i => i.severity === 'blocker').length;
const anyBlocker = blockerCount > 0;
const anyMajor = majors.length + aiMajors.length > 0;
const reviewGate = anyBlocker ? 'Fail' : (anyMajor || combined < passScore) ? 'Conditional' : 'Pass';
const evalGate = bench ? (bench.with_skill_pass_rate >= bench.without_skill_pass_rate && (!bench.trigger || bench.trigger.accuracy >= 0.8) ? 'PASS' : 'HOLD') : null;

const pct = x => Math.round(x * 100) + '%';
const word = s => s >= 85 ? 'Good' : s >= 70 ? 'OK' : 'Needs work';
const stars = n => '●'.repeat(n) + '○'.repeat(5 - n);
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const cell = s => String(s).replace(/\|/g, '/');

// ---- verdict in plain words ----
let verdict, verdictWhy;
if (anyBlocker) {
  verdict = '🔴 Not ready to share yet';
  verdictWhy = `There ${blockerCount === 1 ? 'is 1 problem' : `are ${blockerCount} problems`} serious enough to stop release. Fix ${blockerCount === 1 ? 'it' : 'them'} first.`;
} else if (reviewGate === 'Conditional') {
  verdict = '🟡 Usable, but needs fixes before release';
  verdictWhy = 'Nothing is broken badly enough to block it, but there are important issues to fix.';
} else {
  verdict = '🟢 Ready to release';
  verdictWhy = 'No serious issues were found in the review.';
}
if (!suite && !bench) verdictWhy += ' It has no tests yet, so nobody can show it works.';
else if (!bench) verdictWhy += ' It has tests, but they have not been run yet.';
else if (evalGate === 'PASS') verdictWhy += ` In testing, it clearly helps: Claude did ${bench.uplift_pts} points better with the skill than without it.`;
else verdictWhy += ' In testing, it did not do better than Claude with no skill, so its value is not proven.';

// ---- the good ----
const good = [];
if (bench && evalGate === 'PASS') good.push(`**It makes Claude better at the job.** With the skill, Claude passed ${pct(bench.with_skill_pass_rate)} of the test checks; without it, ${pct(bench.without_skill_pass_rate)}.`);
if (bench && bench.trigger && bench.trigger.accuracy >= 0.8) good.push(`**Claude picks it at the right time.** It chose correctly for ${Math.round(bench.trigger.accuracy * bench.trigger.n)} of ${bench.trigger.n} test messages.`);
const goodCat = { meta: 'Claude can tell when to use it', struct: 'It is well organised, so Claude reads only what it needs', content: 'The instructions are clear', pack: 'The package is clean and safe', evals: 'It comes with tests' };
// Don't praise a static category when the matching AI rubric dimension scored 2/5 or lower.
const rubricFor = { meta: 'Trigger precision', struct: 'Conciseness and token economy', content: 'Instruction clarity', pack: 'Safety and guardrails' };
const lowRubric = id => rubric.some(r => r.dimension === rubricFor[id] && r.score <= 2);
for (const c of st.cats || []) {
  if (c.score < 85 || lowRubric(c.id)) continue;
  if (c.id === 'evals' && !suite) continue; // a high evals score without an evals.json would read as "it has tests"
  good.push(`**${goodCat[c.id] || c.name}** (${c.score}/100).`);
}
for (const s of (ai && ai.strengths) || []) good.push(s);
for (const s of (st.strengths || []).slice(0, 4)) good.push(s);

// ---- the bad, most serious first, deduplicated by title ----
const bad = [];
const seen = new Set();
const push = (sev, title, fix, src) => { const k = title.toLowerCase(); if (seen.has(k)) return; seen.add(k); bad.push({ sev, title, fix, src }); };
for (const f of blockers) push('blocker', f.title, f.fix, 'check');
for (const i of aiIssues.filter(i => i.severity === 'blocker')) push('blocker', i.title, i.fix, 'AI');
for (const f of majors) push('major', f.title, f.fix, 'check');
for (const i of aiIssues.filter(i => i.severity === 'major')) push('major', i.title, i.fix, 'AI');
bad.sort((a, b) => (a.sev === 'blocker' ? 0 : 1) - (b.sev === 'blocker' ? 0 : 1));
const minorCount = st.findings.filter(f => f.sev === 'minor').length + aiIssues.filter(i => i.severity === 'minor').length;
const sevLabel = { blocker: '🔴 Must fix', major: '🟠 Should fix' };

// ---- eval detail ----
const caseRows = [];
if (bench) {
  const prompts = {};
  for (const e of ((iterSuite || suite || {}).evals || [])) prompts['case-' + e.id] = e;
  for (const r of bench.rows) {
    const d = r.with_skill - r.without_skill;
    const res = d > 0 ? '✅ Skill helped' : d === 0 ? '➖ Same result' : '❌ Skill did worse';
    const e = prompts[r.case];
    caseRows.push(`| ${r.case.replace('case-', '')} | ${cell(clip(e ? e.prompt : r.case, 70))}${e && e.edge_case ? ' *(edge case)*' : ''} | ${r.with_skill}/${r.assertions} | ${r.without_skill}/${r.assertions} | ${res} |`);
  }
}
const caveats = [];
if (bench) {
  const ties = bench.rows.filter(r => r.with_skill === r.without_skill), losses = bench.rows.filter(r => r.with_skill < r.without_skill);
  if (losses.length) caveats.push(`The skill did worse on ${losses.length === 1 ? 'case' : 'cases'} ${losses.map(r => r.case.replace('case-', '')).join(', ')}. See the notes in \`${lastIter}/benchmark.md\`.`);
  if (ties.length) caveats.push(`On ${ties.length === 1 ? 'case' : 'cases'} ${ties.map(r => r.case.replace('case-', '')).join(', ')}, Claude did just as well without the skill, so those rules add little.`);
  const tw = bench.rows.reduce((a, r) => a + (r.with_s || 0), 0), to = bench.rows.reduce((a, r) => a + (r.without_s || 0), 0);
  if (tw && to && tw / to >= 1.5) caveats.push(`It is slower: runs with the skill took about ${(tw / to).toFixed(1)}× as long, because Claude reads its reference files.`);
  caveats.push('Each case was run once. Results can vary between runs, so treat differences under 15 points as unconfirmed.');
  caveats.push('Some test checks look at the report *format* the skill requires, which Claude cannot know without the skill. Read the case notes to see how much of the gain is real review quality.');
}
const misroutes = Array.isArray(trig) ? trig.filter(t => (t.picked === name) !== !!t.should_trigger) : [];

// ---- next steps ----
const next = [];
bad.slice(0, 3).forEach(b => next.push(`Fix: ${b.title}.`));
if (!suite) next.push('Write tests for the skill: `/draft-evals ' + skillDir + '`.');
else if (!bench) next.push('Run the tests: `/run-evals ' + skillDir + '`.');
if (bad.length && bench) next.push('After fixing, run `/review-skill` and `/run-evals` again to confirm nothing got worse.');
if (st.stats && st.stats.evals === 0 && suite) next.push('The static check was run before the tests were added. Run `/review-skill` again for an up-to-date score.');

function plainCat(id) {
  return ({ meta: 'Does Claude know when to use it?', struct: 'Is it organised so Claude reads only what it needs?', content: 'Are the instructions clear?', pack: 'Is the package clean and safe?', evals: 'Can we prove it works?' })[id] || id;
}

// ---- render ----
const L = [];
L.push(`# ${name}: overall summary`, '');
L.push(`*A plain-language summary of the review, the tests and the test results. Updated ${new Date().toISOString().slice(0, 10)}.*`, '');
L.push(`## ${verdict}`, '', verdictWhy, '');
L.push('| | Result |', '|---|---|');
L.push(`| Quality score | **${combined}/100** (${grade(combined)}) · pass mark ${passScore} |`);
L.push(`| Review gate | ${reviewGate} |`);
L.push(`| Tests written | ${suite ? `Yes: ${suite.evals.length} task tests, ${(suite.trigger_evals || []).length} "when to use it" tests` : 'No'} |`);
L.push(`| Test results | ${bench ? `${evalGate} · with skill ${pct(bench.with_skill_pass_rate)} vs without ${pct(bench.without_skill_pass_rate)} (${bench.uplift_pts >= 0 ? '+' : ''}${bench.uplift_pts} points)` : 'Not run yet'} |`);
if (bench && bench.trigger) L.push(`| Picked at the right time | ${pct(bench.trigger.accuracy)} of the time (${bench.trigger.n} test messages) |`);
if (prevBench) {
  const d = bench.uplift_pts - prevBench.uplift_pts;
  L.push(`| Compared with last test run | ${d > 0 ? 'Better' : d < 0 ? 'Worse' : 'About the same'} (${prevBench.uplift_pts} → ${bench.uplift_pts} points) |`);
}
L.push('');

L.push('## ✅ What is good', '');
if (good.length) good.slice(0, 10).forEach(g => L.push(`- ${g}`)); else L.push('- Nothing stood out yet.');
L.push('');

L.push('## ⚠️ What needs fixing', '');
if (bad.length) {
  L.push('Most serious first.', '');
  L.push('| | Problem | What to do |', '|---|---|---|');
  bad.forEach(b => L.push(`| ${sevLabel[b.sev] || b.sev} | ${cell(b.title)} | ${cell(b.fix)} |`));
  L.push('');
}
if (minorCount) L.push(`There are also ${minorCount} smaller issues. They are listed in [review.md](review.md) and [static.md](static.md).`, '');
if (!bad.length && !minorCount) L.push('Nothing important was found.', '');

L.push('## 🧪 Does it actually help?', '');
if (!suite) L.push('No tests exist yet, so there is no evidence either way. Run `/draft-evals` to create them.', '');
else if (!bench) L.push(`${suite.evals.length} tests are written but have not been run. Run \`/run-evals\` to find out.`, '');
else {
  L.push(`Each test gave Claude the same request twice: once **with** the skill and once **without** it. A separate grader then scored both answers without knowing which was which.`, '');
  L.push('| # | Request | With skill | Without | Result |', '|---|---|---:|---:|---|', ...caseRows, '');
  if (bench.trigger) {
    L.push('**Does Claude pick the skill at the right time?**', '');
    L.push(`We sent ${bench.trigger.n} sample messages. Some should use this skill and some only look similar. Claude chose correctly ${pct(bench.trigger.accuracy)} of the time.`);
    if (misroutes.length) { L.push('', 'It got these wrong:'); misroutes.forEach(t => L.push(`- "${clip(t.query, 90)}": ${t.should_trigger ? 'should have used the skill' : 'should not have used it'}, picked ${t.picked}`)); }
    L.push('');
  }
  if (caveats.length) { L.push('**Keep in mind**', ''); caveats.forEach(c => L.push(`- ${c}`)); L.push(''); }
}

if (rubric.length) {
  L.push('## 📋 How it scored, area by area', '');
  L.push('| Area | Score |', '|---|---|');
  for (const c of st.cats || []) L.push(`| ${plainCat(c.id)} | ${c.score}/100 (${word(c.score)}) |`);
  for (const r of rubric) L.push(`| ${r.dimension} (AI review) | ${stars(r.score)} ${r.score}/5 |`);
  L.push('');
}

L.push('## 👉 What to do next', '');
next.forEach((n, i) => L.push(`${i + 1}. ${n}`));
if (!next.length) L.push('Nothing urgent. Re-run the tests after any change to the skill.');
L.push('');
L.push('---', '');
L.push(`Details: [review.md](review.md) (full review) · [static.md](static.md) (automatic checks)${bench ? ` · [${lastIter}/benchmark.md](${lastIter}/benchmark.md) (test results)` : ''}`);

fs.writeFileSync(path.join(dir, 'summary.md'), L.join('\n') + '\n');
console.log(`${name}: ${verdict.replace(/^\S+ /, '')} · ${combined}/100 (${grade(combined)})${bench ? ` · tests ${evalGate} (${bench.uplift_pts >= 0 ? '+' : ''}${bench.uplift_pts} pts)` : suite ? ' · tests not run' : ' · no tests'}`);
console.log(`  → ${path.join(dir, 'summary.md')}`);
