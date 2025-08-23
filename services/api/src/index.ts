import express, { Request, Response } from 'express';
import Redis from 'ioredis';
import {
  createThread,
  getThread,
  addMessage,
  getJob,
  createJob,
  updateJob,
  getLatestDraftSpec,
  upsertDraftSpec,
  finalizeSpec,
  createPullRequestRow,
  upsertDeviceToken,
  upsertUserByClerk,
} from '@ifi/db';
import { providers, plan, planStream } from '@ifi/providers';
import {
  JobStatus,
  MessageRole,
  Intent,
} from '@ifi/shared';
import { Readable } from 'stream';
// Direct Prisma client (for ad-hoc queries in this file)
import { prisma } from '@ifi/db';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Redis setup
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const publisher = new Redis(REDIS_URL);

// Helper to publish events to Redis
function publish(channel: string, event: string, data: any) {
  const payload = JSON.stringify({ event, data });
  return publisher.publish(channel, payload);
}

// Health check (back-compat)
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// GET /v1/worker/health
app.get('/v1/worker/health', async (_req: Request, res: Response) => {
  try {
    const HEARTBEAT_KEY =
      process.env.WORKER_HEARTBEAT_KEY || 'ifi:worker:heartbeat';
    const thresholdMs = Number(
      process.env.WORKER_HEALTH_THRESHOLD_MS || 15_000
    );

    // Fetch heartbeat payload
    let heartbeatRaw: string | null = null;
    try {
      heartbeatRaw = await publisher.get(HEARTBEAT_KEY);
    } catch (e) {
      // Ignore – redisOk flag will capture failures
    }

    let heartbeat: {
      ts: number;
      startedAt: number;
      uptimeMs: number;
      pid?: number;
    } | null = null;

    if (heartbeatRaw) {
      try {
        heartbeat = JSON.parse(heartbeatRaw);
      } catch {
        heartbeat = null;
      }
    }

    const now = Date.now();
    const lastTs = heartbeat?.ts ?? null;
    const healthy =
      lastTs !== null && now - lastTs <= thresholdMs ? true : false;

    // Best-effort Redis ping
    let redisOk = false;
    try {
      redisOk = (await publisher.ping()) === 'PONG';
    } catch {
      redisOk = false;
    }

    // Best-effort DB check
    let dbOk = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }

    return res.status(200).json({
      healthy,
      lastHeartbeatAt: lastTs ? new Date(lastTs).toISOString() : null,
      uptimeSeconds: heartbeat?.uptimeMs
        ? Math.floor(heartbeat.uptimeMs / 1000)
        : null,
      now: new Date(now).toISOString(),
      thresholdMs,
      redisOk,
      dbOk,
      pid: heartbeat?.pid ?? null,
    });
  } catch (err) {
    console.error('GET /v1/worker/health error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /v1/chat/messages
app.post('/v1/chat/messages', async (req: Request, res: Response) => {
  try {
    const { threadId, input } = req.body || {};
    const userId = req.headers['x-user-id'] as string;

    // If caller sets ?stream=1 or x-stream-ui=1 header → stream mode
    const streamMode =
      req.query.stream === '1' ||
      req.headers['x-stream-ui'] === '1' ||
      false;

    if (typeof input !== 'string' || !input.trim()) {
      return res.status(400).json({ error: 'input is required' });
    }

    // Create or get thread
    let thread;
    if (threadId) {
      thread = await getThread(threadId);
      if (!thread) {
        return res.status(404).json({ error: 'Thread not found' });
      }
    } else {
      // Extract a title from the first ~50 chars of input
      const title = input.substring(0, 50) + (input.length > 50 ? '...' : '');
      thread = await createThread({ title, userId });
    }

    // Save user message
    const userMessage = await addMessage({
      threadId: thread.id,
      role: 'user',
      content: input,
    });

    /* ------------------------------------------------------------------ */
    /* Stream mode: pipe UIMessageStreamResponse straight to client       */
    /* ------------------------------------------------------------------ */
    if (streamMode) {
      const stream = await planStream(input, {
        plannerModel: process.env.CODEGEN_PLANNER_MODEL || 'gpt-5',
      });

      // UIMessageStreamResponse from AI SDK
      const ui = (stream as any).toUIMessageStreamResponse();
      // copy status + headers
      res.status(ui.status || 200);
      for (const [k, v] of Object.entries(ui.headers || {})) {
        res.setHeader(k, v as string);
      }

      // Pipe body
      if (ui.body) {
        // Node18 supports Readable.fromWeb
        Readable.fromWeb(ui.body as any).pipe(res);
      } else {
        res.end();
      }
      return; // streamed response finished
    }

    /* ------------------------------------------------------------------ */
    /* Legacy JSON mode: synchronous plan, save markdown draft            */
    /* ------------------------------------------------------------------ */
    // Call planner synchronously
    const planRes = await plan(input, {
      plannerModel: process.env.CODEGEN_PLANNER_MODEL || 'gpt-5',
    });
    const assistantContent = planRes.text;

    // Save assistant message
    const assistantMessage = await addMessage({
      threadId: thread.id,
      role: 'assistant',
      content: assistantContent,
      provider: 'openai',
      tokensPrompt: input.length / 4,
      tokensCompletion: assistantContent.length / 4,
      costUsd: 0.01,
    });

    // Build markdown draft spec (title + plan)
    const title = input.substring(0, 80);
    const draftMd = `# ${title}\n\n${assistantContent}`;
    await upsertDraftSpec(thread.id, { title, content: draftMd });

    return res.status(200).json({
      threadId: thread.id,
      messageId: assistantMessage.id,
    });
  } catch (err) {
    console.error('POST /v1/chat/messages error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /v1/specs/:threadId/finalize
app.post('/v1/specs/:threadId/finalize', async (req: Request, res: Response) => {
  try {
    const { threadId } = req.params;
    const { confirm, repo, baseBranch = 'main', featureBranch } = req.body || {};
    
    if (!confirm) {
      return res.status(400).json({ error: 'confirmation required' });
    }
    if (typeof repo !== 'string' || repo.trim() === '') {
      return res.status(400).json({ error: 'repo is required' });
    }

    // Get latest draft spec
    const draftSpec = await getLatestDraftSpec(threadId);
    if (!draftSpec) {
      return res.status(404).json({ error: 'No draft spec found' });
    }

    // Finalize spec (mark as ready)
    const finalizedSpec = await finalizeSpec(threadId);

    // Create a job
    const job = await createJob({
      threadId,
      specId: finalizedSpec.id,
      status: JobStatus.QUEUED,
      repo,
      baseBranch,
      featureBranch,
    });

    return res.status(200).json({ jobId: job.id });
  } catch (err) {
    console.error('POST /v1/specs/:threadId/finalize error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /v1/jobs/:id
app.get('/v1/jobs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const job = await getJob(id);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Get latest PR if any
    const pr = await prisma.pullRequest.findFirst({
      where: { jobId: id },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      ...job,
      pr: pr ? {
        url: pr.url,
        number: pr.prNumber,
        status: pr.status,
      } : undefined,
    });
  } catch (err) {
    console.error('GET /v1/jobs/:id error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /v1/notifications/device-token
app.post('/v1/notifications/device-token', async (req: Request, res: Response) => {
  try {
    const { token, platform = 'ios' } = req.body || {};
    const userId = req.body.userId || req.headers['x-user-id'] as string;

    if (!token || !userId) {
      return res.status(400).json({ error: 'token and userId are required' });
    }

    if (platform !== 'ios') {
      return res.status(400).json({ error: 'only ios platform is supported in Iteration 1' });
    }

    await upsertDeviceToken({
      userId,
      platform: 'ios',
      token,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('POST /v1/notifications/device-token error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /v1/webhooks/github
app.post('/v1/webhooks/github', async (req: Request, res: Response) => {
  try {
    // For Iteration 1, we'll skip signature verification
    // TODO: Add signature verification using GITHUB_WEBHOOK_SECRET

    const event = req.headers['x-github-event'] as string;
    const { action, pull_request, repository } = req.body || {};

    // Only handle pull_request events
    if (event !== 'pull_request' || !pull_request || !repository) {
      return res.status(200).json({ message: 'Event ignored' });
    }

    // Only handle opened or synchronize actions
    if (action !== 'opened' && action !== 'synchronize') {
      return res.status(200).json({ message: 'Action ignored' });
    }

    // Find job by branch name
    const headBranch = pull_request.head.ref;
    const baseBranch = pull_request.base.ref;
    const repoFullName = repository.full_name;

    const job = await prisma.job.findFirst({
      where: {
        repo: repoFullName,
        featureBranch: headBranch,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!job) {
      return res.status(200).json({ message: 'No matching job found' });
    }

    // Create or update PR record
    const prStatus = pull_request.draft ? 'draft' : 'open';
    
    await createPullRequestRow({
      jobId: job.id,
      repo: repoFullName,
      prNumber: pull_request.number,
      url: pull_request.html_url,
      status: prStatus,
      headBranch,
      baseBranch,
    });

    // Update job status if needed
    if (job.status !== JobStatus.PR_OPEN) {
      await updateJob(job.id, {
        status: JobStatus.PR_OPEN,
        prUrl: pull_request.html_url,
      });
    }

    // Publish PR event
    publish(`job:${job.id}`, 'pr', {
      url: pull_request.html_url,
      number: pull_request.number,
      status: prStatus,
    });

    // TODO: Send push notification to device tokens
    // This will be implemented in a separate PR

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('POST /v1/webhooks/github error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Default route
app.get('*', (_req: Request, res: Response) => {
  res.status(200).json({ message: 'IFI API' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API server running at http://0.0.0.0:${PORT}`);
});
