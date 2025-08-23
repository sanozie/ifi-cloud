import Redis from 'ioredis';
import {
  prisma,
  getJob,
  updateJob,
  createPullRequestRow,
} from '@ifi/db';
import { providers } from '@ifi/providers';
import { JobStatus, ImplementationSpec } from '@ifi/shared';
import {
  getOctokitForRepo,
  ensureBranch,
  createOrUpdateFile,
  createPullRequest,
} from '@ifi/integrations/github';

// Configuration
const intervalMs = Number(process.env.WORKER_POLL_MS || 3000);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
let timer: any;
let stopping = false;

// Redis setup
const publisher = new Redis(REDIS_URL);

// Helper to publish events to Redis
function publish(channel: string, event: string, data: any) {
  const payload = JSON.stringify({ event, data });
  return publisher.publish(channel, payload);
}

// Helper to derive feature branch name
function deriveFeatureBranch(job: any, spec?: any): string {
  // Use existing branch if specified
  if (job.featureBranch) return job.featureBranch;
  
  // Otherwise create a new branch name
  const featureName = spec?.featureName || 'autogen';
  const shortId = job.id.slice(0, 8);
  return `feat/${featureName}-${shortId}`;
}

// Process a single job
async function processJob(job: any) {
  try {
    console.log(`[worker] Processing job ${job.id} (${job.repo})`);
    
    // 1. Update status to planning and publish
    await updateJob(job.id, { status: JobStatus.PLANNING });
    publish(`job:${job.id}`, 'status', { phase: 'planning' });
    publish(`job:${job.id}`, 'log', { at: 'planning', msg: 'Analyzing requirements' });
    
    // Get spec if available
    let spec: ImplementationSpec | null = null;
    if (job.specId) {
      const specRecord = await prisma.spec.findUnique({ where: { id: job.specId } });
      if (specRecord) {
        spec = specRecord.specJson as unknown as ImplementationSpec;
        console.log(`[worker] Found spec for job ${job.id}`);
      }
    }
    
    // 2. Update status to codegen and publish
    await updateJob(job.id, { status: JobStatus.CODEGEN });
    publish(`job:${job.id}`, 'status', { phase: 'codegen' });
    publish(`job:${job.id}`, 'log', { at: 'codegen', msg: 'Generating code changes' });
    
    // Build instruction from spec
    let instruction = '';
    if (spec) {
      instruction = `
Goal: ${spec.goal}

Deliverables:
${spec.deliverables.map(d => `- ${d.type}: ${d.desc}`).join('\n')}

Constraints:
${spec.constraints.map((c: any) => `- ${c}`).join('\n')}

Acceptance Criteria:
${spec.acceptanceCriteria.map((ac: any) => `- ${ac}`).join('\n')}

File Targets:
${spec.fileTargets.map((ft: any) => `- ${ft.path}: ${ft.reason}`).join('\n')}
`;
    } else {
      instruction = `Create a simple change for repository ${job.repo}`;
    }
    
    // Call providers.codegen to get patch text
    let patchContent = '';
    try {
      patchContent = await providers.codegen(instruction);
      publish(`job:${job.id}`, 'diff_chunk', { chunk: patchContent });
    } catch (error) {
      console.error(`[worker] Codegen error: ${error}`);
      patchContent = `# AI-generated patch stub\n\nThis is a placeholder patch for ${job.repo}.\n\n` +
                    `# Goal: ${spec?.goal || 'Implement requested changes'}\n`;
    }
    
    // 3. Update status to apply and publish
    await updateJob(job.id, { status: JobStatus.APPLY });
    publish(`job:${job.id}`, 'status', { phase: 'apply' });
    publish(`job:${job.id}`, 'log', { at: 'apply', msg: 'Applying changes to repository' });
    
    // Determine feature branch
    const featureBranch = deriveFeatureBranch(job, spec);
    await updateJob(job.id, { featureBranch });
    
    // Use GitHub App to interact with repo
    try {
      const [owner, repo] = job.repo.split('/');
      const { octokit, installationId } = await getOctokitForRepo(job.repo);
      
      // Ensure feature branch exists
      await ensureBranch(
        octokit,
        owner,
        repo,
        job.baseBranch || 'main',
        featureBranch
      );
      publish(`job:${job.id}`, 'log', { at: 'apply', msg: `Using branch: ${featureBranch}` });
      
      // Create/update patch file
      await createOrUpdateFile({
        octokit,
        owner,
        repo,
        path: 'ai/combined_diff.patch',
        content: patchContent,
        branch: featureBranch,
        message: `feat(${spec?.featureName || 'autogen'}): AI-generated patch`,
      });
      publish(`job:${job.id}`, 'log', { at: 'apply', msg: 'Committed patch file' });
      
      // 4. Open draft PR
      const prTitle = `[feat] ${spec?.goal || 'AI-generated changes'}`;
      const prBody = `
# AI-Generated Pull Request

${spec?.goal || 'Implements requested changes'}

## Acceptance Criteria
${spec?.acceptanceCriteria.map(ac => `- [ ] ${ac}`).join('\n') || '- [ ] Code works as expected'}

## Risk Notes
${spec?.riskNotes.map(rn => `- ${rn}`).join('\n') || 'No specific risks identified'}

## Test Plan
${spec?.testPlan ? `Strategy: ${spec.testPlan.strategy}\nCommands: ${spec.testPlan.commands.join('\n')}` : 'Manual testing required'}

---
Generated by IFI - Job ID: ${job.id}
`;

      const prResponse = await createPullRequest({
        installationId,
        owner,
        repo,
        title: prTitle,
        body: prBody,
        head: featureBranch,
        base: job.baseBranch || 'main',
        draft: true,
      });
      
      // Extract PR details
      const prNumber = prResponse.data.number;
      const prUrl = prResponse.data.html_url;
      
      // Update job with PR URL
      await updateJob(job.id, {
        status: JobStatus.PR_OPEN,
        prUrl,
      });
      
      // Create PR record
      await createPullRequestRow({
        jobId: job.id,
        repo: job.repo,
        prNumber,
        url: prUrl,
        status: 'draft',
        headBranch: featureBranch,
        baseBranch: job.baseBranch || 'main',
      });
      
      // 5. Publish PR details
      publish(`job:${job.id}`, 'status', { phase: 'pr_open' });
      publish(`job:${job.id}`, 'pr', {
        url: prUrl,
        number: prNumber,
        status: 'draft',
      });
      publish(`job:${job.id}`, 'log', { at: 'pr_open', msg: `Draft PR #${prNumber} opened: ${prUrl}` });
      
      // 6. Mark job as complete
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
  timer = setInterval(async () => {
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
