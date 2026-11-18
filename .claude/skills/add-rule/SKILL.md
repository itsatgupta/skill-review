---
name: add-rule
description: Adds a new static check to Skill Review, either as a regex team rule in skill-review.config.json or as engine code in src/engine.cjs with a test. Use when the user wants the reviewer to start checking for something new, or runs /add-rule with what to check.
argument-hint: <what the rule should check>
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(npm run check:*), Bash(npm test:*), Bash(node cli/review.cjs:*)
---

# Add a review rule

Requested rule: `$ARGUMENTS`

## Decide where it goes

- **Config rule** (preferred when a regex can express it): "SKILL.md must mention X", "no file may contain Y", "description must include Z". Add it to `rules` in `skill-review.config.json` with a new `T<n>` id, `type` (`forbid` or `require`), `file` (`SKILL.md`, `description` or `any`), `pattern`, `severity`, `category`, `fix`, and an optional `when` (a regex on the description that limits the rule to some skills).
- **Engine rule** (when it needs counting, cross-file logic or parsing): add it to the right section of `src/engine.cjs` with the next free id for that category (`M`, `S`, `C`, `P`, `E`). Never reuse an id. Write `evidence` that quotes what was found and a `fix` that says what to change.

## Then

1. Add a test to `tests/engine.test.cjs` with one skill that triggers the rule and one that does not. For config rules, test through the `config` argument.
2. Run `npm run check` (builds both pages and runs the tests). Fix anything that fails.
3. Run `node cli/review.cjs skills --fail-on=none` and report how many existing skills the new rule flags. If it flags almost all of them, ask whether the severity is right before keeping it.
4. Summarise in chat: the rule id, where it lives, and its severity.

## Example

`/add-rule every skill must link an examples file` becomes a config rule:

```json
{"id": "T4", "title": "Links an examples file", "type": "require", "file": "SKILL.md", "pattern": "\\]\\([^)]*example[^)]*\\.md\\)", "severity": "minor", "category": "content", "fix": "Add examples.md and link it from SKILL.md."}
```
