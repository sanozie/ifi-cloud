import { App } from '@octokit/app';

/**
 * Decode base64 private key
 */
function decodePrivateKey(base64Key: string): string {
  return Buffer.from(base64Key, 'base64').toString('utf-8');
}

/**
 * Create a GitHub App instance
 */
export function createGitHubApp(): App {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyBase64 = process.env.GITHUB_PRIVATE_KEY;
  
  if (!appId) {
    throw new Error('GITHUB_APP_ID environment variable is not set');
  }
  
  if (!privateKeyBase64) {
    throw new Error('GITHUB_PRIVATE_KEY environment variable is not set');
  }
  
  const privateKey = decodePrivateKey(privateKeyBase64);
  
  return new App({
    appId: parseInt(appId, 10),
    privateKey,
    webhooks: {
      secret: process.env.GITHUB_WEBHOOK_SECRET || 'secret',
    },
  });
}

/**
 * Get an Octokit instance for a specific installation
 */
export async function getInstallationOctokit(installationId: number) {
  const app = createGitHubApp();
  return app.getInstallationOctokit(installationId);
}

/**
 * Create a pull request
 */
export async function createPullRequest(params: {
  installationId: number;
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
}) {
  const octokit = await getInstallationOctokit(params.installationId);
  
  return octokit.request('POST /repos/{owner}/{repo}/pulls', {
    owner: params.owner,
    repo: params.repo,
    title: params.title,
    body: params.body,
    head: params.head,
    base: params.base,
  });
}
