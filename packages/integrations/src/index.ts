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

// Named exports for individual functions
export {
  createGitHubApp,
  getInstallationOctokit,
  createPullRequest,
  getNotionClient,
  listDatabases,
  getDatabase,
  queryDatabase,
};

// Default export with all integrations
export default {
  github,
  notion,
};

// Re-export full helper surface for external convenience
export * from './github.js';
