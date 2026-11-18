/* Skill Review static engine. Pure function: analyze(files) -> report.
   files: [{path, size, text}]  (text null for binary / not read) */
const SR_ENGINE = (() => {
  const DEP_DIRS = /(^|\/)(node_modules|\.venv|venv|__pycache__|\.git|dist|build|\.next|target|\.gradle|site-packages)(\/|$)/;
  const JUNK = /(^|\/)(~\$[^/]*|\.DS_Store|Thumbs\.db|desktop\.ini|[^/]*\.swp|[^/]*~)$/i;
  const TEXT_EXT = /\.(md|markdown|txt|json|ya?ml|py|sh|bash|ps1|js|mjs|cjs|ts|tsx|jsx|html|css|xml|toml|ini|cfg|env|example|sql|java|rb|go|rs|csv)$/i;
  const SCRIPT_EXT = /\.(py|sh|bash|ps1|js|mjs|cjs|ts)$/i;
  const BINARY_DOC = /\.(docx?|pptx?|xlsx?|pdf)$/i;
  const SEV_W = { blocker: 40, major: 15, minor: 5, info: 0 };
  const CATS = [
    { id: 'meta', name: 'Metadata & triggering', w: 25 },
    { id: 'struct', name: 'Structure & progressive disclosure', w: 20 },
    { id: 'content', name: 'Instruction quality', w: 20 },
    { id: 'pack', name: 'Packaging & security', w: 15 },
    { id: 'evals', name: 'Evaluation readiness', w: 20 },
  ];
  const STD = {
    spec: 'Agent Skills spec (frontmatter)',
    bp: 'Anthropic skill authoring best practices',
    eval: 'Anthropic skill-creator eval loop',
    sec: 'Secure packaging (OWASP secrets / supply chain)',
    team: 'Team rule (skill-review.config.json)',
  };

  const tok = s => Math.round((s || '').length / 4);
  const lines = s => (s || '').split(/\r?\n/);
  const base = p => p.split('/').pop();
  const dir = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  const norm = p => { const out = []; for (const seg of p.split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); } return out.join('/'); };
  const fmtKB = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

  function parseFrontmatter(text) {
    const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!m) return null;
    const fm = {}; let key = null;
    for (const ln of lines(m[1])) {
      const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(ln);
      if (kv) { key = kv[1]; fm[key] = kv[2].replace(/^["']|["']$/g, '').trim(); }
      else if (key && /^\s+\S/.test(ln)) fm[key] += (fm[key] && !/^[>|]$/.test(fm[key]) ? ' ' : '') + ln.trim();
    }
    for (const k in fm) fm[k] = fm[k].replace(/^[>|]-?\s*/, '');
    return { fm, body: text.slice(m[0].length), fmLines: lines(m[0]).length - 1 };
  }

  function mdLinks(text) {
    const out = []; const re = /\[[^\]]*\]\(([^)\s#]+)(#[^)]*)?\)/g; let m;
    while ((m = re.exec(text))) { const t = m[1]; if (!/^(https?:|mailto:|#)/i.test(t)) out.push(decodeURIComponent(t)); }
    return out;
  }

  function analyze(input, config = {}) {
    const all = input.map(f => ({ ...f, path: f.path.replace(/\\/g, '/').replace(/^\/+/, '') }));
    const skillFiles = all.filter(f => base(f.path).toLowerCase() === 'skill.md' && !DEP_DIRS.test(f.path))
      .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    const findings = [], strengths = [];
    const add = (cat, sev, id, title, evidence, fix, std = 'bp') => findings.push({ cat, sev, id, title, evidence, fix, std: STD[std] });

    if (!skillFiles.length) {
      add('meta', 'blocker', 'M0', 'No SKILL.md found', 'The upload contains no SKILL.md file, so Claude cannot load it as a skill.', 'Add SKILL.md with YAML frontmatter (name, description) at the skill root.', 'spec');
      return finish({ name: '(unknown)', files: all, findings, strengths, stats: { files: all.length } }, config);
    }
    const skill = skillFiles[0];
    const root = dir(skill.path);
    const rel = p => root && p.startsWith(root + '/') ? p.slice(root.length + 1) : p;
    const files = all.map(f => ({ ...f, rel: rel(f.path) }));
    const depFiles = files.filter(f => DEP_DIRS.test(f.rel));
    const own = files.filter(f => !DEP_DIRS.test(f.rel));
    const text = skill.text || '';
    const parsed = parseFrontmatter(text);
    const fm = parsed ? parsed.fm : {};
    const body = parsed ? parsed.body : text;
    const bodyLines = lines(body);
    const name = fm.name || base(root) || '(unnamed)';
    const desc = fm.description || '';

    /* ---------- Metadata & triggering ---------- */
    if (!parsed) add('meta', 'blocker', 'M1', 'Frontmatter missing or malformed', 'SKILL.md does not start with a --- YAML block ---.', 'Start SKILL.md with YAML frontmatter containing name and description.', 'spec');
    if (!fm.name) add('meta', 'blocker', 'M2', 'name field missing', 'Frontmatter has no name.', 'Add name: lowercase-with-hyphens (max 64 characters).', 'spec');
    else {
      if (fm.name.length > 64) add('meta', 'major', 'M2a', 'name longer than 64 characters', `"${fm.name}" is ${fm.name.length} characters.`, 'Shorten the name to 64 characters or fewer.', 'spec');
      if (!/^[a-z0-9-]+$/.test(fm.name)) add('meta', 'major', 'M2b', 'name uses characters outside a-z, 0-9 and hyphen', `"${fm.name}"`, 'Use lowercase letters, numbers and hyphens only.', 'spec');
      if (/anthropic|claude/i.test(fm.name)) add('meta', 'major', 'M2c', 'name uses a reserved word', `"${fm.name}" contains "claude" or "anthropic".`, 'Remove the reserved word from the name.', 'spec');
      if (root && base(root) !== fm.name) add('meta', 'minor', 'M2d', 'name does not match its folder', `Folder "${base(root)}" vs name "${fm.name}".`, 'Rename the folder or the name so they match.', 'spec');
    }
    if (!desc) add('meta', 'blocker', 'M3', 'description missing', 'Without a description Claude has nothing to decide when to use the skill.', 'Write a third-person description that says what the skill does and when to use it.', 'spec');
    else {
      if (desc.length > 1024) add('meta', 'major', 'M3a', 'description longer than 1024 characters', `${desc.length} characters.`, 'Cut it to 1024 or fewer; keep only what helps Claude pick the skill.', 'spec');
      if (/<[a-z/][^>]*>/i.test(desc)) add('meta', 'major', 'M3b', 'description contains XML/HTML tags', 'Tags in the description are not allowed by the spec.', 'Remove angle-bracket tags from the description.', 'spec');
      if (!/\b(use (this )?(skill )?(when|for|whenever|if|to)|when (the )?user|when asked|triggers?\b|whenever)/i.test(desc))
        add('meta', 'major', 'M4', 'description does not say when to use the skill', 'No "Use when…" style trigger phrase found.', 'Add a sentence like "Use when the user asks for …, mentions …, or uploads …".');
      else strengths.push('Description states when to use the skill.');
      if (/^(i|you|we)\b|\b(i can|i will|you can|you should|we will)\b/i.test(desc))
        add('meta', 'minor', 'M5', 'description is not in the third person', `"${desc.slice(0, 80)}…"`, 'Write it as "Reviews…", "Generates…", not "I can…" or "You can…".');
      if (desc.length < 80) add('meta', 'minor', 'M6', 'description is very short', `${desc.length} characters; short descriptions under-trigger.`, 'Name the task, key terms users say, and the situations it covers.');
      const proc = (desc.match(/\b(never|always|must|do not|don't|load|run|apply|render|produce|skip|classif\w*)\b/gi) || []).length;
      if (desc.length > 600 && proc >= 4)
        add('meta', 'minor', 'M7', 'description carries workflow instructions', `${desc.length} characters with ${proc} procedural verbs (never/always/load/run…). Claude reads the description to decide whether to use the skill, and every skill's description is in context all the time.`, 'Keep what + when + key trigger terms in the description; move the how-to into the body.');
      if (/\b(\w+)\b/.test(desc) && desc.split(/\s+/).length >= 12) strengths.push(`Description has concrete trigger vocabulary (${desc.split(/\s+/).length} words).`);
    }
    const knownKeys = ['name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility', 'version', 'model', 'disable-model-invocation', 'argument-hint', 'user-invocable'];
    const extra = Object.keys(fm).filter(k => !knownKeys.includes(k));
    if (extra.length) add('meta', 'info', 'M8', 'Unrecognised frontmatter keys', extra.join(', '), 'Check these are supported by every surface the skill runs on (Claude.ai, Claude Code, API, Cursor).', 'spec');

    /* ---------- Structure & progressive disclosure ---------- */
    const bl = bodyLines.length, bt = tok(body);
    if (bl > 500) add('struct', 'major', 'S1', 'SKILL.md body over 500 lines', `${bl} lines.`, 'Move detail into reference files that SKILL.md links to.');
    else if (bl > 400) add('struct', 'minor', 'S1', 'SKILL.md body close to the 500-line limit', `${bl} lines.`, 'Plan the next split now; new rules should go into reference files.');
    else strengths.push(`SKILL.md body is ${bl} lines (under the 500-line guideline).`);
    if (bt > 5000) add('struct', bt > 9000 ? 'major' : 'minor', 'S2', 'SKILL.md body is token-heavy', `About ${bt.toLocaleString()} tokens load every time the skill triggers (guide: under ~5,000).`, 'Cut tables and repeated rules, or move them into reference files loaded by level.');
    const headings = bodyLines.filter(l => /^#{1,4}\s/.test(l)).length;
    if (headings < 3 && bl > 60) add('struct', 'minor', 'S3', 'Few headings for a long body', `${headings} headings in ${bl} lines.`, 'Break the body into titled sections so Claude can navigate it.');

    const byRel = new Map(own.map(f => [f.rel, f]));
    const rawLinks = mdLinks(body);
    const outside = [...new Set(rawLinks.filter(l => /^\.\.\//.test(l) || /^\//.test(l)))];
    const links = rawLinks.filter(l => !outside.includes(l)).map(l => norm(l));
    const linked = new Set();
    const broken = [];
    for (const l of links) { if (byRel.has(l)) linked.add(l); else broken.push(l); }
    if (outside.length) add('struct', 'major', 'S4b', 'Depends on files outside the skill folder', outside.slice(0, 4).join(', '), 'The skill breaks when installed on its own. Bundle the needed files, or name the companion skill as a stated prerequisite and say what to do when it is absent.');
    // plain-name mentions also count as references
    for (const f of own) if (f.rel !== skill.rel && body.includes(base(f.rel))) linked.add(f.rel);
    if (broken.length) add('struct', 'major', 'S4', 'Broken links in SKILL.md', [...new Set(broken)].slice(0, 6).join(', '), 'Fix the paths or add the missing files.');
    const refs = own.filter(f => /\.md$/i.test(f.rel) && f.rel !== rel(skill.path) && !/^readme\.md$/i.test(base(f.rel)) && f.rel.split('/').length <= 2 && !/^(evals?|tests?)\//i.test(f.rel));
    const orphans = refs.filter(f => !linked.has(f.rel));
    if (orphans.length) add('struct', 'minor', 'S5', 'Reference files never mentioned in SKILL.md', orphans.map(f => f.rel).slice(0, 6).join(', '), 'Link each file from SKILL.md with when to read it, or remove it. Claude only opens files SKILL.md points to.');
    const linkedRefs = refs.filter(f => linked.has(f.rel));
    if (linkedRefs.length) strengths.push(`Uses progressive disclosure: ${linkedRefs.length} reference file${linkedRefs.length > 1 ? 's' : ''} linked from SKILL.md.`);
    const nested = [];
    for (const f of linkedRefs) for (const l of mdLinks(f.text || '')) { const t = norm(dir(f.rel) ? dir(f.rel) + '/' + l : l); if (/\.md$/i.test(t) && t !== rel(skill.path) && byRel.has(t)) nested.push(`${f.rel} → ${t}`); }
    if (nested.length) add('struct', 'minor', 'S6', 'References nested more than one level deep', nested.slice(0, 5).join('; '), 'Link every reference directly from SKILL.md; Claude may only preview files reached through another reference.');
    const noToc = [];
    for (const f of linkedRefs) {
      const n = lines(f.text).length, t = tok(f.text);
      const head = lines(f.text).slice(0, 60).join('\n');
      if (n > 100 && !/(table of )?contents|^\s*[-*] \[[^\]]+\]\(#/im.test(head)) noToc.push(`${f.rel} (${n} lines)`);
      if (t > 20000) add('struct', 'major', 'S8', `${f.rel}: very large reference (${t.toLocaleString()} tokens)`, `${n} lines / ${fmtKB(f.size)}. Even partial loads are expensive and slow.`, 'Split it by topic (one file per principle group) and link each piece from SKILL.md with when to load it.');
      const vSkill = lines(body).filter(l => l.includes(base(f.rel))).map(l => /\bv(\d+\.\d+(?:\.\d+)?)\b/.exec(l)).find(Boolean);
      const vFile = [...(f.text || '').matchAll(/version\W{0,6}(\d+\.\d+(?:\.\d+)?)/gi)].pop();
      if (vSkill && vFile && vSkill[1] !== vFile[1]) add('struct', 'major', 'S9', `Version drift: SKILL.md cites ${base(f.rel)} v${vSkill[1]}, the file is v${vFile[1]}`, 'The instructions and the rulebook they point to disagree on which version applies.', 'Update SKILL.md (or drop the pinned version) whenever the reference file changes.');
    }
    if (noToc.length) add('struct', 'minor', 'S7', 'Long reference files with no table of contents', noToc.join(', '), 'Add a contents list at the top of each file over 100 lines so Claude sees the whole scope even on a partial read.');
    const winPaths = bodyLines.map((l, i) => [i + 1 + (parsed ? parsed.fmLines : 0), l]).filter(([, l]) => /(^|[\s`(])[A-Za-z]:\\|\w\\\w+\.\w{2,4}\b/.test(l));
    if (winPaths.length) add('struct', 'minor', 'S10', 'Windows-style paths in instructions', winPaths.slice(0, 3).map(([n, l]) => `line ${n}: ${l.trim().slice(0, 70)}`).join(' · '), 'Use forward slashes; they work on every platform.');

    /* ---------- Instruction quality ---------- */
    const hasExamples = own.some(f => /example/i.test(base(f.rel))) || /^#+\s.*example/im.test(body);
    if (!hasExamples) add('content', 'major', 'C1', 'No worked examples', 'No examples file or Example section.', 'Add 2–3 input → expected output examples; they anchor output quality more than rules do.');
    else strengths.push('Includes worked examples.');
    if (/^#+\s.*(output|template|format|report)/im.test(body)) strengths.push('Defines an output template / format.');
    else add('content', 'minor', 'C2', 'No explicit output format', 'No Output / Template / Format section found.', 'Show the exact output shape Claude should produce.');
    const timeHits = bodyLines.map((l, i) => [i + 1, l]).filter(([, l]) => /\b(as of|until|before|after|from)\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+20\d\d|\bas of 20\d\d|\b(currently|right now|at the moment|latest version)\b/i.test(l));
    if (timeHits.length) add('content', 'minor', 'C3', 'Time-sensitive wording', `${timeHits.length} line(s), e.g. "${timeHits[0][1].trim().slice(0, 80)}"`, 'Replace with stable wording, or move old behaviour into a collapsed "Legacy" section.');
    const caps = (body.match(/\b(MUST|NEVER|ALWAYS|CRITICAL|IMPORTANT|REQUIRED)\b/g) || []).length;
    const bold = (body.match(/\*\*[^*]+\*\*/g) || []).length;
    if (caps / Math.max(bl, 1) * 100 > 3) add('content', 'minor', 'C4', 'Heavy use of shouted imperatives', `${caps} MUST/NEVER/ALWAYS-style words in ${bl} lines.`, 'Current models over-apply shouted rules. State the rule once and give the reason.');
    if (bold / Math.max(bl, 1) > 0.35) add('content', 'info', 'C5', 'Emphasis inflation', `${bold} bold spans in ${bl} lines; when most things are bold, nothing stands out.`, 'Keep bold for the handful of rules that really are gates.');
    const todo = bodyLines.filter(l => /\b(TODO|FIXME|TBD|XXX|lorem ipsum)\b/.test(l.replace(/`[^`]*`/g, '')));
    if (todo.length) add('content', 'minor', 'C6', 'Unfinished placeholders', todo.slice(0, 2).map(l => l.trim().slice(0, 60)).join(' · '), 'Finish or remove placeholder text before release.');
    const hosts = [...new Set((body.match(/\b[a-z0-9-]+(\.[a-z0-9-]+)+\.(net|com|io|org|local|internal)\b/gi) || []).filter(h => !/anthropic|claude|github\.com|example\./i.test(h)))];
    if (hosts.length) add('content', 'info', 'C7', 'Hard-coded hosts in instructions', hosts.slice(0, 4).join(', '), 'Fine for an internal skill; if it may move, put hosts in one config section.');
    const precedence = (body.match(/\b(wins|takes precedence|overrides?|supersedes?)\b/gi) || []).length;
    if (precedence >= 3) add('content', 'info', 'C8', 'Several precedence rules', `${precedence} "wins / overrides" statements; conflicting sources make behaviour harder to predict.`, 'Put one precedence order in a single place.');
    const syncNote = /keep .{0,40}(aligned|in sync|synced)|must follow the same pipeline/i.test(body);
    if (syncNote) add('content', 'minor', 'C9', 'Rules duplicated in a second place that must be kept in sync', 'SKILL.md asks for another file to mirror its process by hand.', 'Have one source of truth (the skill) and let the other consumer load it, or add a check that fails on drift.');

    /* ---------- Packaging & security ---------- */
    const totalSize = files.reduce((a, f) => a + (f.size || 0), 0);
    const depSize = depFiles.reduce((a, f) => a + (f.size || 0), 0);
    if (depFiles.length) {
      const dirs = [...new Set(depFiles.map(f => (DEP_DIRS.exec(f.rel) || [])[2]))].join(', ');
      add('pack', 'blocker', 'P1', 'Dependency or build folders bundled in the skill', `${depFiles.length.toLocaleString()} files (${fmtKB(depSize)}) under ${dirs}.`, 'Remove them and add a .gitignore / .skillignore; install dependencies at run time.', 'sec');
    }
    const ownSize = totalSize - depSize;
    if (ownSize > 30 * 1048576 || (totalSize > 30 * 1048576 && !depFiles.length)) add('pack', 'major', 'P2', 'Skill bundle is very large', `${fmtKB(totalSize)} in ${files.length.toLocaleString()} files.`, 'A skill should carry only what Claude reads or runs; aim for well under 10 MB.', 'sec');
    const junk = own.filter(f => JUNK.test(f.rel));
    if (junk.length) add('pack', 'minor', 'P3', 'Temporary / OS junk files', junk.map(f => f.rel).slice(0, 5).join(', '), 'Delete them (Office ~$ lock files, .DS_Store, editor swap files).', 'sec');
    const envs = own.filter(f => /(^|\/)\.env(\.[a-z]+)?$/i.test(f.rel));
    for (const e of envs) {
      const isExample = /example|sample|template/i.test(e.rel);
      const filled = lines(e.text).filter(l => /^\s*[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|PASS|API_?KEY|PAT)[A-Z0-9_]*\s*=\s*\S+/i.test(l) && !/=\s*(<.*>|your|changeme|xxx|\*+)/i.test(l));
      if (!isExample) add('pack', 'blocker', 'P4', `Environment file shipped: ${e.rel}`, 'Real .env files usually contain credentials.', 'Remove it; ship .env.example with empty values only.', 'sec');
      else if (filled.length) add('pack', 'blocker', 'P4', `${e.rel} has filled-in secret values`, `${filled.length} secret-like key(s) with values.`, 'Blank the values and rotate any real credentials.', 'sec');
    }
    const secretRes = [
      [/AKIA[0-9A-Z]{16}/, 'AWS access key'], [/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'private key'],
      [/\bgh[pousr]_[A-Za-z0-9]{36}\b/, 'GitHub token'], [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
      [/\bsk-(ant-)?[A-Za-z0-9_-]{32,}/, 'API secret key'], [/\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"'\s$<{]{8,}["']/i, 'hard-coded credential'],
    ];
    const secretHits = [];
    for (const f of own) if (f.text && !/\.env/i.test(f.rel)) for (const [re, label] of secretRes) { const m = re.exec(f.text); if (m) secretHits.push(`${label} in ${f.rel}`); }
    if (secretHits.length) add('pack', 'blocker', 'P5', 'Possible secrets in files', secretHits.slice(0, 5).join('; '), 'Remove and rotate them; load secrets from the environment.', 'sec');
    const docs = own.filter(f => BINARY_DOC.test(f.rel) && !JUNK.test(f.rel));
    if (docs.length) add('pack', 'minor', 'P6', 'Binary office documents inside the skill', docs.map(f => f.rel).slice(0, 4).join(', '), 'Claude reads Markdown directly; convert guidance to .md or move user docs out of the skill.', 'bp');
    const pkg = own.find(f => /(^|\/)package\.json$/.test(f.rel)) || own.find(f => /(^|\/)(pom\.xml|requirements\.txt|pyproject\.toml)$/.test(f.rel));
    const appSrc = own.filter(f => /(^|\/)(server|client|src|app)\//.test(f.rel) && SCRIPT_EXT.test(f.rel)).length;
    if (pkg && appSrc >= 5) add('pack', 'minor', 'P7', 'A full application is bundled inside the skill', `${pkg.rel} plus ${appSrc} source files.`, 'Keep the app in its own repo; the skill should hold instructions, references and small helper scripts.', 'bp');
    const scripts = own.filter(f => SCRIPT_EXT.test(f.rel) && !/(^|\/)(server|client|src|app)\//.test(f.rel) && !/config\.(t|j)s$/.test(f.rel));
    const danger = [];
    for (const f of own.filter(f => SCRIPT_EXT.test(f.rel))) {
      const m = /rm\s+-rf\s+[\/~$]|curl[^|\n]*\|\s*(ba)?sh|Invoke-Expression|\biex\s*\(|Remove-Item[^\n]*-Recurse[^\n]*-Force|eval\(\s*(atob|Buffer)/i.exec(f.text || '');
      if (m) danger.push(`${f.rel}: ${m[0].slice(0, 40)}`);
    }
    if (danger.length) add('pack', 'major', 'P8', 'Scripts with destructive or remote-exec commands', danger.slice(0, 4).join('; '), 'Remove them or gate them behind explicit confirmation and document why.', 'sec');
    const unref = scripts.filter(f => !body.includes(base(f.rel)));
    if (unref.length) add('pack', 'info', 'P9', 'Scripts that SKILL.md never mentions', unref.map(f => f.rel).slice(0, 5).join(', '), 'Say in SKILL.md when to run each script (and whether to run or read it), or remove it.', 'bp');

    /* ---------- Team rules from skill-review.config.json ---------- */
    for (const rule of (config.rules || [])) {
      if (rule.when && !new RegExp(rule.when, 'i').test(desc)) continue;
      let re; try { re = new RegExp(rule.pattern, rule.flags || 'im'); } catch (e) { continue; }
      const scope = rule.file === 'any' ? own.filter(f => f.text) : rule.file === 'description' ? [{ rel: 'description', text: desc }] : [{ rel: rel(skill.path), text: body }];
      const hits = scope.filter(f => re.test(f.text));
      const failed = rule.type === 'require' ? hits.length === 0 : hits.length > 0;
      if (failed) add(rule.category || 'content', rule.severity || 'minor', rule.id || 'T', rule.title, rule.type === 'require' ? `Required pattern /${rule.pattern}/ not found in ${rule.file || 'SKILL.md body'}.` : `Found in ${hits.map(h => h.rel).slice(0, 4).join(', ')}.`, rule.fix || '', 'team');
    }
    const allowed = config.allowedHosts || [];
    if (allowed.length) { const bad = [...new Set((body.match(/\b[a-z0-9-]+(\.[a-z0-9-]+)+\.(net|com|io|org|local|internal)\b/gi) || []))].filter(h => !allowed.some(a => h.toLowerCase().endsWith(a.toLowerCase())) && !/anthropic|claude|github\.com|example\./i.test(h)); if (bad.length) add('content', 'minor', 'T-HOST', 'Hosts outside the team allowlist', bad.slice(0, 5).join(', '), 'Use only approved hosts, or add this one to allowedHosts in skill-review.config.json.', 'team'); }

    /* ---------- Evaluation readiness ---------- */
    const evalFiles = own.filter(f => /(^|\/)(evals?|tests?)\/.*\.(json|ya?ml|md)$|evals?\.json$/i.test(f.rel));
    let cases = [], parsedEval = false;
    for (const f of evalFiles) { try { const j = JSON.parse(f.text || ''); const arr = Array.isArray(j) ? j : (j.evals || j.cases || j.tests || []); if (Array.isArray(arr)) { cases = cases.concat(arr); parsedEval = true; } } catch (e) { /* not json */ } }
    if (!evalFiles.length) add('evals', 'major', 'E1', 'No evals shipped with the skill', 'No evals/ folder or evals.json found, so nobody can show the skill works, or that a change did not break it.', 'Add evals/evals.json with realistic prompts, expected outputs and assertions (the app below can draft them).', 'eval');
    else {
      strengths.push(`Ships eval files (${evalFiles.length}).`);
      if (parsedEval && cases.length < 3) add('evals', 'major', 'E2', 'Fewer than 3 eval cases', `${cases.length} case(s).`, 'Cover the main task, at least one edge case and one near-miss prompt.', 'eval');
      if (parsedEval && !cases.some(c => c.should_trigger === false || /negative|near.?miss|should not/i.test(JSON.stringify(c)))) add('evals', 'minor', 'E3', 'No negative / near-miss trigger cases', 'All cases assume the skill should fire.', 'Add prompts that look similar but should not use this skill.', 'eval');
      if (parsedEval && cases.length && !cases.some(c => c.assertions || c.expectations || c.expected_output)) add('evals', 'minor', 'E4', 'Eval cases have no expected output or assertions', 'Cases can be run but not graded.', 'Add expected_output and checkable assertions to each case.', 'eval');
    }
    if (!/\b(if|when)\b[^.\n]{0,60}\b(missing|fails?|error|not found|empty|invalid|unavailable)\b/i.test(body)) add('evals', 'minor', 'E5', 'Failure paths not described', 'No instructions for missing input, tool failures or empty results.', 'Say what to do when input is missing, a fetch fails or there is nothing to report.');
    else strengths.push('Describes what to do on missing input or failures.');

    return finish({ name, desc, files, own, depFiles, findings, strengths, root, skillRel: rel(skill.path), fm,
      stats: { files: files.length, ownFiles: own.length, depFiles: depFiles.length, size: totalSize, bodyLines: bl, bodyTokens: bt, refs: refs.length, scripts: scripts.length, evals: cases.length } }, config);
  }

  function finish(r, config = {}) {
    const W = config.weights || {}, passAt = config.passScore || 75;
    const order = { blocker: 0, major: 1, minor: 2, info: 3 };
    r.findings.sort((a, b) => order[a.sev] - order[b.sev]);
    r.cats = CATS.map(c0 => { const c = { ...c0, w: W[c0.id] ?? c0.w }; const fs = r.findings.filter(f => f.cat === c.id); return { ...c, score: Math.max(0, 100 - fs.reduce((a, f) => a + SEV_W[f.sev], 0)), n: fs.length }; });
    const wsum = r.cats.reduce((a, c) => a + c.w, 0) || 100;
    r.score = Math.round(r.cats.reduce((a, c) => a + c.score * c.w, 0) / wsum);
    const cnt = s => r.findings.filter(f => f.sev === s).length;
    r.counts = { blocker: cnt('blocker'), major: cnt('major'), minor: cnt('minor'), info: cnt('info') };
    r.gate = r.counts.blocker ? 'Fail' : (r.counts.major || r.score < passAt) ? 'Conditional' : 'Pass';
    r.grade = r.score >= 90 ? 'A' : r.score >= 80 ? 'B' : r.score >= 70 ? 'C' : r.score >= 60 ? 'D' : 'E';
    r.at = new Date().toISOString();
    delete r.files; delete r.own; delete r.depFiles;
    return r;
  }
  return { analyze, parseFrontmatter, CATS, DEP_DIRS, TEXT_EXT, fmtKB, VERSION: '1.1.0' };
})();
if (typeof module !== 'undefined') module.exports = SR_ENGINE;
