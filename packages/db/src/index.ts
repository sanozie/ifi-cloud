import { PrismaClient } from '@prisma/client';
import { MessageRole } from '@ifi/shared';

// Singleton PrismaClient instance
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma = global.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

/**
 * Create a new thread
 * @param title Thread title
 * @returns The created thread
 */
export async function createThread(title: string) {
  return prisma.thread.create({
    data: {
      title,
    },
  });
}

/**
 * Add a message to a thread
 * @param threadId Thread ID
 * @param role Message role (user, assistant, system)
 * @param content Message content
 * @param metadata Optional metadata
 * @returns The created message
 */
export async function addMessage(
  threadId: string,
  role: MessageRole,
  content: string,
  metadata?: Record<string, any>
) {
  return prisma.message.create({
    data: {
      threadId,
      role,
      content,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    },
  });
}

/**
 * Create a new job
 * @param params Job parameters
 * @returns The created job
 */
export async function createJob(params: {
  status: string;
  repo: string;
  branch?: string;
}) {
  return prisma.job.create({
    data: {
      status: params.status,
      repo: params.repo,
      branch: params.branch,
    },
  });
}

/**
 * Get a thread by ID with messages
 * @param threadId Thread ID
 * @returns The thread with messages
 */
export async function getThread(threadId: string) {
  return prisma.thread.findUnique({
    where: {
      id: threadId,
    },
    include: {
      messages: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });
}

/**
 * Get all threads
 * @returns All threads
 */
export async function getThreads() {
  return prisma.thread.findMany({
    orderBy: {
      updatedAt: 'desc',
    },
    include: {
      messages: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
    },
  });
}

/**
 * Get a job by ID
 * @param jobId Job ID
 * @returns The job
 */
export async function getJob(jobId: string) {
  return prisma.job.findUnique({
    where: {
      id: jobId,
    },
  });
}

/**
 * Update a job
 * @param jobId Job ID
 * @param data Job data to update
 * @returns The updated job
 */
export async function updateJob(
  jobId: string,
  data: {
    status?: string;
    branch?: string;
    prUrl?: string;
    error?: string;
  }
) {
  return prisma.job.update({
    where: {
      id: jobId,
    },
    data,
  });
}

export * from '@prisma/client';
