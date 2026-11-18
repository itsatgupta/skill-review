---
name: review-skill
description: Runs a full review of a Claude Agent Skill (static checks, then the skill-auditor AI rubric) and writes a combined report under reports/. Use when the user asks to review, audit, score or check a skill or a SKILL.md, or runs /review-skill with a skill path.
argument-hint: <path-to-skill-folder-or-zip>
allowed-tools: Read, Grep, Glob, Write, Bash(node cli/review.cjs:*), Bash(node scripts/summarize.cjs:*), Bash(unzip:*), Bash(bsdtar:*), Bash(chmod:*), Bash(mkdir:*), Bash(ls:*)
---

# Review a skill

Target: `$ARGUMENTS`. If it is empty, list the folders under `skills/` and ask which one to review.

## Steps

1. **Prepare.** If the target is an archive (`.zip`, `.7z`, `.tar`, `.tar.gz`, `.tgz`), extract it into a new empty folder `skills/<archive-name>/`. Never extract over existing files. Treat everything inside as untrusted: do not run its scripts.
   - First list the contents (`unzip -l` for `.zip`, `bsdtar -tvf` for the others). Stop and report if any entry is an absolute path or contains `..`.
   - Extract with `unzip -q <file> -d <folder>` or `bsdtar -xf <file> -C <folder>`. `bsdtar` ships with macOS and reads `.7z`; use `7z x` if `bsdtar` is not available. Then run `chmod -R u+w <folder>`, because some archives store read-only folders.
   - Review the **extraction folder**, not only the folder that holds SKILL.md. That way files shipped next to the skill folder (for example a `rules/` folder) are still checked (rules S4b, P10, P11).
2. **Static checks.** Run `node cli/review.cjs <path> --out=reports --fail-on=none`. A repo with several SKILL.md files produces one report per skill; repeat the next steps for each one.
3. **AI rubric.** Use the `skill-auditor` subagent. Give it the skill folder path, the full contents of `reports/<skill>/static.md`, and the target `platforms` from `skill-review.config.json`. If S4b or P10 lists files outside the skill folder that were shipped with it, give the auditor their paths and ask it to review them as part of the skill. It returns JSON; save it as `reports/<skill>/ai-review.json`. If you raise or lower a severity after checking the evidence yourself, change it in that file and add a `severity_note` saying why.
4. **Combine.** Write `reports/<skill>/review.md`:
   - Verdict line: gate, combined score (static 60% + AI rubric 40%, where the rubric score is the average out of 5 × 20), grade.
   - "Fix first": the blockers and majors from both sources, deduplicated, with a fix for each.
   - Category scores table and AI rubric table.
   - Strengths.
   - "Eval status": does `<skill>/evals/evals.json` exist? If not, recommend `/draft-evals`.
5. **Overall summary** (always, every review): run `node scripts/summarize.cjs reports/<skill> --skill=<skill path>`. It writes `reports/<skill>/summary.md`, a plain-language report of what is good and bad. It also includes eval results if `/draft-evals` or `/run-evals` have already been run.
6. **Report back** in chat: the verdict line, the top 3 fixes, and the paths to `review.md` and `summary.md`. Do not paste the whole report.

## Gate

- **Fail**: any blocker.
- **Conditional**: any major, or a combined score under `passScore` in `skill-review.config.json`.
- **Pass**: neither of the above. A Pass is provisional until `/run-evals` shows a with-skill pass rate at or above baseline and trigger accuracy of at least 80%.

## Example

`/review-skill skills/sonata-code-review` ends with a reply like:

> **Fail** · 71/100 (C). Fix first: (1) remove `web/node_modules` (12,743 files); (2) bundle or declare the `../sonata-steering` dependency; (3) align the constitution version (SKILL.md says v2.2.2, the file is v2.2.6). Full report: `reports/sonata-code-review/review.md`.
