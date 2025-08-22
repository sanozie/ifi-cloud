import { prisma, updateJob } from '@ifi/db';
import { JobStatus } from '@ifi/shared';

const POLL_MS = parseInt(process.env.WORKER_POLL_MS || '3000', 10);
let shuttingDown = false;

async function dbReady(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function processJob(jobId: string) {
  try {
    console.log(`Processing job ${jobId}`);
    await updateJob(jobId, { status: JobStatus.PLANNING });
    await new Promise(r => setTimeout(r, 250));
    await updateJob(jobId, { status: JobStatus.CODEGEN });
    await new Promise(r => setTimeout(r, 250));
    await updateJob(jobId, { status: JobStatus.APPLY });
    await new Promise(r => setTimeout(r, 250));
    await updateJob(jobId, { status: JobStatus.TEST });
    await new Promise(r => setTimeout(r, 250));
    const prUrl = `https://github.com/example/repo/pull/${Math.floor(Math.random()*1000)+1}`;
    await updateJob(jobId, { status: JobStatus.PR_OPEN, prUrl });
    await new Promise(r => setTimeout(r, 250));
    await updateJob(jobId, { status: JobStatus.COMPLETE });
    console.log(`Job ${jobId} complete`);
  } catch (err) {
    console.error(`Job ${jobId} failed:`, err);
    await updateJob(jobId, { status: JobStatus.FAILED, error: (err as Error).message });
  }
}

async function pollOnce() {
  const jobs = await prisma.job.findMany({
    where: { status: JobStatus.QUEUED },
    orderBy: { createdAt: 'asc' },
    take: 3,
  });
  for (const job of jobs) {
    if (shuttingDown) break;
    await processJob(job.id);
  }
}

async function main() {
  console.log('IFI Worker starting...');
  const ready = await dbReady();
  if (!ready) console.warn('Database not reachable yet; will retry during polls');

  let timer: NodeJS.Timeout | null = null;
  const loop = async () => {
    if (shuttingDown) return;
    try {
      await pollOnce();
    } catch (e) {
      console.error('Poll error', e);
    } finally {
      if (!shuttingDown) timer = setTimeout(loop, POLL_MS);
    }
  };
  loop();

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (timer) clearTimeout(timer);
    await prisma.$disconnect();
    console.log('Worker stopped');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('Worker failed to start', e);
  process.exit(1);
});
