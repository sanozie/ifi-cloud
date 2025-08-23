"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
exports.createThread = createThread;
exports.addMessage = addMessage;
exports.createJob = createJob;
exports.getThread = getThread;
exports.getThreads = getThreads;
exports.getJob = getJob;
exports.updateJob = updateJob;
exports.upsertUserByClerk = upsertUserByClerk;
exports.getLatestDraftSpec = getLatestDraftSpec;
exports.upsertDraftSpec = upsertDraftSpec;
exports.finalizeSpec = finalizeSpec;
exports.createPullRequestRow = createPullRequestRow;
exports.upsertDeviceToken = upsertDeviceToken;
const client_1 = require("@prisma/client");
exports.prisma = global.prisma || new client_1.PrismaClient();
if (process.env.NODE_ENV !== 'production') {
    global.prisma = exports.prisma;
}
/**
 * Create a new thread
 * @param title Thread title
 * @returns The created thread
 */
async function createThread(params) {
    return exports.prisma.thread.create({
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
async function addMessage(params) {
    return exports.prisma.message.create({
        data: {
            threadId: params.threadId,
            role: params.role,
            content: params.content,
            // Store metadata as JSON rather than stringifying
            metadata: params.metadata,
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
async function createJob(params) {
    return exports.prisma.job.create({
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
async function getThread(threadId) {
    return exports.prisma.thread.findUnique({
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
async function getThreads() {
    return exports.prisma.thread.findMany({
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
async function getJob(jobId) {
    return exports.prisma.job.findUnique({
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
async function updateJob(jobId, data) {
    return exports.prisma.job.update({
        where: {
            id: jobId,
        },
        data,
    });
}
/**
 * Upsert a user by Clerk ID
 */
async function upsertUserByClerk(clerkId, email) {
    return exports.prisma.user.upsert({
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
function getLatestDraftSpec(threadId) {
    return exports.prisma.spec.findFirst({
        where: { threadId, status: 'drafting' },
        orderBy: { createdAt: 'desc' },
    });
}
async function upsertDraftSpec(threadId, specJson) {
    const existing = await getLatestDraftSpec(threadId);
    if (existing) {
        return exports.prisma.spec.update({
            where: { id: existing.id },
            data: { specJson: specJson },
        });
    }
    return exports.prisma.spec.create({
        data: {
            threadId,
            specJson: specJson,
            status: 'drafting',
            version: 1,
        },
    });
}
async function finalizeSpec(threadId) {
    const drafting = await getLatestDraftSpec(threadId);
    if (!drafting) {
        throw new Error('No drafting spec found to finalize');
    }
    // mark current as sent
    await exports.prisma.spec.update({
        where: { id: drafting.id },
        data: { status: 'sent' },
    });
    // create ready snapshot with incremented version
    return exports.prisma.spec.create({
        data: {
            threadId,
            version: drafting.version + 1,
            specJson: drafting.specJson,
            status: 'ready',
        },
    });
}
/**
 * Pull Request row helper
 */
function createPullRequestRow(params) {
    return exports.prisma.pullRequest.create({ data: params });
}
/**
 * Device token upsert
 */
function upsertDeviceToken(params) {
    return exports.prisma.deviceToken.upsert({
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
__exportStar(require("@prisma/client"), exports);
