import Redis from 'ioredis';
import {
  getThread,
  prisma,
  updateJob,
  updateThreadState,
} from '@ifi/db'
import { codegen } from '@ifi/providers';
import { JobStatus, ThreadState, SpecType } from '@ifi/shared';
import {
  getOctokitForRepo,
  ensureBranch,
  createOrUpdateFile,
  createPullRequest,
  mcp,
} from '@ifi/integrations';

// Configuration
const intervalMs = Number(process.env.WORKER_POLL_MS || 3000);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
// Heartbeat config
const startedAt = Date.now();
const HEARTBEAT_KEY =
  process.env.WORKER_HEARTBEAT_KEY || 'ifi:worker:heartbeat';
let timer: any;
let stopping = false;

// Redis setup
const publisher = new Redis(REDIS_URL);

// Helper to publish events to Redis
function publish(channel: string, event: string, data: any) {
  const payload = JSON.stringify({ event, data });
  return publisher.publish(channel, payload);
}

// Update Redis heartbeat so other services can check liveness
async function updateHeartbeat() {
  try {
    const now = Date.now();
    const payload = {
      ts: now,
      startedAt,
      uptimeMs: now - startedAt,
      pid: process.pid,
    };
    // TTL 60s ensures key expires if worker dies
    await publisher.set(
      HEARTBEAT_KEY,
      JSON.stringify(payload),
      'EX',
      60
    );
  } catch (err) {
    console.error('[worker] Heartbeat error:', err);
  }
}

// Helper to derive feature branch name
function deriveFeatureBranch(job: any): string {
  // Use existing branch if specified
  if (job.featureBranch) return job.featureBranch;
  
  // Otherwise create a new branch name
  const shortId = job.id.slice(0, 8);
  return `feat/autogen-${shortId}`;
}

