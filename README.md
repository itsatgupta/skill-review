# Skill Review

Reviews Claude Agent Skills against Anthropic's skill-authoring standards. It answers three questions for every skill your teams build:

1. **Is it well built?** Static checks give a score, a release gate and a list of findings.
2. **Does Claude pick it at the right time?** A trigger eval measures accuracy, precision and recall.
3. **Is it better than no skill?** A/B evals run each case with the skill and without it, graded blind.

There are three ways to use it, all running the same rules engine:

| Where | For | AI features |
|---|---|---|
| **Claude Code in VS Code** (`/review-skill`, `/draft-evals`, `/run-evals`) | Skill authors and eval owners | Real, tool-using eval runs through subagents |
| **Web app on Vercel** (`public/`) | Anyone: drop a .zip, get a report | Rubric plus simulated evals through `/api/claude` |
| **CLI / CI** (`cli/review.cjs`) | Pipelines and merge gates | None (static and deterministic) |

---

## 1. Set up in VS Code with Claude Code

Prerequisites: Node 18+, VS Code, and Claude Code (the VS Code extension `anthropic.claude-code` or the `claude` CLI). Install it from the Claude Code docs: https://docs.claude.com/en/docs/claude-code/overview

```bash
git clone <this repo> skill-review && cd skill-review
code .                       # VS Code suggests the recommended extensions
npm run check                # builds the web pages and runs 14 engine tests
```

Open Claude Code in the workspace (the Claude icon in the sidebar, or the task **Skill Review: open Claude Code here**). It loads `CLAUDE.md`, the project skills, the subagents and the hooks automatically. When asked, trust the workspace so the hook can run.

### Day-to-day workflow

```text
1. Copy or unzip a team skill into skills/<name>/
2. /review-skill skills/<name>     → reports/<name>/review.md     (static + AI rubric)
3. Fix the blockers and majors in the skill's own repo
4. /draft-evals skills/<name>      → skills/<name>/evals/evals.json (commit it with the skill)
5. /run-evals skills/<name>        → reports/<name>/iteration-N/benchmark.md
6. Repeat 3–5 until both gates pass: static gate Pass, and eval gate PASS
```

### What's in `.claude/`

```
.claude/
├── settings.json            permissions (allow npm/node scripts; deny .env reads, curl, npm install; ask before deploy/push)
│                            and a PostToolUse hook
├── hooks/after-edit.cjs     after Claude edits src/, tests/ or the config: rebuild and run tests; on failure the error goes back to Claude.
│                            Blocks hand-edits to the generated HTML.
├── agents/
│   ├── skill-auditor.md     Opus, read-only: 7-dimension rubric with evidence
│   ├── eval-runner.md       Sonnet: runs one case WITH or WITHOUT the skill, saves output.md
│   └── eval-grader.md       Opus: blind A/B grading, and trigger routing
└── skills/                  slash commands
    ├── review-skill/        /review-skill <path>
    ├── draft-evals/         /draft-evals <path>
    ├── run-evals/           /run-evals <path> [case ids]
    ├── add-rule/            /add-rule <what to check>
    └── deploy/              /deploy [prod]   (manual only)
```

### VS Code tasks and debugging

- **Ctrl/Cmd+Shift+B** runs build + test.
- **Terminal → Run Task**: review a skill, review the skill of the file you have open, aggregate evals, `vercel dev`, open Claude Code.
- **Run and Debug**: step through the CLI on any skill, the engine tests or the build.
- `skill-review.config.json` and every `evals/evals.json` get autocomplete and validation from `schemas/`.

---

## 2. Project layout

```
src/engine.cjs                single source of truth for every static rule
src/web/index.template.html   web UI; boot.vercel.js and boot.claude.js adapt it to each host
skill-review.config.json      team settings: weights, pass score, allowed hosts, regex rules
scripts/build.cjs             generates public/index.html (Vercel) and dist/claude-artifact.html (claude.ai)
scripts/aggregate-evals.cjs   graded runs → benchmark.json / benchmark.md + eval gate
cli/review.cjs                static review for terminals and CI
api/claude.js                 Vercel function → Anthropic API (key stays server-side)
tests/engine.test.cjs         node:test suite
schemas/                      JSON schemas for the config and evals.json
skills/                       skills under review (git-ignored)
reports/                      output (git-ignored)
```

## 3. Team rules without code

Add regex rules to `skill-review.config.json`; the CLI, the web app and Claude Code all pick them up:

```json
{ "id": "T4", "title": "Links an examples file", "type": "require", "file": "SKILL.md",
  "pattern": "\\]\\([^)]*example[^)]*\\.md\\)", "severity": "minor", "category": "content",
  "fix": "Add examples.md and link it from SKILL.md.", "when": "review|generate" }
```

`type`: `forbid` (fails if found) or `require` (fails if missing). `file`: `SKILL.md`, `description` or `any`. `when` limits a rule to skills whose description matches. For anything a regex can't express, use `/add-rule` and Claude will write engine code plus a test.

## 4. Deploy the web app to Vercel

1. Push the repo, then import it at vercel.com/new. Framework: **Other**, build command `npm run build`, output directory `public`.
2. Environment variables: `ANTHROPIC_API_KEY` (a dedicated key with a spend limit) and `APP_PASSWORD` (the team password the page asks for). Optional: `MODEL_QUICK` / `MODEL_DEFAULT` / `MODEL_COMPLEX`, `MAX_INPUT_CHARS`.
3. Turn on **Deployment Protection** (Vercel Authentication), because skills contain internal process and hostnames.
4. Or from Claude Code: `/deploy` (preview), then `/deploy prod`.

Without an API key, the static checks still work and the AI tabs explain what's missing. `vercel.json` allows 300 s per AI call. If your plan's limit is lower, set `MODEL_COMPLEX=claude-sonnet-5-5`.

The same build also writes `dist/claude-artifact.html` for publishing inside claude.ai, where AI calls use the viewer's Claude session instead of an API key.

## 5. CI gate

```bash
node cli/review.cjs path/to/skills --fail-on=blocker   # exit 1 on any blocker
node cli/review.cjs path/to/skill --json > review.json
```

Bitbucket Pipelines:

```yaml
- step:
    name: Skill review gate
    image: node:20
    script:
      - git clone --depth 1 <skill-review repo> /tmp/skill-review
      - node /tmp/skill-review/cli/review.cjs skills --fail-on=blocker --out=review-reports
    artifacts:
      - review-reports/**
```

## 6. Release gates

| Gate | Pass when |
|---|---|
| Static | No blockers, no majors, score ≥ `passScore` (75) |
| Eval | With-skill pass rate ≥ without-skill pass rate, and trigger accuracy ≥ 80% |

Run important cases 3 times before trusting a difference under 15 points, because model output varies between runs.

## 7. Where the rules come from

- Agent Skills spec: frontmatter limits for name and description.
- Anthropic skill authoring best practices: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- The skill-creator eval loop: evals.json, with-skill vs baseline runs, benchmark.
- Packaging and security: secrets, .env files, dependency folders, destructive scripts.

## Cost guide (rough)

| Action | Calls | Typical |
|---|---|---|
| Static review | 0 | free |
| AI rubric (Opus) | 1 | $0.50–1.50 for a large skill |
| Trigger eval | 1 | cents |
| A/B evals, 6 cases (Claude Code) | 12 runs + 6 grades | $2–6, depending on how many tool calls the skill makes |
# skill-review
