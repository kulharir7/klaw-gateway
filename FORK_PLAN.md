# Fork Plan: OpenClaw → Klaw Gateway

## What We Have
- Fork of openclaw/openclaw (MIT License)
- 6,902 files, full feature set
- upstream remote set for pulling updates

## Rebranding Steps
1. package.json: name → "klaw", bin → "klaw", description updated
2. Config dir: ~/.openclaw → ~/.klaw (or keep ~/.openclaw for compat)
3. Default port: 18789 → 19789
4. CLI references: openclaw → klaw
5. README.md: Update branding
6. UI: Update titles, logos

## Customization Plan
1. Fix any bugs we've found
2. Add features we need
3. Customize for Indian market (Hindi support, Indian providers)
4. Keep syncing upstream updates via git merge

## Git Workflow
```bash
# Get upstream updates
git fetch upstream
git merge upstream/main
# Resolve conflicts if any
git push origin main
```
