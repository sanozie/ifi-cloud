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
import { providers, plan } from '@ifi/providers';
import {
  JobStatus,
  MessageRole,
  ImplementationSpec,
  ChatSSEEventPayload,
  JobSSEEventPayload,
  Intent,
} from '@ifi/shared';
// Direct Prisma client (for ad-hoc queries in this file)
import { prisma } from '@ifi/db';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Redis setup
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const publisher = new Redis(REDIS_URL);
const getSubscriber = () => new Redis(REDIS_URL);

// Helper to publish events to Redis
function publish(channel: string, event: string, data: any) {
  const payload = JSON.stringify({ event, data });
  return publisher.publish(channel, payload);
}

// Helper to set up SSE response
function setupSSE(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial comment to keep connection alive
  res.write(':ok\n\n');

  // Handle client disconnect
  req.on('close', () => {
    res.end();
  });

  return res;
}

// Simple spec completeness scoring
function scoreSpecCompleteness(spec: Partial<ImplementationSpec>): { score: number; missing: string[] } {
  const requiredFields = [
    'goal', 'repo', 'baseBranch', 'branchPolicy', 'featureName',
    'deliverables', 'constraints', 'acceptanceCriteria', 'fileTargets'
  ];
  
  const missing = requiredFields.filter(field => !spec[field as keyof ImplementationSpec]);
  
  // Additional checks for array fields
  if (spec.deliverables && spec.deliverables.length === 0) missing.push('deliverables (empty)');
  if (spec.acceptanceCriteria && spec.acceptanceCriteria.length < 2) missing.push('acceptanceCriteria (need >=2)');
  if (spec.fileTargets && spec.fileTargets.length === 0) missing.push('fileTargets (empty)');
  
  // Calculate score - basic version
  const score = Math.max(0, Math.min(1, 1 - (missing.length / (requiredFields.length + 3))));
  
  return { score, missing };
}

