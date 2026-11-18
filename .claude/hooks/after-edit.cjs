#!/usr/bin/env node
// PostToolUse hook: when Claude edits the engine, template, adapters, config or tests,
// rebuild the pages and run the tests. On failure, exit 2 so the error is fed back to Claude.
const { execSync } = require('child_process');
let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  let file = '';
  try { const j = JSON.parse(raw || '{}'); file = (j.tool_input && (j.tool_input.file_path || j.tool_input.path)) || ''; } catch (e) { process.exit(0); }
  const p = file.replace(/\\/g, '/');
  if (/\/(public|dist)\/[^/]+\.html$/.test(p)) {
    process.stderr.write('public/ and dist/ HTML are generated. Edit src/web/index.template.html or src/engine.cjs, then run npm run build.\n');
    process.exit(2);
  }
  if (!/(\/src\/|\/tests\/|skill-review\.config\.json$)/.test(p)) process.exit(0);
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    execSync('node scripts/build.cjs && node --test tests/engine.test.cjs', { cwd: root, stdio: 'pipe', timeout: 60000 });
    process.exit(0);
  } catch (e) {
    const out = String((e.stdout || '') + (e.stderr || '')).split('\n').filter(l => /not ok|Error|error|fail|Assertion/i.test(l)).slice(0, 25).join('\n');
    process.stderr.write(`Build/tests failed after editing ${p}:\n${out || e.message}\n`);
    process.exit(2);
  }
});
