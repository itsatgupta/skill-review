---
name: draft-evals
description: Drafts an eval suite for a Claude Agent Skill (task cases with checkable assertions, plus should-trigger and near-miss trigger queries) and writes evals/evals.json inside the skill. Use when a skill has no evals, or the user asks to create, write or extend evals or test cases for a skill.
argument-hint: <path-to-skill-folder>
allowed-tools: Read, Grep, Glob, Write, Bash(mkdir:*), Bash(ls:*)
---

# Draft evals for a skill

Target skill: `$ARGUMENTS`. Read its `SKILL.md`, its linked references and any existing `evals/evals.json`. Never overwrite existing cases: add to them and keep their ids.

## What to write

`<skill>/evals/evals.json`, in the skill-creator format:

```json
{
  "skill_name": "<name>",
  "evals": [
    {
      "id": 1,
      "prompt": "A realistic user request, phrased as a real user would type it",
      "expected_output": "What a correct answer contains",
      "files": ["evals/files/<fixture>"],
      "assertions": ["3-5 objectively checkable statements"],
      "edge_case": false
    }
  ],
  "trigger_evals": [
    {"query": "realistic message", "should_trigger": true}
  ]
}
```

## Coverage (aim for)

- **5–8 task cases**: 3–5 core paths (the main jobs the skill exists for), plus 2–3 edge cases taken from the skill's own rules (missing input, empty diff, oversized input, conflicting sources, a "nothing to report" case).
- **Fixtures**: when a case needs input (a diff, a file, a log), write a small realistic fixture under `<skill>/evals/files/`. Keep each one under 200 lines. Use no real customer data, credentials or internal URLs beyond what the skill already names.
- **Assertions** must be checkable by reading the output: "flags the SQL concatenation on line 42 as Critical", "includes the SonarQube table", "does not suggest editing files". Not "is helpful".
- **10–16 trigger queries**: about 60% should trigger (varied phrasing: terse, indirect, with typos, naming the artifact rather than the skill). About 40% are near-misses that share keywords but belong to another skill or to no skill (for example, "write unit tests for this PR" for a review skill).

Finish with a short summary in chat: how many cases of each kind, and which of the skill's rules have no case yet.

## Example

A task case for a code-review skill:

```json
{"id": 4, "prompt": "Review this change before I merge it", "files": ["evals/files/sql-concat.diff"],
 "expected_output": "Flags the string-concatenated SQL as Critical and gives the Sonar rule",
 "assertions": ["Flags SQL built by string concatenation as Critical", "Cites a Sonar rule id for it", "Does not propose editing files directly"], "edge_case": false}
```

A near-miss trigger: `{"query": "write JUnit tests for PR 59412", "should_trigger": false}`.
