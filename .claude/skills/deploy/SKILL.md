---
name: deploy
description: Builds, tests and deploys the Skill Review web app to Vercel (preview by default, production only when asked).
argument-hint: [prod]
disable-model-invocation: true
allowed-tools: Read, Bash(npm run check:*), Bash(vercel whoami:*), Bash(vercel env ls:*), Bash(vercel deploy:*)
---

# Deploy Skill Review

1. Run `npm run check`. Stop if the build or any test fails.
2. Run `vercel whoami`. If not logged in, tell the user to run `vercel login` in the terminal and stop.
3. Run `vercel env ls` and confirm `ANTHROPIC_API_KEY` and `APP_PASSWORD` exist for the target environment. Never print their values. If either is missing, explain how to add it (`vercel env add ANTHROPIC_API_KEY`) and ask whether to continue with the static checks only.
4. Deploy:
   - With no argument: `vercel deploy` (preview).
   - With `prod`: confirm with the user first, then `vercel deploy --prod`.
5. Report the deployment URL. Remind the user once to turn on Vercel Deployment Protection if the project is new.

## Example

`/deploy` ends with: "Preview deployed: https://skill-review-abc123.vercel.app. Checks passed (14 tests). Deployment Protection is off for this project; turn it on in Project → Settings → Deployment Protection."