// Process a single job
async function processJob(job: any) {
  try {
    console.log(`[worker] Processing job ${job.id} (${job.repo})`);
    
    // Get the full thread and spec details
    const thread = job.threadId 
      ? await getThread(job.threadId)
      : null;
    
    // Get spec if available
    let specContent = '';
    let specTitle = 'AI-generated changes';
    let specType = SpecType.INITIAL;
    let targetBranch = null;
    
    if (job.specId) {
      const specRecord = await prisma.spec.findUnique({ 
        where: { id: job.specId } 
      });
      
      if (specRecord) {
        specContent = specRecord.content;
        specTitle = specRecord.title;
        specType = specRecord.specType as SpecType;
        targetBranch = specRecord.targetBranch;
        console.log(`[worker] Found spec for job ${job.id} (type: ${specType})`);
      }
    }
    
    // 1. Update status to planning and publish
    await updateJob(job.id, { status: JobStatus.PLANNING });
    publish(`job:${job.id}`, 'status', { phase: 'planning' });
    publish(`job:${job.id}`, 'log', { at: 'planning', msg: 'Analyzing requirements' });
    
    // 2. Update status to codegen and publish
    await updateJob(job.id, { status: JobStatus.CODEGEN });
    publish(`job:${job.id}`, 'status', { phase: 'codegen' });
    publish(`job:${job.id}`, 'log', { at: 'codegen', msg: 'Generating code changes' });
    
    // Build instruction from spec
    let instruction = '';
    if (specContent) {
      // Add a small header mentioning the repo
      instruction = `# Implementation for ${job.repo}\n\n${specContent}`;
    } else {
      instruction = `Create a simple change for repository ${job.repo}`;
    }
    
    // Call providers.codegen to get patch text
    let patchContent = '';
    try {
      patchContent = await codegen(instruction);
      publish(`job:${job.id}`, 'diff_chunk', { chunk: patchContent });
    } catch (error) {
      console.error(`[worker] Codegen error: ${error}`);
      patchContent = `# AI-generated patch stub\n\nThis is a placeholder patch for ${job.repo}.\n\n` +
                    `# Goal: Implement requested changes\n`;
    }
    
    // 3. Update status to apply and publish
    await updateJob(job.id, { status: JobStatus.APPLY });
    publish(`job:${job.id}`, 'status', { phase: 'apply' });
    publish(`job:${job.id}`, 'log', { at: 'apply', msg: 'Applying changes to repository' });
    
    // Determine feature branch - for UPDATE specs, use the targetBranch
    const featureBranch = specType === SpecType.UPDATE && targetBranch 
      ? targetBranch 
      : deriveFeatureBranch(job);
    
    await updateJob(job.id, { featureBranch });
    
    // Use GitHub App to interact with repo
    try {
      const [owner, repo] = job.repo.split('/');
      const { octokit, installationId } = await getOctokitForRepo(job.repo);
      
      if (specType === SpecType.UPDATE && targetBranch) {
        // For UPDATE specs, checkout the existing branch
        publish(`job:${job.id}`, 'log', { 
          at: 'apply', 
          msg: `Checking out existing branch: ${targetBranch}` 
        });
        
        // Verify branch exists
        const branchExists = await mcp.branchExistsRemotely(job.repo, targetBranch);
        if (!branchExists) {
          throw new Error(`Target branch ${targetBranch} does not exist remotely`);
        }
        
        // Checkout branch locally to ensure we have the latest
        await mcp.checkoutBranch(job.repo, targetBranch);
      } else {
        // For INITIAL specs, ensure feature branch exists
        await ensureBranch(
          octokit,
          owner,
          repo,
          job.baseBranch || 'main',
          featureBranch
        );
      }
      
      publish(`job:${job.id}`, 'log', { at: 'apply', msg: `Using branch: ${featureBranch}` });
      
      // Create/update patch file
      await createOrUpdateFile({
        octokit,
        owner,
        repo,
        path: 'ai/combined_diff.patch',
        content: patchContent,
        branch: featureBranch,
        message: `AI-generated patch (${featureBranch})`,
      });
      publish(`job:${job.id}`, 'log', { at: 'apply', msg: 'Committed patch file' });
      
      // 4. Open draft PR or update existing PR
      // Extract title from first line of markdown if available
      let prTitle = `[AI] ${specTitle}`;
      
      // Simple PR body from markdown content
      const prBody = `
# AI-Generated Pull Request

${specContent || 'Implements requested changes'}

---
Generated by IFI - Job ID: ${job.id}
`;

      // Check if there's an existing PR for UPDATE specs
      let prResponse;
      let prNumber;
      let prUrl;
      let prStatus = 'draft';
      
      if (specType === SpecType.UPDATE && targetBranch) {
        // Try to find existing PR for this branch
        const prs = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
          owner,
          repo,
          head: `${owner}:${targetBranch}`,
          state: 'open'
        });
        
        if (prs.data.length > 0) {
          // Update existing PR
          const existingPr = prs.data[0];
          prNumber = existingPr.number;
          prUrl = existingPr.html_url;
          prStatus = existingPr.draft ? 'draft' : 'open';
          
          publish(`job:${job.id}`, 'log', { 
            at: 'pr_open', 
            msg: `Updating existing PR #${prNumber}` 
          });
        } else {
          // Create new PR for the update
          prResponse = await createPullRequest({
            installationId,
            owner,
            repo,
            title: prTitle,
            body: prBody,
            head: targetBranch,
            base: job.baseBranch || 'main',
            draft: true,
          });
          
          prNumber = prResponse.data.number;
          prUrl = prResponse.data.html_url;
        }
      } else {
        // Create new PR for INITIAL spec
        prResponse = await createPullRequest({
          installationId,
          owner,
          repo,
          title: prTitle,
          body: prBody,
          head: featureBranch,
          base: job.baseBranch || 'main',
          draft: true,
        });
        
        prNumber = prResponse.data.number;
        prUrl = prResponse.data.html_url;
      }
      
      // Update job with PR URL
      await updateJob(job.id, {
        status: JobStatus.PR_OPEN,
        prUrl,
      });
      
      // 5. Publish PR details
      publish(`job:${job.id}`, 'status', { phase: 'pr_open' });
      publish(`job:${job.id}`, 'pr', {
        url: prUrl,
        number: prNumber,
        status: prStatus,
      });
      publish(`job:${job.id}`, 'log', { 
        at: 'pr_open', 
        msg: `${specType === SpecType.UPDATE ? 'Updated' : 'Draft'} PR #${prNumber}: ${prUrl}` 
      });
      
      // 6. Update thread state if this is associated with a thread
      if (thread) {
        await updateThreadState(
          thread.id, 
          ThreadState.WAITING_FOR_FEEDBACK,
          {
            currentPrBranch: featureBranch,
            currentPrUrl: prUrl
          }
        );
        
        publish(`thread:${thread.id}`, 'state_change', {
          from: thread.state,
          to: ThreadState.WAITING_FOR_FEEDBACK,
          reason: 'pr_created'
        });
      }
      
      // 7. Mark job as complete
      await updateJob(job.id, { status: JobStatus.COMPLETE });
      publish(`job:${job.id}`, 'status', { phase: 'complete' });
      publish(`job:${job.id}`, 'log', { at: 'complete', msg: 'Job completed successfully' });
      
    } catch (error: any) {
      console.error(`[worker] GitHub error: ${error.message}`);
      throw error; // Re-throw to be caught by outer try/catch
    }
    
  } catch (error: any) {
    console.error(`[worker] Job ${job.id} failed: ${error.message}`);
    
    // Update job status to failed and publish error
    await updateJob(job.id, {
      status: JobStatus.FAILED,
      error: error.message,
    });
    
    publish(`job:${job.id}`, 'status', { phase: 'failed' });
    publish(`job:${job.id}`, 'error', {
      code: 'JOB_PROCESSING_FAILED',
      message: error.message,
    });
  }
}

// Main worker tick function
async function tick() {
  if (stopping) return;
  
  try {
    // Find the next queued job
    const queuedJob = await prisma.job.findFirst({
      where: { status: JobStatus.QUEUED },
      orderBy: { createdAt: 'asc' },
    });
    
    if (queuedJob) {
      console.log(`[worker] Found queued job: ${queuedJob.id}`);
      await processJob(queuedJob);
    }
  } catch (error) {
    console.error('[worker] Error in tick:', error);
  }
}

function start() {
  console.log('[worker] starting');
  // write initial heartbeat immediately
  updateHeartbeat().then(_ => {});
  timer = setInterval(async () => {
    await updateHeartbeat();
    await tick();
  }, intervalMs);
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  
  if (timer) clearInterval(timer);
  
  // Close Redis connection
  await publisher.quit();
  
  console.log('[worker] stopped');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
