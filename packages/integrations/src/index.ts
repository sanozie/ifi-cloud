/**
 * GitHub and Notion integration helpers
 */

// Import GitHub helpers
import {
  createGitHubApp,
  getInstallationOctokit,
  createPullRequest,
} from './github.js';

// Import Notion helpers
import {
  getNotionClient,
  listDatabases,
  getDatabase,
  queryDatabase,
} from './notion.js';

// Import MCP (Model Context Protocol) helpers
import {
  ensureRepoCloned,
  branchExistsLocally,
  branchExistsRemotely,
  checkoutBranch,
  getCurrentBranch,
  getCurrentCommit,
  getBranchStatus,
  getDiff,
  getChangedFiles,
  readFile,
  getRepoPathForContinue,
  prepareRepoForContinue,
  getCurrentRepoContext,
  getAvailableBranches,
} from './mcp.js';

// Export all GitHub helpers
export const github = {
  createGitHubApp,
  getInstallationOctokit,
  createPullRequest,
};

// Export all Notion helpers
export const notion = {
  getNotionClient,
  listDatabases,
  getDatabase,
  queryDatabase,
};

// Export all MCP helpers
export const mcp = {
  ensureRepoCloned,
  branchExistsLocally,
  branchExistsRemotely,
  checkoutBranch,
  getCurrentBranch,
  getCurrentCommit,
  getBranchStatus,
  getDiff,
  getChangedFiles,
  readFile,
  getRepoPathForContinue,
  prepareRepoForContinue,
  getCurrentRepoContext,
  getAvailableBranches,
};

// Named exports for individual functions
export {
  createGitHubApp,
  getInstallationOctokit,
  createPullRequest,
  getNotionClient,
  listDatabases,
  getDatabase,
  queryDatabase,
  // MCP exports
  ensureRepoCloned,
  branchExistsLocally,
  branchExistsRemotely,
  checkoutBranch,
  getCurrentBranch,
  getCurrentCommit,
  getBranchStatus,
  getDiff,
  getChangedFiles,
  readFile,
  getRepoPathForContinue,
  prepareRepoForContinue,
  getCurrentRepoContext,
  getAvailableBranches,
};

// Default export with all integrations
export default {
  github,
  notion,
  mcp,
};

// Re-export full helper surface for external convenience
export * from './github.js';

