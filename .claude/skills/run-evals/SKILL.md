---
name: run-evals
description: Runs real, tool-using A/B evals for a Claude Agent Skill. Each case runs with the skill and without it (baseline) through eval-runner subagents, is graded blind by eval-grader, and is aggregated into a benchmark with an eval gate. Use when the user asks whether a skill works, is reliable, or beats no skill, or runs /run-evals with a skill path.
argument-hint: <path-to-skill-folder> [case ids, e.g. 1,3]
allowed-tools: Read, Grep, Glob, Write, Bash(node scripts/aggregate-evals.cjs:*), Bash(node scripts/eval-case.cjs:*), Bash(node scripts/summarize.cjs:*), Bash(mkdir:*), Bash(ls:*), Bash(cp:*)
---

# Run evals for a skill

Arguments: `$ARGUMENTS` (skill path, then optional case ids). The skill needs `evals/evals.json`; if it is missing, say so and offer `/draft-evals` first.

## Setup

1. Read `<skill>/evals/evals.json` and the skill `name`.
2. Pick the next iteration: `reports/<name>/iteration-<n>/` (n = highest existing + 1). Create it.
3. Copy `evals.json` into the iteration folder so the results stay tied to the exact cases used.

## A/B runs (per case)

For each selected case, create `iteration-<n>/case-<id>/with_skill/` and `.../without_skill/`. Then start **both** `eval-runner` subagents in the same turn so they run in parallel:

- one with `mode: with_skill`, `skill_path`, the case prompt, fixture paths, `out_dir: .../with_skill`
- one with `mode: without_skill`, the same prompt and fixtures, `out_dir: .../without_skill`

Run up to 3 cases (6 subagents) at a time.

**Check the files, not the reply.** A runner can say `done` without having saved anything. When both runners of a case have finished, run `node scripts/eval-case.cjs check iteration-<n>/case-<id>`. If it fails, or a runner replied `error`, re-run only the failing runner once (tell it the previous attempt saved nothing). If it fails again, run `node scripts/eval-case.cjs error iteration-<n>/case-<id> "<reason>"` and move on. The benchmark lists that case as not graded.

## Blind grading (per case)

Run `node scripts/eval-case.cjs blind iteration-<n>/case-<id>`. It checks both outputs again, flips a coin, saves the mapping to `mapping.json`, and copies the outputs to `blind/A.md` and `blind/B.md`. Give `eval-grader` the prompt, `expected_output`, the assertions, **only the two `blind/` paths** and `out_file: .../raw-grade.json`. Never pass the `with_skill/` or `without_skill/` paths, because the folder names give the answer away. Do not tell the grader which is which.

When the grade is saved, run `node scripts/eval-case.cjs unblind iteration-<n>/case-<id>`. It writes `grading.json` as `{"with_skill": [...], "without_skill": [...], "notes": "..."}`, with A and B in the notes replaced by "with skill" and "without skill". If you re-blind a case (for example after a retry), grade it again: `blind` deletes the old `raw-grade.json`, because it matched the previous coin flip.

## Trigger routing

If `trigger_evals` exist: build a catalogue of this skill's description plus every other skill's description under `skills/`, plus these generic decoys: docx, pdf, xlsx, generic-code-review, git-helper, unit-test-writer, jira-assistant, sql-helper, release-notes, meeting-notes (one-line descriptions you write). Shuffle it. Give `eval-grader` the catalogue and the queries in routing mode, with `out_file: iteration-<n>/routing-raw.json`. Then write `iteration-<n>/trigger.json` as `[{"query", "should_trigger", "picked"}]`.

## Aggregate and report

1. Run `node scripts/aggregate-evals.cjs reports/<name>/iteration-<n>`.
2. In chat, give: the eval gate (PASS or HOLD), with-skill vs without-skill pass rates and uplift, trigger accuracy/precision/recall, the 2–3 cases where the skill lost or tied with an explanation from the grader notes, and the path to `benchmark.md`.
3. If an earlier iteration exists, compare the two in one line (better, worse or flat).
4. **Always refresh the overall summary** (the last step, every run): `node scripts/summarize.cjs reports/<name> --skill=<skill path>`. It writes `reports/<name>/summary.md`, a plain-language report of what is good and bad across the review, the tests and the results. Give its path in chat as well. If `static.json` is missing, say so and suggest `/review-skill` first.

## Interpreting results

- **Uplift ≤ 0**: the skill adds tokens without adding value on these cases. Look at what the baseline did as well, and cut the rules that don't change behaviour.
- **Low recall**: the description misses how users phrase the request; add their words. **Low precision**: the description is too broad; name what it does not cover.
- Run each important case 3 times before trusting a difference smaller than 15 points. Model output varies between runs.

## Example

`/run-evals skills/sonata-code-review` ends with a reply like:

> **Eval gate: PASS**. With skill 82% vs without 51% (+31 pts) over 6 cases; trigger accuracy 88% (precision 100%, recall 80%). The skill tied on case 5 (empty diff): both answered "nothing to review". Benchmark: `reports/sonata-code-review/iteration-2/benchmark.md` (iteration 1: +24 pts, so better). Overall summary: `reports/sonata-code-review/summary.md`.
