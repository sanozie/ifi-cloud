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

# Continue CLI testing functions
test_continue_cli_installation() {
  log_info "Testing Continue CLI installation and basic functionality"

  # Check if Continue CLI is installed
  if ! command -v cn &> /dev/null; then
    log_error "Continue CLI (cn) not found in PATH. Please ensure it's installed with: npm i -g @continuedev/cli"
    return 1
  fi

  # Test basic Continue CLI functionality with version or help
  if cn --help &> /dev/null; then
    log_info "Continue CLI (cn) is installed and responsive"
  else
    log_error "Continue CLI (cn) is installed but not responding correctly"
    return 1
  fi

  return 0
}

test_continue_repo_access() {
  log_info "Testing Continue CLI access to cloned repositories"

  if [ "$SKIP_REPOS_SETUP" = true ]; then
    log_info "Repository setup was skipped, skipping repository access test"
    return 0
  fi

  if [ ! -d "$REPOS_ROOT" ]; then
    log_warn "No $REPOS_ROOT directory found, skipping repository access test"
    return 0
  fi

  # Count available repositories
  repo_count=$(find "$REPOS_ROOT" -maxdepth 1 -type d -name ".git" -parent | wc -l)
  if [ "$repo_count" -eq 0 ]; then
    # Alternative count method for repositories
    repo_count=$(find "$REPOS_ROOT" -maxdepth 1 -type d ! -name "." ! -name ".." | wc -l)
    if [ "$repo_count" -eq 0 ]; then
      log_warn "No repositories found in $REPOS_ROOT directory"
      return 0
    fi
  fi

  log_info "Found $repo_count repositories in $REPOS_ROOT"

  # Test Continue CLI can access the repositories directory
  if [ -r "$REPOS_ROOT" ] && [ -x "$REPOS_ROOT" ]; then
    log_info "Continue CLI should have read/execute access to $REPOS_ROOT directory"
  else
    log_error "Continue CLI may not have proper access to $REPOS_ROOT directory"
    return 1
  fi

  # Test accessing a specific repository
  first_repo=$(find "$REPOS_ROOT" -maxdepth 1 -type d ! -name "." ! -name ".." | head -1)
  if [ -n "$first_repo" ] && [ -d "$first_repo" ]; then
    log_info "Testing access to repository: $(basename "$first_repo")"
    if [ -r "$first_repo" ] && [ -x "$first_repo" ]; then
      log_info "Continue CLI should have proper access to repository files"
      # List a few files to verify access
      file_count=$(find "$first_repo" -type f | head -10 | wc -l)
      log_info "Can access $file_count files in $(basename "$first_repo")"
    else
      log_error "Continue CLI may not have proper access to repository: $(basename "$first_repo")"
      return 1
    fi
  fi

  return 0
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
# Create repos directory under /app/services/api (only when repo setup is enabled)
#----------------------------------------------------------
REPOS_ROOT="/app/services/api/repos"
if [ "$SKIP_REPOS_SETUP" = false ]; then
  if mkdir -p "$REPOS_ROOT" 2>/dev/null; then
    log_info "$REPOS_ROOT directory is ready"
  else
    log_warn "Could not create $REPOS_ROOT directory (permission denied). Skipping repository setup."
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

#----------------------------------------------------------
# Configure SSL/TLS for Git
#----------------------------------------------------------
if [ "$SKIP_REPOS_SETUP" = false ]; then
  log_info "Configuring Git SSL settings"
  # Ensure Git verifies SSL certificates and uses the system CA bundle
  git config --global http.sslVerify true
  git config --global http.sslCAInfo /etc/ssl/certs/ca-certificates.crt
  # Increase buffer size to avoid issues with large fetches
  git config --global http.postBuffer 524288000

  # Basic connectivity test
  log_info "Testing SSL connectivity to GitHub"
  if ! git ls-remote --heads https://github.com/octocat/Hello-World.git >/dev/null 2>&1; then
    log_warn "Initial SSL test failed, attempting to update CA certificates"
    update-ca-certificates 2>/dev/null || true
  fi
fi

# Process repositories
if [ "$SKIP_REPOS_SETUP" = false ] && [ -n "$GITHUB_REPOS" ]; then
  log_info "Processing repositories: $GITHUB_REPOS"
  
  # Split the comma-separated list
  IFS=',' read -ra REPOS <<< "$GITHUB_REPOS"
  
  for repo_url in "${REPOS[@]}"; do
    # Extract repo name from URL (assuming GitHub format)
    repo_name=$(basename "$repo_url" .git)
    repo_path="$REPOS_ROOT/$repo_name"
    
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

if [ -z "$ANTHROPIC_API_KEY" ]; then
  log_warn "ANTHROPIC_API_KEY not set, Continue CLI may not work properly"
fi

CONTINUE_CONFIG_DIR="$HOME/.continue"
mkdir -p "$CONTINUE_CONFIG_DIR"

if [ ! -f "$CONTINUE_CONFIG_DIR/config.yaml" ]; then
  log_info "Setting up Continue CLI configuration"
  cat > "$CONTINUE_CONFIG_DIR/config.yaml" << EOF
name: Ifi
version: 1.0.10
schema: v1
models:
  - uses: anthropic/claude-3-5-haiku-latest
    with:
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    override:
      roles:
        - chat
context:
  - uses: continuedev/terminal-context
  - uses: continuedev/file-context
mcpServers:
  - uses: upstash/context7-mcp

EOF
  log_info "Continue CLI configuration created"
else
  log_info "Continue CLI configuration already exists"
fi

# Log repositories that were cloned
if [ "$SKIP_REPOS_SETUP" = false ]; then
  log_info "Available repositories:"
  ls -la "$REPOS_ROOT"
else
  log_info "Repository setup skipped; no repositories available."
fi

#----------------------------------------------------------
# Test Continue CLI functionality
#----------------------------------------------------------
log_info "Testing Continue CLI before starting API server"

if test_continue_cli_installation; then
  log_info "Continue CLI installation test passed"
else
  log_error "Continue CLI installation test failed"
  exit 1
fi

if test_continue_repo_access; then
  log_info "Continue CLI repository access test passed"
else
  log_error "Continue CLI repository access test failed - Continue may not be able to access cloned repositories"
  exit 1
fi

log_info "All Continue CLI tests completed successfully"

# Start the API server
log_info "Starting API server"
exec node dist/services/api/src/index.js
