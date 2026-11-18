// Run: npm test   (node:test, no dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.cjs');

const skillMd = (fm, body = '# Title\n\n## Steps\n1. Do it.\n\n## Output format\nA table.\n\n## Examples\nInput → output.\n\nIf input is missing, ask for it.\n') => `---\n${fm}\n---\n${body}`;
const GOOD_FM = 'name: pdf-summary\ndescription: Summarises PDF reports into a one-page brief with key figures. Use when the user uploads a PDF and asks for a summary, brief, or key points.';
const evalsJson = JSON.stringify({ skill_name: 'pdf-summary', evals: [
  { id: 1, prompt: 'a', expected_output: 'b', assertions: ['x'] }, { id: 2, prompt: 'c', expected_output: 'd', assertions: ['y'] },
  { id: 3, prompt: 'e', expected_output: 'f', assertions: ['z'], should_trigger: false }] });
const files = (extra = [], md = skillMd(GOOD_FM)) => [{ path: 'pdf-summary/SKILL.md', size: md.length, text: md }, { path: 'pdf-summary/evals/evals.json', size: 10, text: evalsJson }, ...extra];
const ids = r => r.findings.map(f => f.id);

test('a well-formed skill passes', () => {
  const r = E.analyze(files());
  assert.equal(r.gate, 'Pass', JSON.stringify(r.findings, null, 1));
  assert.equal(r.counts.blocker + r.counts.major, 0);
});
test('missing SKILL.md is a blocker', () => {
  const r = E.analyze([{ path: 'x/readme.md', size: 1, text: 'hi' }]);
  assert.ok(ids(r).includes('M0')); assert.equal(r.gate, 'Fail');
});
test('name rules: reserved words, characters, folder match', () => {
  const r = E.analyze(files([], skillMd(GOOD_FM.replace('pdf-summary', 'Claude_PDF'))));
  assert.ok(ids(r).includes('M2b')); assert.ok(ids(r).includes('M2c')); assert.ok(ids(r).includes('M2d'));
});
test('description without "when" is flagged', () => {
  const r = E.analyze(files([], skillMd('name: pdf-summary\ndescription: Summarises PDF reports into a one-page brief with key figures and charts for readers.')));
  assert.ok(ids(r).includes('M4'));
});
test('first-person description is flagged', () => {
  const r = E.analyze(files([], skillMd('name: pdf-summary\ndescription: I can summarise PDFs. Use when the user uploads a PDF and wants the key points quickly.')));
  assert.ok(ids(r).includes('M5'));
});
test('body over 500 lines is a major', () => {
  const r = E.analyze(files([], skillMd(GOOD_FM, '# T\n## Output\n## Example\n' + 'line\n'.repeat(520))));
  assert.ok(r.findings.some(f => f.id === 'S1' && f.sev === 'major'));
});
test('broken and outside-folder links', () => {
  const r = E.analyze(files([], skillMd(GOOD_FM, '# T\nSee [a](missing.md) and [b](../other/x.md).\n## Output\n## Example\nIf input is missing, stop.')));
  assert.ok(ids(r).includes('S4')); assert.ok(ids(r).includes('S4b'));
});
test('node_modules and .env are blockers; secrets detected', () => {
  const r = E.analyze(files([
    { path: 'pdf-summary/node_modules/x/index.js', size: 100, text: null },
    { path: 'pdf-summary/.env', size: 20, text: 'API_KEY=abc' },
    { path: 'pdf-summary/scripts/run.py', size: 50, text: 'token = "ghp_' + 'a'.repeat(36) + '"' },
  ]));
  ['P1', 'P4', 'P5'].forEach(id => assert.ok(ids(r).includes(id), id));
  assert.equal(r.gate, 'Fail');
});
test('.env.example with blank values is fine', () => {
  const r = E.analyze(files([{ path: 'pdf-summary/.env.example', size: 20, text: 'API_KEY=\nPORT=3000' }]));
  assert.ok(!ids(r).includes('P4'));
});
test('no evals is a major', () => {
  const md = skillMd(GOOD_FM);
  const r = E.analyze([{ path: 'pdf-summary/SKILL.md', size: md.length, text: md }]);
  assert.ok(ids(r).includes('E1'));
});
test('version drift between SKILL.md and a reference', () => {
  const ref = { path: 'pdf-summary/RULES.md', size: 100, text: '# Rules\n...\n**Version**: 2.0.0' };
  const r = E.analyze(files([ref], skillMd(GOOD_FM, '# T\nApply [RULES.md](RULES.md) (v1.0.0).\n## Output\n## Example\nIf input is missing, ask.')));
  assert.ok(ids(r).includes('S9'));
});
test('team rules: forbid, require, when', () => {
  const config = { rules: [
    { id: 'TX', title: 'No foo', type: 'forbid', pattern: 'foo', severity: 'major' },
    { id: 'TY', title: 'Needs bar', type: 'require', pattern: 'bar' },
    { id: 'TZ', title: 'Only for reviews', type: 'require', pattern: 'read-only', when: 'review' },
  ] };
  const r = E.analyze(files([], skillMd(GOOD_FM, '# T\nfoo\n## Output\n## Example\nIf input is missing, ask.')), config);
  assert.ok(ids(r).includes('TX')); assert.ok(ids(r).includes('TY')); assert.ok(!ids(r).includes('TZ'));
});
test('weights and passScore come from config', () => {
  const r = E.analyze(files(), { weights: { meta: 100, struct: 0, content: 0, pack: 0, evals: 0 }, passScore: 101 });
  assert.equal(r.score, r.cats.find(c => c.id === 'meta').score);
  assert.equal(r.gate, 'Conditional');
});
test('multiple skills in one upload: engine picks the shallowest SKILL.md', () => {
  const r = E.analyze([...files(), { path: 'pdf-summary/sub/SKILL.md', size: 10, text: skillMd('name: sub\ndescription: x') }]);
  assert.equal(r.name, 'pdf-summary');
});
