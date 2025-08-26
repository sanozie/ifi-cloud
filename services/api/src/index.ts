import express, { Request, Response } from 'express';
import Redis from 'ioredis';
import {
  createThread,
  getThread,
  addMessage,
  getJob,
  /* multi-spec helpers */
  getActiveThread,
  getThreadSpecs,
  updateThreadState,
  createUpdateSpec,
  upsertDeviceToken,
} from '@ifi/db';
import {
  plan,
} from '@ifi/providers';

/* Thread state enum */
import { ThreadState } from '@ifi/shared';

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
    console.log("[chat] ▶️  Incoming /v1/chat/messages");

    const { threadId, input } = req.body || {};

    if (typeof input !== 'string' || !input.trim()) {
      console.log(
        `[chat] ❌ Validation failed – missing input string`,
      );
      return res.status(400).json({ error: 'input is required' });
    }

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
      // Extract a title from the first ~50 chars of input
      const title = input.substring(0, 50) + (input.length > 50 ? '...' : '');
      thread = await createThread({ title });
      console.log(
        `[chat] 🆕 Created new thread ${thread.id} with title="${title}"`,
      );
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

    console.log(
      `[chat] 💬 Built context with ${messages.length} previous message(s)`,
    );

    // Save user message
    await addMessage({
      threadId: thread.id,
      role: 'user',
      content: input,
    });

    console.log(`[chat] 📝 Saved user message, calling plan() ...`);

    // Pass prior messages to retain context (exclude the one we just added)
    const stream = await plan(input, messages, async (response) => {
      // -------------------------------------------------------------
      //  STREAM CALLBACK – fires for *each* chunk/tool call returned
      // -------------------------------------------------------------
      console.log("[chat] 📡 Stream callback invoked");

      if (response.text) {
        try {
          console.log(`[chat] 💾 Saving assistant message (threadId=${thread.id})`);
          await addMessage({
            threadId: thread.id,
            role: 'assistant',
            content: response.text + '\n' + response.content,
            tokensPrompt: response.usage?.inputTokens,
            tokensCompletion: response.usage?.outputTokens,
            costUsd: response.usage?.totalTokens ? response.usage.totalTokens * 0.00001 : undefined, // Adjust cost calculation as needed
          });
          console.log(`[chat] ✅ Assistant message saved successfully`);
        } catch (error) {
          console.error('Error saving assistant message:', error);
        }
      }
    });

    console.log("[chat] ✅ plan() resolved");

    /* ------------------------------------------------------------------
     *  STREAM RESPONSE – forward AI chunks to the client (Express)
     * ------------------------------------------------------------------ */

    console.log("[chat] 📡 Setting up streaming response to client");

    // Standard text-stream headers for iOS / curl consumption
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    try {
      // Convert the SDK stream to a web Response and get its reader
      const textResp = stream.toTextStreamResponse();
      const reader = textResp.body?.getReader();

      if (!reader) {
        throw new Error('Readable stream not available from provider');
      }

      console.log('[chat] 🔄 Streaming chunks to client …');

      // Continuously read chunks and pipe to Express response
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[chat] ✅ Stream complete');
          break;
        }
        if (value) {
          const chunk = new TextDecoder().decode(value);
          console.log(`[chat] 📤 Sending chunk (${chunk.length} chars)`);
          res.write(chunk);
        }
      }
    } catch (streamErr: any) {
      console.error('[chat] ❌ Stream forwarding error:', streamErr);
      res.write(`error: ${streamErr.message}\n`);
    }

    // Always end the response
    console.log('[chat] 🏁 Ending response stream');
    res.end();
    return; // Explicit for clarity

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
    const threads = await prisma.thread.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    const payload = threads.map((t) => ({
      id: t.id,
      title: t.title,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      lastMessage: t.messages?.[0]
        ? {
            id: t.messages[0].id,
            role: t.messages[0].role,
            content: t.messages[0].content,
            createdAt: t.messages[0].createdAt,
          }
        : null,
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
      messages: thread.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
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

// POST /v1/notifications/device-token
app.post('/v1/notifications/device-token', async (req: Request, res: Response) => {
  try {
    const { token, platform = 'web' } = req.body || {};
    const userId = req.body.userId || req.headers['x-user-id'] as string;

    if (!token || !userId) {
      return res.status(400).json({ error: 'token and userId are required' });
    }

    if (platform !== 'web') {
      return res.status(400).json({ error: 'only web platform is supported in Iteration 1' });
    }

    await upsertDeviceToken({
      userId,
      platform: 'web',
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