// Health check (back-compat)
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// POST /v1/chat/messages
app.post('/v1/chat/messages', async (req: Request, res: Response) => {
  try {
    const { threadId, input, repo } = req.body || {};
    const userId = req.headers['x-user-id'] as string;

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

    // Publish status update
    publish(`thread:${thread.id}`, 'status', { state: 'thinking' });

    // Call planner with Vercel-AI tools (includes MCP GitHub suggestions)
    const planRes = await plan(input, {
      plannerModel: process.env.CODEGEN_PLANNER_MODEL || 'gpt-5',
    });
    const assistantContent = planRes.text;
    const mcpSuggestions = planRes.suggestions || { repos: [], prs: [] };

    const repoCandidate =
      !repo && mcpSuggestions.repos.length > 0
        ? mcpSuggestions.repos[0].fullName
        : repo;

    // Save assistant message
    const assistantMessage = await addMessage({
      threadId: thread.id,
      role: 'assistant',
      content: assistantContent,
      provider: 'openai',
      // In a real implementation, we'd track tokens and cost
      tokensPrompt: input.length / 4, // Crude approximation
      tokensCompletion: assistantContent.length / 4,
      costUsd: 0.01, // Placeholder
    });

    // Derive a naive spec from input and repo
    let spec: Partial<ImplementationSpec> = {
      goal: input,
      repo: repoCandidate || 'sanozie/ifi',
      baseBranch: 'main',
      branchPolicy: { mode: 'new_branch' },
      featureName: `feature-${Date.now()}`,
      deliverables: [{ type: 'code', desc: input }],
      constraints: [],
      acceptanceCriteria: ['Code should work as described'],
      riskNotes: [],
      fileTargets: [],
      completenessScore: 0
    };

    // Score completeness
    const { score, missing } = scoreSpecCompleteness(spec);
    spec.completenessScore = score;

    // Save draft spec
    await upsertDraftSpec(thread.id, spec);

    // Determine intent based on completeness
    const intent: Intent = score >= 0.9 ? 'ready_to_codegen' : 'needs_more_info';

    // Publish events
    publish(`thread:${thread.id}`, 'status', { state: 'idle' });
    publish(`thread:${thread.id}`, 'assistant_message', { id: assistantMessage.id, content: assistantMessage.content });
    publish(`thread:${thread.id}`, 'spec_updated', { completenessScore: score, missing });
    // Publish MCP context suggestions
    publish(`thread:${thread.id}`, 'assistant_context', {
      repos: mcpSuggestions.repos,
      prs: mcpSuggestions.prs,
    });
    publish(`thread:${thread.id}`, 'intent', { type: intent });

    return res.status(200).json({ 
      threadId: thread.id, 
      messageId: assistantMessage.id 
    });
  } catch (err) {
    console.error('POST /v1/chat/messages error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /v1/chat/threads/:threadId/stream (SSE)
app.get('/v1/chat/threads/:threadId/stream', (req: Request, res: Response) => {
  try {
    const { threadId } = req.params;
    if (!threadId) {
      return res.status(400).json({ error: 'threadId is required' });
    }

    const sseRes = setupSSE(req, res);
    const subscriber = getSubscriber();
    const channel = `thread:${threadId}`;

    subscriber.subscribe(channel);
    subscriber.on('message', (chan, message) => {
      if (chan !== channel) return;
      
      try {
        const { event, data } = JSON.parse(message) as ChatSSEEventPayload;
        sseRes.write(`event: ${event}\n`);
        sseRes.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (e) {
        console.error('Error parsing SSE message:', e);
      }
    });

    // Clean up on close
    req.on('close', () => {
      subscriber.unsubscribe(channel);
      subscriber.quit();
    });
  } catch (err) {
    console.error('GET /v1/chat/threads/:threadId/stream error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /v1/specs/:threadId/finalize
app.post('/v1/specs/:threadId/finalize', async (req: Request, res: Response) => {
  try {
    const { threadId } = req.params;
    const { confirm } = req.body || {};
    
    if (!confirm) {
      return res.status(400).json({ error: 'confirmation required' });
    }

    // Get latest draft spec
    const draftSpec = await getLatestDraftSpec(threadId);
    if (!draftSpec) {
      return res.status(404).json({ error: 'No draft spec found' });
    }

    // Parse and validate spec
    // Cast through `unknown` first to satisfy TypeScript’s structural checks
    const spec = draftSpec.specJson as unknown as ImplementationSpec;
    if (spec.completenessScore < 0.9) {
      return res.status(400).json({ 
        error: 'Spec not complete enough', 
        score: spec.completenessScore,
        missing: scoreSpecCompleteness(spec).missing
      });
    }

    // Finalize spec (mark as ready)
    const finalizedSpec = await finalizeSpec(threadId);

    // Create a job
    const job = await createJob({
      threadId,
      specId: finalizedSpec.id,
      status: JobStatus.QUEUED,
      repo: spec.repo,
      baseBranch: spec.baseBranch,
      featureBranch: spec.branchPolicy.mode === 'existing' ? spec.branchPolicy.name : undefined,
    });

    // Publish job queued event
    publish(`job:${job.id}`, 'status', { phase: 'queued' });

    return res.status(200).json({ jobId: job.id });
  } catch (err) {
    console.error('POST /v1/specs/:threadId/finalize error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /v1/codegen/jobs
app.post('/v1/codegen/jobs', async (req: Request, res: Response) => {
  try {
    const { threadId, specId, repo, baseBranch, branchPolicy, dryRun } = req.body || {};
    const userId = req.headers['x-user-id'] as string;

    if (!threadId || !repo) {
      return res.status(400).json({ error: 'threadId and repo are required' });
    }

    // For Iteration 1, dryRun must be false
    if (dryRun !== false) {
      return res.status(400).json({ error: 'dryRun must be false for Iteration 1' });
    }

    // Get spec if specId provided, otherwise use latest ready spec
    let specToUse = specId;
    if (!specId) {
      const readySpec = await prisma.spec.findFirst({
        where: { threadId, status: 'ready' },
        orderBy: { createdAt: 'desc' },
      });
      if (!readySpec) {
        return res.status(404).json({ error: 'No ready spec found for thread' });
      }
      specToUse = readySpec.id;
    }

    // Create job
    const job = await createJob({
      userId,
      threadId,
      specId: specToUse,
      status: JobStatus.QUEUED,
      repo,
      baseBranch: baseBranch || 'main',
      featureBranch: branchPolicy?.mode === 'existing' ? branchPolicy.name : undefined,
    });

    // Publish job queued event
    publish(`job:${job.id}`, 'status', { phase: 'queued' });
    publish(`job:${job.id}`, 'log', { at: 'queued', msg: 'Job created and queued for processing' });

    return res.status(200).json({ jobId: job.id });
  } catch (err) {
    console.error('POST /v1/codegen/jobs error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /v1/jobs/:id/stream (SSE)
app.get('/v1/jobs/:id/stream', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'job id is required' });
    }

    const sseRes = setupSSE(req, res);
    const subscriber = getSubscriber();
    const channel = `job:${id}`;

    subscriber.subscribe(channel);
    subscriber.on('message', (chan, message) => {
      if (chan !== channel) return;
      
      try {
        const { event, data } = JSON.parse(message) as JobSSEEventPayload;
        sseRes.write(`event: ${event}\n`);
        sseRes.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (e) {
        console.error('Error parsing SSE message:', e);
      }
    });

    // Clean up on close
    req.on('close', () => {
      subscriber.unsubscribe(channel);
      subscriber.quit();
    });
  } catch (err) {
    console.error('GET /v1/jobs/:id/stream error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
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

// Legacy endpoint (back-compat)
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { message, context } = req.body || {};

    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ message: 'message is required' });
    }

    // Determine repo (optional context)
    const repo = (context && typeof context.repo === 'string' && context.repo.trim())
      ? context.repo
      : 'sanozie/ifi';

    // Create a queued job
    const job = await createJob({
      status: JobStatus.QUEUED,
      repo,
    });

    // Minimal response expected by client
    return res.status(200).json({ jobId: job.id, reply: null });
  } catch (err) {
    console.error('POST /api/chat error:', err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Legacy endpoint (back-compat)
app.get('/api/jobs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const job = await getJob(id);
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }
    return res.status(200).json(job);
  } catch (err) {
    console.error('GET /api/jobs/:id error:', err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Default route
app.get('*', (_req: Request, res: Response) => {
  res.status(200).json({ message: 'IFI API' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API server running at http://0.0.0.0:${PORT}`);
});
