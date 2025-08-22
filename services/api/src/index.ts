import { Elysia } from 'elysia';
import { createThread, addMessage, createJob, getJob, getThread } from '@ifi/db';
import { ChatRequest, ChatResponse, JobStatus } from '@ifi/shared';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { randomUUID } from 'crypto';
import { prisma } from '@ifi/db'; // for extension check

// Get environment variables
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const CLERK_JWKS_URL = process.env.CLERK_JWKS_URL;

// Create JWT verification middleware if CLERK_JWKS_URL is provided
const verifyJWT = async (token: string) => {
  if (!CLERK_JWKS_URL) {
    return { sub: 'anonymous', auth: false };
  }
  
  try {
    const JWKS = createRemoteJWKSet(new URL(CLERK_JWKS_URL));
    const { payload } = await jwtVerify(token, JWKS);
    return { sub: payload.sub, auth: true };
  } catch (error) {
    console.error('JWT verification failed:', error);
    throw new Error('Unauthorized');
  }
};

// Create Elysia app
const app = new Elysia()
  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 400;
      return { error: 'Bad Request', message: error.message };
    }
    
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: 'Not Found', message: 'Resource not found' };
    }
    
    if (error.message === 'Unauthorized') {
      set.status = 401;
      return { error: 'Unauthorized', message: 'Invalid or missing authentication' };
    }
    
    console.error('Server error:', error);
    set.status = 500;
    return { error: 'Internal Server Error', message: 'Something went wrong' };
  })
  .get('/api/health', () => {
    return { status: 'ok' };
  })
  .post('/api/chat', async ({ body, headers, set }) => {
    // Verify JWT if Authorization header is provided
    if (headers.authorization) {
      const token = headers.authorization.replace('Bearer ', '');
      try {
        await verifyJWT(token);
      } catch (error) {
        set.status = 401;
        return { error: 'Unauthorized', message: 'Invalid token' };
      }
    } else if (CLERK_JWKS_URL) {
      // If CLERK_JWKS_URL is set but no token is provided, return unauthorized
      set.status = 401;
      return { error: 'Unauthorized', message: 'Authentication required' };
    }
    
    // Parse request body
    const { threadId, message, context } = body as ChatRequest;
    
    // Create or get thread
    let currentThreadId = threadId;
    if (!currentThreadId) {
      const thread = await createThread('New Conversation');
      currentThreadId = thread.id;
    } else {
      // Verify thread exists
      const thread = await getThread(currentThreadId);
      if (!thread) {
        set.status = 404;
        return { error: 'Not Found', message: 'Thread not found' };
      }
    }
    
    // Add user message to thread
    await addMessage(currentThreadId, 'user', message);
    
    // Create a job with status 'queued'
    const job = await createJob({
      status: JobStatus.QUEUED,
      repo: context?.repo || '',
    });
    
    // In a real implementation, we would publish a message to Redis here
    // to notify the worker to process this job
    
    // Add assistant message with job reference
    await addMessage(currentThreadId, 'assistant', 'Processing your request...', {
      jobId: job.id,
    });
    
    // Return response with job ID
    const response: ChatResponse = {
      jobId: job.id,
      reply: 'I\'ll process your request shortly.',
    };
    
    return response;
  })
  .get('/api/jobs/:id', async ({ params, set }) => {
    const job = await getJob(params.id);
    
    if (!job) {
      set.status = 404;
      return { error: 'Not Found', message: 'Job not found' };
    }
    
    return job;
  })
  
// --- Startup ---------------------------------------------------------------

async function init() {
  try {
    // Ensure pgvector extension exists (idempotent)
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "vector"');
    console.log('✅ pgvector extension ensured');
  } catch (err) {
    console.error('❌ Failed to ensure pgvector extension:', err);
    // Continue; Prisma queries using vector type will fail without the extension
  }

  // Start HTTP server
  app.listen(PORT);
  console.log(`🚀 API server running at http://localhost:${PORT}`);
}

// Execute startup
init().catch((err) => {
  console.error('API startup failed:', err);
  process.exit(1);
});

export default app;
