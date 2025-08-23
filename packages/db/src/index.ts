import { PrismaClient } from '@prisma/client';
import { MessageRole } from '@ifi/shared';
import type { Prisma } from '@prisma/client';

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
export async function createThread(params: {
  title: string;
  userId?: string;
}) {
  return prisma.thread.create({
    data: {
      title: params.title,
      userId: params.userId,
    },
  });
}

/**
 * Add a message to a thread
 * Accepts rich params to support token/cost tracking
 */
export async function addMessage(params: {
  threadId: string;
  role: MessageRole;
  content: string;
  metadata?: Record<string, any>;
  provider?: string;
  tokensPrompt?: number;
  tokensCompletion?: number;
  costUsd?: number;
}) {
  return prisma.message.create({
    data: {
      threadId: params.threadId,
      role: params.role,
      content: params.content,
      // Store metadata as JSON rather than stringifying
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
      provider: params.provider,
      tokensPrompt: params.tokensPrompt,
      tokensCompletion: params.tokensCompletion,
      costUsd: params.costUsd,
    },
  });
}

/**
 * Create a new job
 * @param params Job parameters
 * @returns The created job
 */
export async function createJob(params: {
  userId?: string;
  threadId?: string;
  specId?: string;
  status: string;
  repo: string;
  baseBranch?: string;
  featureBranch?: string;
}) {
  return prisma.job.create({
    data: {
      userId: params.userId,
      threadId: params.threadId,
      specId: params.specId,
      status: params.status,
      repo: params.repo,
      baseBranch: params.baseBranch,
      featureBranch: params.featureBranch,
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
    featureBranch?: string;
    prUrl?: string;
    error?: string;
    costsJson?: any;
  }
) {
  return prisma.job.update({
    where: {
      id: jobId,
    },
    data,
  });
}

/**
 * Upsert a user by Clerk ID
 */
export async function upsertUserByClerk(clerkId: string, email?: string) {
  return prisma.user.upsert({
    where: { clerkId },
    update: { email },
    create: {
      clerkId,
      email,
    },
  });
}

/**
 * SPEC HELPERS
 */
export function getLatestDraftSpec(threadId: string) {
  return prisma.spec.findFirst({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function upsertDraftSpec(
  threadId: string,
  draft: { title: string; content: string }
) {
  const existing = await getLatestDraftSpec(threadId);
  if (existing) {
    return prisma.spec.update({
      where: { id: existing.id },
      data: {
        title: draft.title,
        content: draft.content,
      },
    });
  }
  return prisma.spec.create({
    data: {
      threadId,
      title: draft.title,
      content: draft.content,
      version: 1,
    },
  });
}

export async function finalizeSpec(threadId: string) {
  const latest = await getLatestDraftSpec(threadId);
  if (!latest) {
    throw new Error('No spec found to finalize');
  }
  // As of Iteration-2 we no longer track status – simply return the latest spec.
  return latest;
}

/**
 * Pull Request row helper
 */
export function createPullRequestRow(params: {
  jobId: string;
  repo: string;
  prNumber: number;
  url: string;
  status: string;
  headBranch: string;
  baseBranch: string;
}) {
  return prisma.pullRequest.create({ data: params });
}

/**
 * Device token upsert
 */
export function upsertDeviceToken(params: {
  userId: string;
  platform: 'ios';
  token: string;
}) {
  return prisma.deviceToken.upsert({
    where: { token: params.token },
    update: {
      userId: params.userId,
      lastSeenAt: new Date(),
    },
    create: {
      userId: params.userId,
      platform: params.platform,
      token: params.token,
      lastSeenAt: new Date(),
    },
  });
}

export * from '@prisma/client';
