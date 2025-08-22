/**
 * GitHub and Notion integration helpers
 */

// Import GitHub helpers
import {
  createGitHubApp,
  getInstallationOctokit,
  createPullRequest,
} from './github';

// Import Notion helpers
import {
  getNotionClient,
  listDatabases,
  getDatabase,
  queryDatabase,
} from './notion';

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
