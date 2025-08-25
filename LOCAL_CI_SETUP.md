# Local CI Validation Setup

This guide shows you how to run CI validation locally before committing, avoiding build failures in GitHub Actions.

## Available Scripts

- `yarn ci:quick` - Fast validation (typecheck + build)
- `yarn ci:local` - Full validation (install + typecheck + build + smoke tests)
- `yarn test:smoke` - Run smoke tests only
- `yarn precommit` - Alias for ci:quick (can be used in git hooks)

## WebStorm Integration

### 1. Run Configurations
We've created WebStorm run configurations for you:
- **Local CI Quick** - Fast validation before commit
- **Local CI Full** - Complete validation including smoke tests

These should appear in your WebStorm run configuration dropdown automatically.

### 2. Running from WebStorm
1. Open the run configuration dropdown (top right)
2. Select "Local CI Quick" or "Local CI Full"
3. Click the green run button

### 3. Keyboard Shortcuts
You can assign keyboard shortcuts:
1. Go to Settings → Keymap
2. Search for your run configuration name
3. Assign a shortcut (e.g., Cmd+Shift+T for "Local CI Quick")

## Git Hook Setup (Optional)

To automatically run validation before every commit:

```bash
# Copy the pre-commit hook
cp scripts/pre-commit.sh .git/hooks/pre-commit
```

This will run `yarn ci:quick` before each commit and prevent commits that would fail CI.

## Manual CLI Usage

```bash
# Quick check before commit
yarn ci:quick

# Full validation (like GitHub Actions)
yarn ci:local

# Just run smoke tests
yarn test:smoke
```

## Troubleshooting

### Build Errors
If you get dependency graph errors, try:
```bash
yarn install --force
yarn build
```

### Type Errors
Run type checking alone:
```bash
yarn typecheck
```

### Smoke Test Failures
Make sure your environment variables are set up correctly in `.env` file.
