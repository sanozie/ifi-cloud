import express, { Request, Response } from 'express';
import Redis from 'ioredis';
import {
  createThread,
  getThread,
  saveThread,
  getJob,
  getThreadSpecs,
  updateThreadState,
  createUpdateSpec, getThreads,
} from '@ifi/db'
import {
  plan,
} from '@ifi/providers';
import { ThreadState } from '@ifi/shared';
import { convertToModelMessages, type UIMessage } from 'ai'

// Direct Prisma client (for ad-hoc queries in this file)
import { prisma } from '@ifi/db';
import type { ModelMessage } from 'ai'

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use((req, res, next) => {
  // Skip CORS for health check endpoints that Render needs
  if (req.path === '/api/health' || req.path === '/v1/worker/health') {
    return next();
  }

  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

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
    console.log("[chat] ▶️  Incoming /v1/chat/messages");

    const { threadId, messages }: { threadId: string, messages: UIMessage[] } = req.body || {};
    const modelMessages = convertToModelMessages(messages);

    // Create or get thread
    let thread;
    if (threadId) {
      thread = await getThread(threadId);
      if (!thread) {
        console.log(`[chat] 🔎 Thread not found: ${threadId}`);
        return res.status(404).json({ error: 'Thread not found' });
      }
      console.log(`[chat] 📂 Loaded existing thread ${threadId}`);
    } else {
      const title = 'Sample title until i summarize later'
      thread = await createThread({ title, chat: modelMessages });
      console.log(
        `[chat] 🆕 Created new thread ${thread.id} with title="${title}"`,
      );
    }

    // Pass prior messages to retain context (exclude the one we just added)
    const stream = await plan({ messages: modelMessages, onFinish: async (result) => {
      await saveThread({ threadId, chat: [...modelMessages, ...result.response.messages ]})
    }});

    console.log("[chat] ✅ plan() resolved");

    stream.pipeUIMessageStreamToResponse(res)
  } catch (err: any) {
    console.error("[chat] 🛑 Error handling chat request:", err.message);
    return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
  }
});

// ---------------------------------------------------------------------------
// Thread management endpoints (used by iOS client)
// ---------------------------------------------------------------------------

// GET /v1/threads – list all threads with last-message preview
app.get('/v1/threads', async (_req: Request, res: Response) => {
  console.log(`[threads] ▶️  Incoming /v1/threads`);
  try {
    console.log(`[threads] 📂 Loaded existing threads`);
    const threads = await getThreads()

    const payload = threads.map((t) => ({
      id: t.id,
      title: t.title,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));

    console.log(`[threads] 📂 returning ${payload.length} threads`);
    return res.status(200).json(payload);
  } catch (err) {
    console.error('GET /v1/threads error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /v1/threads/:id – full thread with messages
app.get('/v1/thread/:id', async (req: Request, res: Response) => {
  console.log(`[thread] ▶️  Incoming /v1/threads/:id`);
  try {
    const { id } = req.params;
    console.log(`[thread] ▶️  Requesting thread ${id}`)
    const thread = await getThread(id);

    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    // Return only the fields expected by the iOS client
    const payload = {
      id: thread.id,
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      chat: thread.chat
    };

    console.log(`[thread] ▶️  Returning thread ${id}`)
    return res.status(200).json(payload);
  } catch (err) {
    console.error('GET /v1/threads/:id error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE /v1/threads/:id – delete thread and its messages
app.delete('/v1/thread/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify existence first
    const existing = await prisma.thread.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    await prisma.thread.delete({
      where: { id },
    });

    return res.status(204).send();
  } catch (err) {
    console.error('DELETE /v1/threads/:id error:', err);
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

    return res.status(200).json({
      ...job,
    });
  } catch (err) {
    console.error('GET /v1/jobs/:id error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/* ------------------------------------------------------------------ */
/*  Multi-spec workflow endpoints (no branch checkout API)            */
/* ------------------------------------------------------------------ */

// GET /v1/threads/:id/specs – list all specs for a thread
app.get('/v1/threads/:id/specs', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const specs = await getThreadSpecs(id);
    return res.status(200).json(specs);
  } catch (err) {
    console.error('GET /v1/threads/:id/specs error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /v1/threads/:id/specs – create an UPDATE spec
app.post('/v1/threads/:id/specs', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, content, targetBranch } = req.body || {};

    if (!title || !content || !targetBranch) {
      return res
        .status(400)
        .json({ error: 'title, content, and targetBranch are required' });
    }

    const spec = await createUpdateSpec({
      threadId: id,
      title,
      content,
      targetBranch,
    });

    return res.status(201).json(spec);
  } catch (err) {
    console.error('POST /v1/threads/:id/specs error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /v1/threads/:id/transition – change thread lifecycle state
app.post('/v1/threads/:id/transition', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { state, currentPrBranch, currentPrUrl } = req.body || {};

    if (!state || !Object.values(ThreadState).includes(state)) {
      return res.status(400).json({ error: 'Invalid or missing state' });
    }

    const thread = await updateThreadState(id, state, {
      currentPrBranch,
      currentPrUrl,
    });

    return res.status(200).json(thread);
  } catch (err) {
    console.error('POST /v1/threads/:id/transition error:', err);
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
