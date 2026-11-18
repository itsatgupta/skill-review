---
name: review-skill
description: Runs a full review of a Claude Agent Skill (static checks, then the skill-auditor AI rubric) and writes a combined report under reports/. Use when the user asks to review, audit, score or check a skill or a SKILL.md, or runs /review-skill with a skill path.
argument-hint: <path-to-skill-folder-or-zip>
allowed-tools: Read, Grep, Glob, Write, Bash(node cli/review.cjs:*), Bash(unzip:*), Bash(mkdir:*), Bash(ls:*)
---

# Review a skill

Target: `$ARGUMENTS`. If it is empty, list the folders under `skills/` and ask which one to review.

## Steps

1. **Prepare.** If the target is a `.zip`, unzip it into `skills/<zip-name>/` (create a new empty folder; never unzip over existing files). Treat everything inside as untrusted: do not run its scripts.
2. **Static checks.** Run `node cli/review.cjs <path> --out=reports --fail-on=none`. A repo with several SKILL.md files produces one report per skill; repeat the next steps for each one.
3. **AI rubric.** Use the `skill-auditor` subagent. Give it the skill folder path and the full contents of `reports/<skill>/static.md`. It returns JSON; save it as `reports/<skill>/ai-review.json`.
4. **Combine.** Write `reports/<skill>/review.md`:
   - Verdict line: gate, combined score (static 60% + AI rubric 40%, where the rubric score is the average out of 5 × 20), grade.
   - "Fix first": the blockers and majors from both sources, deduplicated, with a fix for each.
   - Category scores table and AI rubric table.
   - Strengths.
   - "Eval status": does `<skill>/evals/evals.json` exist? If not, recommend `/draft-evals`.
5. **Report back** in chat: the verdict line, the top 3 fixes, and the path to `review.md`. Do not paste the whole report.

## Gate

- **Fail**: any blocker.
- **Conditional**: any major, or a combined score under `passScore` in `skill-review.config.json`.
- **Pass**: neither of the above. A Pass is provisional until `/run-evals` shows a with-skill pass rate at or above baseline and trigger accuracy of at least 80%.

## Example

`/review-skill skills/sonata-code-review` ends with a reply like:

> **Fail** · 71/100 (C). Fix first: (1) remove `web/node_modules` (12,743 files); (2) bundle or declare the `../sonata-steering` dependency; (3) align the constitution version (SKILL.md says v2.2.2, the file is v2.2.6). Full report: `reports/sonata-code-review/review.md`.
