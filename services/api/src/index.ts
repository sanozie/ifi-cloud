import express, { Request, Response } from 'express';
import Redis from 'ioredis';
import {
  createThread,
  getThread,
  addMessage,
  getJob,
  upsertDeviceToken,
} from '@ifi/db';
import {
  plan,
} from '@ifi/providers';

// Direct Prisma client (for ad-hoc queries in this file)
import { prisma } from '@ifi/db';
import type { ModelMessage } from 'ai'

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Redis setup
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const publisher = new Redis(REDIS_URL);

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
      lastTs !== null && now - lastTs <= thresholdMs;

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
        ? Math.floor(heartbeat?.uptimeMs / 1000)
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
      thread = await createThread({ title });
    }

    // Collect existing messages (ordered asc from getThread helper)
    // These will be used as context for the next plan() call
    const messages: ModelMessage[] = thread.messages
      ? thread.messages
          .filter(
            (m: { role: string }) =>
              ['user', 'assistant', 'system', 'tool'].includes(m.role)
          )
          .map((m: { role: string; content: string }) => ({
            // Narrow the string to the exact literal type union expected by the provider
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
          }))
      : [];

    // Save user message
    await addMessage({
      threadId: thread.id,
      role: 'user',
      content: input,
    });

    // Pass prior messages to retain context (exclude the one we just added)
    const stream = await plan(input, messages, async (response) => {
      if (threadId && response.text) {
        try {
          await addMessage({
            threadId,
            role: 'assistant',
            content: response.text + '\n' + response.content,
            tokensPrompt: response.usage?.inputTokens,
            tokensCompletion: response.usage?.outputTokens,
            costUsd: response.usage?.totalTokens ? response.usage.totalTokens * 0.00001 : undefined, // Adjust cost calculation as needed
          });
        } catch (error) {
          console.error('Error saving assistant message:', error);
        }
      }
    });

    // UIMessageStreamResponse from AI SDK
    return stream.toUIMessageStreamResponse();

  } catch (err: any) {
    console.error('POST /v1/chat/messages error:', err);
    return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
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

// Default route
app.get('*', (_req: Request, res: Response) => {
  res.status(200).json({ message: 'IFI API' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API server running at http://0.0.0.0:${PORT}`);
});
