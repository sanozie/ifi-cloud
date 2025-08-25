#!/bin/bash
set -e

# Colors for better logging
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

#----------------------------------------------------------
# Detect CI environment (e.g., GitHub Actions exports CI=true)
#----------------------------------------------------------
if [ -n "$CI" ]; then
  log_warn "CI environment detected (CI=$CI). Skipping repository setup."
  SKIP_REPOS_SETUP=true
else
  SKIP_REPOS_SETUP=false
fi

#----------------------------------------------------------
# Create /repos directory (only when repo setup is enabled)
#----------------------------------------------------------
if [ "$SKIP_REPOS_SETUP" = false ]; then
  if mkdir -p /repos 2>/dev/null; then
    log_info "/repos directory is ready"
  else
    log_warn "Could not create /repos directory (permission denied). Skipping repository setup."
    SKIP_REPOS_SETUP=true
  fi
fi

# Configure git to use GITHUB_TOKEN if available
if [ "$SKIP_REPOS_SETUP" = false ] && [ -n "$GITHUB_TOKEN" ]; then
  log_info "Configuring git with GitHub token"
  git config --global credential.helper store
  echo "https://x-access-token:${GITHUB_TOKEN}@github.com" > ~/.git-credentials
  git config --global user.name "IFI API Service"
  git config --global user.email "ifi-api@example.com"
elif [ "$SKIP_REPOS_SETUP" = false ]; then
  log_warn "GITHUB_TOKEN not set. Public repositories only."
fi

# Process repositories
if [ "$SKIP_REPOS_SETUP" = false ] && [ -n "$GITHUB_REPOS" ]; then
  log_info "Processing repositories: $GITHUB_REPOS"
  
  # Split the comma-separated list
  IFS=',' read -ra REPOS <<< "$GITHUB_REPOS"
  
  for repo_url in "${REPOS[@]}"; do
    # Extract repo name from URL (assuming GitHub format)
    repo_name=$(basename "$repo_url" .git)
    repo_path="/repos/$repo_name"
    
    log_info "Processing repository: $repo_name"
    
    if [ -d "$repo_path/.git" ]; then
      # Repository exists, update it
      log_info "Repository $repo_name exists, pulling latest changes"
      cd "$repo_path"
      git fetch --quiet
      git reset --hard origin/main --quiet || git reset --hard origin/master --quiet || log_warn "Could not reset to main/master branch, keeping current state"
      git pull --quiet
      cd - > /dev/null
    else
      # Clone the repository
      log_info "Cloning repository $repo_name to $repo_path"
      git clone --quiet "$repo_url" "$repo_path" || log_error "Failed to clone $repo_url"
    fi
  done
else
  if [ "$SKIP_REPOS_SETUP" = false ]; then
    log_warn "GITHUB_REPOS environment variable not set. No repositories will be cloned."
  fi
fi

# Configure Continue CLI if needed
CONTINUE_CONFIG_DIR="$HOME/.continue"
mkdir -p "$CONTINUE_CONFIG_DIR"

if [ ! -f "$CONTINUE_CONFIG_DIR/config.json" ]; then
  log_info "Setting up Continue CLI configuration"
  cat > "$CONTINUE_CONFIG_DIR/config.json" << EOF
{
  "models": [
    {
      "title": "Claude Sonnet 4",
      "provider": "anthropic",
      "model": "claude-3-5-sonnet-20241022",
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  ],
  "embeddingModel": {
    "provider": "voyage-ai",
    "model": "voyage-code-3",
    "apiKey": "${VOYAGE_API_KEY}"
  }
}
EOF
  log_info "Continue CLI configuration created"
else
  log_info "Continue CLI configuration already exists"
fi

# Log repositories that were cloned
if [ "$SKIP_REPOS_SETUP" = false ]; then
  log_info "Available repositories:"
  ls -la /repos
else
  log_info "Repository setup skipped; no repositories available."
fi

# Start the API server
log_info "Starting API server"
exec node dist/services/api/src/index.js
