/**
 * MCP (Model Context Protocol) tools for Git branch management
 * 
 * These functions allow the API service to checkout branches that are in PR status,
 * enabling the continue CLI to read the updated code for feedback and updates.
 */

import { exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

// Configuration
const DEFAULT_REPOS_DIR = process.env.MCP_REPOS_DIR || '/tmp/ifi-repos';
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Execute a shell command with promise
 */
function execPromise(command: string, options: { cwd?: string, timeout?: number } = {}): Promise<{ stdout: string, stderr: string }> {
  const { cwd, timeout = DEFAULT_TIMEOUT_MS } = options;
  
  return new Promise((resolve, reject) => {
    exec(command, { cwd, timeout }, (error, stdout, stderr) => {
      if (error) {
        error.message = `Command failed: ${command}\n${error.message}\nstdout: ${stdout}\nstderr: ${stderr}`;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Ensure a repository directory exists
 */
async function ensureRepoDir(repoFullName: string): Promise<string> {
  const repoDir = path.join(DEFAULT_REPOS_DIR, repoFullName.replace('/', '_'));
  
  try {
    await fs.mkdir(DEFAULT_REPOS_DIR, { recursive: true });
    const stats = await fs.stat(repoDir);
    if (stats.isDirectory()) {
      return repoDir;
    }
    throw new Error(`Path exists but is not a directory: ${repoDir}`);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      await fs.mkdir(repoDir, { recursive: true });
      return repoDir;
    }
    throw error;
  }
}

/**
 * Clone a repository if it doesn't exist
 */
export async function ensureRepoCloned(repoFullName: string): Promise<string> {
  const repoDir = await ensureRepoDir(repoFullName);
  
  try {
    // Check if .git directory exists
    await fs.stat(path.join(repoDir, '.git'));
    
    // Fetch latest changes
    await execPromise('git fetch --all', { cwd: repoDir });
    return repoDir;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // Clone the repo
      // Public repositories will clone without auth; for private repos,
      // rely on the host machine's configured Git credentials (SSH agent,
      // credential helper, etc.).
      const cloneUrl = `https://github.com/${repoFullName}.git`;
      await execPromise(`git clone ${cloneUrl} ${repoDir}`);
      return repoDir;
    }
    throw error;
  }
}

/**
 * Check if a branch exists locally
 */
export async function branchExistsLocally(repoFullName: string, branchName: string): Promise<boolean> {
  const repoDir = await ensureRepoCloned(repoFullName);
  
  try {
    const { stdout } = await execPromise('git branch --list', { cwd: repoDir });
    const branches = stdout.split('\n').map(b => b.trim().replace(/^\*\s+/, ''));
    return branches.includes(branchName);
  } catch (error) {
    console.error(`Error checking if branch exists locally: ${error}`);
    return false;
  }
}

/**
 * Check if a branch exists remotely
 */
export async function branchExistsRemotely(repoFullName: string, branchName: string): Promise<boolean> {
  const repoDir = await ensureRepoCloned(repoFullName);
  
  try {
    const { stdout } = await execPromise('git ls-remote --heads origin', { cwd: repoDir });
    const branches = stdout.split('\n').map(line => {
      const parts = line.split('\t');
      return parts.length > 1 ? parts[1].replace('refs/heads/', '') : '';
    });
    return branches.includes(branchName);
  } catch (error) {
    console.error(`Error checking if branch exists remotely: ${error}`);
    return false;
  }
}

/**
 * Checkout a specific branch
 */
export async function checkoutBranch(repoFullName: string, branchName: string): Promise<boolean> {
  const repoDir = await ensureRepoCloned(repoFullName);
  
  try {
    // Check if branch exists locally
    const localExists = await branchExistsLocally(repoFullName, branchName);
    
    if (localExists) {
      // Checkout existing local branch
      await execPromise(`git checkout ${branchName}`, { cwd: repoDir });
      await execPromise(`git pull origin ${branchName}`, { cwd: repoDir });
    } else {
      // Check if branch exists remotely
      const remoteExists = await branchExistsRemotely(repoFullName, branchName);
      
      if (remoteExists) {
        // Create and checkout tracking branch
        await execPromise(`git checkout -b ${branchName} origin/${branchName}`, { cwd: repoDir });
      } else {
        throw new Error(`Branch ${branchName} does not exist locally or remotely`);
      }
    }
    
    return true;
  } catch (error) {
    console.error(`Error checking out branch: ${error}`);
    return false;
  }
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(repoFullName: string): Promise<string> {
  const repoDir = await ensureRepoCloned(repoFullName);
  
  try {
    const { stdout } = await execPromise('git rev-parse --abbrev-ref HEAD', { cwd: repoDir });
    return stdout.trim();
  } catch (error) {
    console.error(`Error getting current branch: ${error}`);
    throw error;
  }
}

/**
 * Get the current commit hash
 */
export async function getCurrentCommit(repoFullName: string): Promise<string> {
  const repoDir = await ensureRepoCloned(repoFullName);
  
  try {
    const { stdout } = await execPromise('git rev-parse HEAD', { cwd: repoDir });
    return stdout.trim();
  } catch (error) {
    console.error(`Error getting current commit: ${error}`);
    throw error;
  }
}

/**
 * Get the status of the current branch (modified files, etc.)
 */
export async function getBranchStatus(repoFullName: string): Promise<{
  branch: string;
  commit: string;
  modifiedFiles: string[];
  untrackedFiles: string[];
  isClean: boolean;
}> {
  const repoDir = await ensureRepoCloned(repoFullName);
  
  try {
    const branch = await getCurrentBranch(repoFullName);
    const commit = await getCurrentCommit(repoFullName);
    
    // Get modified files
    const { stdout: statusOutput } = await execPromise('git status --porcelain', { cwd: repoDir });
    const statusLines = statusOutput.split('\n').filter(Boolean);
    
    const modifiedFiles = statusLines
      .filter(line => line.match(/^[ MADRCU]/))
      .map(line => line.substring(3));
      
    const untrackedFiles = statusLines
      .filter(line => line.startsWith('??'))
      .map(line => line.substring(3));
    
    return {
      branch,
      commit,
      modifiedFiles,
      untrackedFiles,
      isClean: statusLines.length === 0
    };
  } catch (error) {
    console.error(`Error getting branch status: ${error}`);
    throw error;
  }
}

/**
 * Get the diff between two branches or commits
 * Get a comprehensive list of branches for a repository (local + remote)
 * along with the currently-checked-out branch and ahead/behind status.
 */
export async function getAvailableBranches(repoFullName: string): Promise<{
  localBranches: string[];
  remoteBranches: string[];
  /**
   * Current checked-out branch (undefined if repo not cloned yet)
   */
  currentBranch?: string;
  /**
   * Ahead/behind counts with respect to the remote tracking branch
   * for the current branch (undefined if not on a tracking branch).
   */
  branchStatus?: { ahead: number; behind: number };
}> {
  // If repo is not cloned yet, return empty sets but preserve path information
  const repoDir = path.join(DEFAULT_REPOS_DIR, repoFullName.replace('/', '_'));

  try {
    await ensureRepoCloned(repoFullName);
  } catch {
    // Repo missing and clone failed (e.g. private repo without creds) – return minimal info
    return { localBranches: [], remoteBranches: [], currentBranch: undefined };
  }

  try {
    const [{ stdout: locals }, { stdout: remotes }, currentBranch] =
      await Promise.all([
        execPromise('git branch --list', { cwd: repoDir }),
        execPromise('git ls-remote --heads origin', { cwd: repoDir }),
        getCurrentBranch(repoFullName).catch(() => undefined),
      ]);

    const localBranches = locals
      .split('\n')
      .filter(Boolean)
      .map((b) => b.trim().replace(/^\*\s+/, ''));

    const remoteBranches = remotes
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t')[1]?.replace('refs/heads/', '') || '')
      .filter(Boolean);

    let branchStatus: { ahead: number; behind: number } | undefined;

    if (currentBranch && remoteBranches.includes(currentBranch)) {
      try {
        const { stdout } = await execPromise(
          `git rev-list --left-right --count ${currentBranch}...origin/${currentBranch}`,
          { cwd: repoDir }
        );
        const [behindStr, aheadStr] = stdout.trim().split('\t');
        branchStatus = {
          ahead: parseInt(aheadStr || '0', 10),
          behind: parseInt(behindStr || '0', 10),
        };
      } catch {
        // Ignore if unable to compute; leave undefined
      }
    }

    return { localBranches, remoteBranches, currentBranch, branchStatus };
  } catch (error) {
    console.error(`Error retrieving branches list: ${error}`);
    return { localBranches: [], remoteBranches: [], currentBranch: undefined };
  }
}

/**
 */
export async function getDiff(
  repoFullName: string,
  base: string,
  head: string
): Promise<string> {
  const repoDir = await ensureRepoCloned(repoFullName);
  
  try {
    const { stdout } = await execPromise(`git diff ${base}..${head}`, { cwd: repoDir });
    return stdout;
  } catch (error) {
    console.error(`Error getting diff: ${error}`);
    throw error;
  }
}

/**
 * Get the list of files changed between two branches or commits
 */
export async function getChangedFiles(
  repoFullName: string,
  base: string,
  head: string
): Promise<string[]> {
  const repoDir = await ensureRepoCloned(repoFullName);
  
  try {
    const { stdout } = await execPromise(`git diff --name-only ${base}..${head}`, { cwd: repoDir });
    return stdout.split('\n').filter(Boolean);
  } catch (error) {
    console.error(`Error getting changed files: ${error}`);
    throw error;
  }
}

/**
 * Read a file from the current checked out branch
 */
export async function readFile(repoFullName: string, filePath: string): Promise<string> {
  const repoDir = await ensureRepoCloned(repoFullName);
  const fullPath = path.join(repoDir, filePath);
  
  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch (error) {
    console.error(`Error reading file: ${error}`);
    throw error;
  }
}

/**
 * Get the repository path for continue CLI
 */
export async function getRepoPathForContinue(repoFullName: string): Promise<string> {
  return await ensureRepoCloned(repoFullName);
}

/**
 * Prepare repository for continue CLI by checking out the correct branch
 */
export async function prepareRepoForContinue(
  repoFullName: string,
  branchName: string
): Promise<{ repoPath: string; branch: string; commit: string }> {
  await checkoutBranch(repoFullName, branchName);
  const repoPath = await getRepoPathForContinue(repoFullName);
  const branch = await getCurrentBranch(repoFullName);
  const commit = await getCurrentCommit(repoFullName);
  
  return {
    repoPath,
    branch,
    commit
  };
}  // <-- close prepareRepoForContinue properly

/**
 * Return high-level repository context metadata for the planner.  
 * – If the repo has not been cloned yet, `repoExists` will be false and only
 *   `repoPath` will be returned (path where it would be cloned).  
 * – Otherwise it returns current branch/commit and full local/remote branch
 *   listings so the model can decide whether it needs to checkout a different
 *   branch.
 */
export async function getCurrentRepoContext(repoFullName: string): Promise<{
  repoPath: string;
  repoExists: boolean;
  currentBranch?: string;
  currentCommit?: string;
  localBranches?: string[];
  remoteBranches?: string[];
}> {
  const repoDir = path.join(DEFAULT_REPOS_DIR, repoFullName.replace('/', '_'));

  // Determine if repoDir/.git exists
  let repoExists = false;
  try {
    await fs.stat(path.join(repoDir, '.git'));
    repoExists = true;
  } catch {
    repoExists = false;
  }

  // If repo not cloned, return minimal info
  if (!repoExists) {
    return { repoPath: repoDir, repoExists };
  }

  // Repo exists – gather additional details
  try {
    const [{ stdout: branchList }, { stdout: remoteList }, currentBranch, currentCommit] =
      await Promise.all([
        execPromise('git branch --list', { cwd: repoDir }),
        execPromise('git ls-remote --heads origin', { cwd: repoDir }),
        getCurrentBranch(repoFullName),
        getCurrentCommit(repoFullName),
      ]);

    const localBranches = branchList
      .split('\n')
      .filter(Boolean)
      .map((b) => b.trim().replace(/^\*\s+/, ''));

    const remoteBranches = remoteList
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t')[1]?.replace('refs/heads/', '') || '')
      .filter(Boolean);

    return {
      repoPath: repoDir,
      repoExists,
      currentBranch,
      currentCommit,
      localBranches,
      remoteBranches,
    };
  } catch (error) {
    console.error(`Error retrieving repo context: ${error}`);
    // Return partial context rather than throwing to keep planner resilient
    return { repoPath: repoDir, repoExists };
  }
}
