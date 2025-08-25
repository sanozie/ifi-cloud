#!/bin/bash
# Pre-commit hook to run local CI validation

echo "🔍 Running pre-commit validation..."

# Change to repo root
cd "$(git rev-parse --show-toplevel)"

# Run quick CI check
if yarn ci:quick; then
    echo "✅ Pre-commit validation passed!"
    exit 0
else
    echo "❌ Pre-commit validation failed!"
    echo "💡 Run 'yarn ci:quick' to see detailed errors"
    exit 1
fi
