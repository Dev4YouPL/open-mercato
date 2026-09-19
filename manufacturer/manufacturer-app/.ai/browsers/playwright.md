# Local Playwright browser provider

The supply-cases integration lane uses the repository's Playwright runner and
the Chromium browser installed by Playwright. The interactive exploratory pass
for this feature was performed in the configured Chrome session through the
computer-use provider.

Run the reusable environment with:

```powershell
.\.ai\scripts\test-env-up.ps1
yarn test:integration
.\.ai\scripts\test-env-down.ps1
```

The runner reads `.ai/qa/test-env.json` when present. It is local runtime state
and is intentionally ignored by git.
