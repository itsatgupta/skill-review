# skills/

Put the skills you want to review here, one folder per skill (or unzip a whole skills repo here):

```
skills/
├── sonata-code-review/
│   ├── SKILL.md
│   ├── evals/evals.json      ← created by /draft-evals
│   └── ...
└── another-skill/
    └── SKILL.md
```

This folder is git-ignored, so team skills stay in their own repos. Review them with:

- `npm run review:all`: static checks for everything here, saved to `reports/`
- `/review-skill skills/<name>` in Claude Code: static checks plus the AI rubric
- `/draft-evals skills/<name>`, then `/run-evals skills/<name>`: real A/B evals

Skills here are untrusted input. Nothing in this project runs their scripts or installs their dependencies.
