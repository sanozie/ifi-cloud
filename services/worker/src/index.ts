import express from 'express';
import { prisma, updateJob } from '@ifi/db';
import { JobStatus } from '@ifi/shared';
import { Redis } from 'ioredis';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const POLL_MS = parseInt(process.env.WORKER_POLL_MS || '3000', 10);

let redisClient: Redis | null = null;

async function dbReady(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (e) {
    return false;
  }
}

async function processJob(jobId: string) {
  try {
    console.log(`🔄 Processing job ${jobId}`);
    await updateJob(jobId, { status: JobStatus.PLANNING });
    await new Promise(r => setTimeout(r, 1000));
    await updateJob(jobId, { status: JobStatus.CODEGEN });
    await new Promise(r => setTimeout(r, 1000));
    await updateJob(jobId, { status: JobStatus.APPLY });
    await new Promise(r => setTimeout(r, 800));
    await updateJob(jobId, { status: JobStatus.TEST });
    await new Promise(r => setTimeout(r, 800));
    const prUrl = `https://github.com/example/repo/pull/${Math.floor(Math.random()*1000)+1}`;
    await updateJob(jobId, { status: JobStatus.PR_OPEN, prUrl });
    await new Promise(r => setTimeout(r, 1000));
    await updateJob(jobId, { status: JobStatus.COMPLETE });
    console.log(`✅ Job ${jobId} complete`);
  } catch (err) {
    console.error(`❌ Job ${jobId} failed:`, err);
    await updateJob(jobId, { status: JobStatus.FAILED, error: (err as Error).message });
  }
}

async function pollOnce() {
  // Find oldest queued jobs
  const jobs = await prisma.job.findMany({
    where: { status: JobStatus.QUEUED },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });
  if (jobs.length) {
    console.log(`🔍 Found ${jobs.length} queued jobs`);
  }
  for (const job of jobs) {
    await processJob(job.id);
  }
}

function startRedis() {
  if (!process.env.REDIS_URL) return;
  try {
    redisClient = new Redis(process.env.REDIS_URL);
    redisClient.on('connect', () => console.log('✅ Redis connected'));
    redisClient.on('error', (e) => console.error('❌ Redis error', e));
  } catch (e) {
    console.error('❌ Redis init failed', e);
    redisClient = null;
  }
}

async function main() {
  console.log('🚀 IFI Worker starting...');
  const ready = await dbReady();
  if (!ready) {
    console.warn('⚠️ Database not reachable yet; continuing and retrying during polls');
  }

  startRedis();

  // Start health server
  const app = express();
  const startedAt = Date.now();
  app.get('/health', async (_req, res) => {
    const db = await dbReady();
    res.json({ status: 'ok', db, uptimeMs: Date.now() - startedAt });
  });
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🩺 Health at http://0.0.0.0:${PORT}/health`);
  });

  // Start polling loop
  let timer: NodeJS.Timeout | null = null;
  const loop = async () => {
    try {
      await pollOnce();
    } catch (e) {
      console.error('❌ Poll error', e);
    } finally {
      timer = setTimeout(loop, POLL_MS);
    }
  };
  loop();

  // Graceful shutdown
  const shutdown = async () => {
    console.log('🛑 Shutting down worker');
    if (timer) clearTimeout(timer);
    server.close();
    if (redisClient) await redisClient.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('❌ Worker failed to start', e);
  process.exit(1);
});
