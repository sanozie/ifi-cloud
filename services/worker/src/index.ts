import { getJob, updateJob, prisma } from '@ifi/db';
import { JobStatus } from '@ifi/shared';
import { Redis } from 'ioredis';

// Optional Redis client
let redisClient: Redis | null = null;

// Connect to Redis if URL is provided
if (process.env.REDIS_URL) {
  try {
    redisClient = new Redis(process.env.REDIS_URL);
    console.log('✅ Connected to Redis');
    
    // Subscribe to the jobs channel
    redisClient
      .subscribe('jobs')
      .then(() => {
        console.log('✅ Subscribed to jobs channel');
      })
      .catch((err: Error) => {
        console.error('❌ Failed to subscribe to Redis channel:', err);
      });
    
    // Listen for messages
    redisClient.on('message', (channel: string, message: string) => {
      if (channel === 'jobs') {
        console.log('📨 Received job notification:', message);
        // We'll still rely on polling for job processing
      }
    });
    
    // Handle Redis errors
    redisClient.on('error', (err: Error) => {
      console.error('❌ Redis error:', err);
    });
  } catch (error) {
    console.error('❌ Failed to connect to Redis:', error);
    redisClient = null;
  }
}

/**
 * Process a job by updating its status with delays
 */
async function processJob(jobId: string) {
  try {
    console.log(`🔄 Processing job ${jobId}`);
    
    // Update status to PLANNING
    await updateJob(jobId, { status: JobStatus.PLANNING });
    console.log(`📝 Job ${jobId}: Planning phase`);
    
    // Simulate planning work
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Update status to CODEGEN
    await updateJob(jobId, { status: JobStatus.CODEGEN });
    console.log(`💻 Job ${jobId}: Code generation phase`);
    
    // Simulate code generation work
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Update status to APPLY
    await updateJob(jobId, { status: JobStatus.APPLY });
    console.log(`🔨 Job ${jobId}: Applying changes`);
    
    // Simulate applying changes
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Update status to TEST
    await updateJob(jobId, { status: JobStatus.TEST });
    console.log(`🧪 Job ${jobId}: Testing changes`);
    
    // Simulate testing
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Update status to PR_OPEN with a fake PR URL
    const prUrl = `https://github.com/example/repo/pull/${Math.floor(Math.random() * 1000) + 1}`;
    await updateJob(jobId, { 
      status: JobStatus.PR_OPEN,
      prUrl
    });
    console.log(`🔀 Job ${jobId}: Opened PR at ${prUrl}`);
    
    // Simulate PR review
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Update status to COMPLETE
    await updateJob(jobId, { status: JobStatus.COMPLETE });
    console.log(`✅ Job ${jobId}: Completed successfully`);
    
  } catch (error) {
    console.error(`❌ Error processing job ${jobId}:`, error);
    
    // Update job status to FAILED with error message
    await updateJob(jobId, { 
      status: JobStatus.FAILED, 
      error: (error as Error).message 
    });
    
    console.log(`❌ Job ${jobId}: Failed - ${(error as Error).message}`);
  }
}

/**
 * Poll database for queued jobs
 */
async function pollJobs() {
  try {
    // Find jobs with QUEUED status
    const queuedJobs = await prisma.job.findMany({
      where: {
        status: JobStatus.QUEUED,
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: 5, // Process up to 5 jobs at once
    });
    
    if (queuedJobs.length > 0) {
      console.log(`🔍 Found ${queuedJobs.length} queued jobs`);
      
      // Process each job sequentially
      for (const job of queuedJobs) {
        await processJob(job.id);
      }
    }
  } catch (error) {
    console.error('❌ Error polling jobs:', error);
  }
}

/**
 * Start the worker
 */
function startWorker() {
  console.log('🚀 Starting IFI worker service');
  
  // Initial poll
  pollJobs();
  
  // Set up polling interval (every 3 seconds)
  const pollInterval = setInterval(pollJobs, 3000);
  
  // Handle process termination
  process.on('SIGTERM', () => {
    console.log('🛑 Worker shutting down');
    clearInterval(pollInterval);
    if (redisClient) {
      redisClient.quit();
    }
    process.exit(0);
  });
  
  console.log('⏱️ Worker polling for jobs every 3 seconds');
}

// Start the worker
startWorker();
