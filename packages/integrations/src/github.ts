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
  // Prefer new env var, fall back to legacy for back-compat
  const privateKeyBase64 =
    process.env.GITHUB_APP_PRIVATE_KEY || process.env.GITHUB_PRIVATE_KEY;
  
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
 * Resolve installation id for a repo (owner/name)
 */
export async function resolveInstallationId(owner: string, repo: string) {
  const app = createGitHubApp();
  const resp = await app.octokit.request(
    'GET /repos/{owner}/{repo}/installation',
    { owner, repo }
  );
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - the type from octokit isn't strict
  return resp.data.id as number;
}

/**
 * Convenience helper: given repo full name \"owner/name\" return { octokit, installationId }
 */
export async function getOctokitForRepo(repoFullName: string) {
  const [owner, repo] = repoFullName.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repo format: ${repoFullName}`);
  }
  const installationId = await resolveInstallationId(owner, repo);
  const octokit = await getInstallationOctokit(installationId);
  return { octokit, installationId, owner, repo };
}

/**
 * Ensure a branch exists – create from baseBranch if missing.
 */
export async function ensureBranch(
  octokit: any,
  owner: string,
  repo: string,
  baseBranch: string,
  featureBranch: string
) {
  try {
    await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      owner,
      repo,
      ref: `heads/${featureBranch}`,
    });
    // branch exists – nothing else to do
    return;
  } catch (_) {
    // continue – branch missing
  }

  // fetch base sha
  const baseRef = await octokit.request(
    'GET /repos/{owner}/{repo}/git/ref/{ref}',
    { owner, repo, ref: `heads/${baseBranch}` }
  );
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const sha = baseRef.data.object.sha;

  await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
    owner,
    repo,
    ref: `refs/heads/${featureBranch}`,
    sha,
  });
}

/**
 * Create or update a file on a specific branch
 */
export async function createOrUpdateFile(params: {
  octokit: any;
  owner: string;
  repo: string;
  path: string;
  content: string;
  branch: string;
  message: string;
}) {
  const { octokit, owner, repo, path, content, branch, message } = params;
  const encoded = Buffer.from(content).toString('base64');

  // try to get existing file to obtain sha
  let sha: string | undefined;
  try {
    const getResp = await octokit.request(
      'GET /repos/{owner}/{repo}/contents/{path}',
      { owner, repo, path, ref: branch }
    );
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    sha = getResp.data.sha;
  } catch (_) {
    // file does not exist – that's fine
  }

  await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner,
    repo,
    path,
    message,
    content: encoded,
    branch,
    sha,
  });
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
  draft?: boolean;
}) {
  const octokit = await getInstallationOctokit(params.installationId);
  
  return octokit.request('POST /repos/{owner}/{repo}/pulls', {
    owner: params.owner,
    repo: params.repo,
    title: params.title,
    body: params.body,
    head: params.head,
    base: params.base,
    draft: params.draft ?? true,
  });
}
