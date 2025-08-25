import { PrismaClient } from '@prisma/client';
import { MessageRole, ThreadState, SpecType } from '@ifi/shared';
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
 * @returns The created thread
 * @param params
 */
export async function createThread(params: {
  title: string;
  userId?: string;
}) {
  return prisma.thread.create({
    data: {
      title: params.title,
    },
    include: {
      messages: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    }
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
      // Store metadata as JSON rather than stringify
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
  threadId: string;
  specId: string;
  status: string;
}) {
  return prisma.job.create({
    data: {
      threadId: params.threadId,
      specId: params.specId,
      status: params.status,
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

/* ------------------------------------------------------------------ */
/*  Multi-spec helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Update a thread's lifecycle state and (optionally) current PR info.
 * Passing null for branch/url will clear the fields.
 */
export async function updateThreadState(
  threadId: string,
  state: ThreadState,
  opts?: { currentPrBranch?: string | null; currentPrUrl?: string | null }
) {
  return prisma.thread.update({
    where: { id: threadId },
    data: {
      state,
      currentPrBranch:
        opts && Object.prototype.hasOwnProperty.call(opts, 'currentPrBranch')
          ? opts.currentPrBranch
          : undefined,
      currentPrUrl:
        opts && Object.prototype.hasOwnProperty.call(opts, 'currentPrUrl')
          ? opts.currentPrUrl
          : undefined,
    },
  });
}

/**
 * Create an UPDATE-type spec (version is latest +1)
 */
export async function createUpdateSpec(params: {
  threadId: string;
  title: string;
  content: string;
  targetBranch: string;
}) {
  const latest = await prisma.spec.findFirst({
    where: { threadId: params.threadId },
    orderBy: { version: 'desc' },
  });

  return prisma.spec.create({
    data: {
      threadId: params.threadId,
      title: params.title,
      content: params.content,
      version: (latest?.version ?? 0) + 1,
      specType: SpecType.UPDATE,
      targetBranch: params.targetBranch,
    },
  });
}

/**
 * Fetch complete thread info (messages + specs) for planner/worker.
 */
export async function getActiveThread(threadId: string) {
  return prisma.thread.findUnique({
    where: { id: threadId },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      specs: { orderBy: { createdAt: 'asc' } },
    },
  });
}

/**
 * Get all specs for a thread, ordered oldest->newest.
 */
export function getThreadSpecs(threadId: string) {
  return prisma.spec.findMany({
    where: { threadId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Determine whether a thread currently has an active PR awaiting feedback.
 */
export async function threadHasActivePr(threadId: string): Promise<boolean> {
  const thread = await prisma.thread.findUnique({
    where: { id: threadId },
    select: { state: true, currentPrBranch: true },
  });
  return (
    !!thread &&
    thread.state === ThreadState.WAITING_FOR_FEEDBACK &&
    !!thread.currentPrBranch
  );
}

/**
 * Reset thread to PLANNING state after PR feedback cycle completes.
 */
export function transitionThreadToPlanning(threadId: string) {
  return updateThreadState(threadId, ThreadState.PLANNING, {
    currentPrBranch: null,
    currentPrUrl: null,
  });
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
      lastSeenAt: new Date(),
    },
    create: {
      platform: params.platform,
      token: params.token,
      lastSeenAt: new Date(),
    },
  });
}

export * from '@prisma/client';

/**
 * Convenience wrapper that returns a thread along with `modelMessages`
 * already converted via the AI-SDK helper.
 */
export async function getThreadWithModelMessages(threadId: string) {
  const thread = await getThread(threadId);
  if (!thread) return null;

  return {
    ...thread,
    modelMessages: thread.messages
      .filter((m) => ['user', 'assistant', 'system'].includes(m.role))
      .map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
  };
}
