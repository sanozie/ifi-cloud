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

// Helper: convert ModelMessage[] to UIMessage[] for client consumption (preserve parts)
function convertModelMessagesToUIMessages(messages: ModelMessage[] | null | undefined): UIMessage[] {
  if (!messages || !Array.isArray(messages)) return [];

  const inferMediaTypeFromUrl = (url?: string): string | undefined => {
    if (!url) return undefined;
    const lower = url.toLowerCase();
    if (lower.match(/\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?|$)/)) return 'image/' + (lower.split('.').pop()!.split('?')[0]);
    if (lower.match(/\.(mp4|webm|mov)(\?|$)/)) return 'video/' + (lower.split('.').pop()!.split('?')[0]);
    if (lower.match(/\.(mp3|wav|m4a|ogg)(\?|$)/)) return 'audio/' + (lower.split('.').pop()!.split('?')[0]);
    if (lower.match(/\.(pdf)(\?|$)/)) return 'application/pdf';
    if (lower.match(/\.(txt|md)(\?|$)/)) return 'text/plain';
    return undefined;
  };

  const toParts = (content: any): any[] => {
    // UIMessage parts array
    const parts: any[] = [];

    if (content == null) return parts;

    if (typeof content === 'string') {
      parts.push({ type: 'text', text: content });
      return parts;
    }

    if (!Array.isArray(content)) {
      // Unknown structure -> stringify as text
      try {
        parts.push({ type: 'text', text: JSON.stringify(content) });
      } catch {
        parts.push({ type: 'text', text: String(content) });
      }
      return parts;
    }

    for (const p of content) {
      if (!p || typeof p !== 'object') continue;

      // Text-like
      if (typeof (p as any).text === 'string' && ((p as any).type === undefined || (p as any).type === 'text')) {
        parts.push({ type: 'text', text: (p as any).text });
        continue;
      }

      // Image/File-like
      if ((p as any).type === 'image' || (p as any).type === 'file') {
        const url = (p as any).url || (p as any).image_url || (p as any).image?.url || (p as any).data?.url;
        const mediaType = (p as any).mediaType || (p as any).mimeType || inferMediaTypeFromUrl(url) || 'application/octet-stream';
        const filename = (p as any).name || (p as any).filename;
        if (typeof url === 'string') {
          parts.push({ type: 'file', mediaType, filename, url });
          continue;
        }
      }

      // Tool call (assistant requesting a tool)
      if ((p as any).type === 'tool-call' || (p as any).toolName && (p as any).toolCallId && (p as any).args !== undefined) {
        const toolName = (p as any).toolName || 'unknown';
        const toolCallId = (p as any).toolCallId || (p as any).id || `${toolName}-${Math.random().toString(36).slice(2)}`;
        const input = (p as any).args ?? {};
        parts.push({
          type: `tool-${toolName}`,
          toolCallId,
          state: 'input-available',
          input,
        });
        continue;
      }

      // Tool result (result from tool execution)
      if ((p as any).type === 'tool-result' || (p as any).toolName && (p as any).toolCallId && ((p as any).result !== undefined || (p as any).error !== undefined)) {
        const toolName = (p as any).toolName || 'unknown';
        const toolCallId = (p as any).toolCallId || (p as any).id || `${toolName}-${Math.random().toString(36).slice(2)}`;
        const output = (p as any).result ?? (p as any).output;
        const errorText = (p as any).errorText ?? ((p as any).error ? String((p as any).error) : undefined);
        if (errorText) {
          parts.push({
            type: `tool-${toolName}`,
            toolCallId,
            state: 'output-error',
            input: (p as any).args ?? {},
            errorText,
          });
        } else {
          parts.push({
            type: `tool-${toolName}`,
            toolCallId,
            state: 'output-available',
            input: (p as any).args ?? {},
            output,
          });
        }
        continue;
      }

      // Fallback: stringify unknown part
      try {
        parts.push({ type: 'text', text: JSON.stringify(p) });
      } catch {
        parts.push({ type: 'text', text: String(p) });
      }
    }

    return parts;
  };

  return messages
    .filter((m: any) => !!m)
    .map((m: any) => {
      let role: 'system' | 'user' | 'assistant' = m.role;
      // UIMessage does not have a 'tool' role; map tool messages to assistant with tool parts
      if (m.role === 'tool') {
        role = 'assistant';
      }
      return {
        id: m.id ?? undefined,
        role,
        parts: toParts(m.content),
      } as UIMessage;
    });
}

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

    let { threadId, messages }: { threadId: string, messages: UIMessage[] } = req.body || {};

    // Sanitize incoming UI messages: drop unsupported tool part states before conversion
    const sanitizeUIMessages = (msgs: UIMessage[] | undefined): UIMessage[] => {
      if (!Array.isArray(msgs)) return [];
      return msgs.map((m: any) => {
        const parts = Array.isArray(m?.parts)
          ? m.parts.filter((p: any) => {
              if (!p || typeof p !== 'object') return true;
              const t = (p as any).type;
              const s = (p as any).state;
              if (typeof t === 'string' && t.startsWith('tool-')) {
                // Remove tool parts that represent pending/input-only calls not supported by converter
                if (s === 'input-available' || s === 'input-streaming') return false;
              }
              return true;
            })
          : m?.parts;
        return { ...m, parts };
      });
    };

    const sanitizedMessages = sanitizeUIMessages(messages);
    const modelMessages = convertToModelMessages(sanitizedMessages as any);

    // Create or get a thread
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
      threadId = thread.id;
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
        // Convert stored model messages to UI messages for the client
        chat: convertModelMessagesToUIMessages(thread.chat as unknown as ModelMessage[])
      };

    console.log(`[thread] ▶️  Returning thread ${id}`)
    return res.status(200).json(payload);
  } catch (err) {
    console.error('GET /v1/threads/:id error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PUT /v1/thread/:id – update thread title
app.put('/v1/thread/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title } = req.body || {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Invalid title' });
    }

    const updated = await prisma.thread.update({
      where: { id },
      data: { title: title.trim() },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });

    return res.status(200).json(updated);
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Thread not found' });
    }
    console.error('PUT /v1/thread/:id error:', err);
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
