/**
 * Common types and constants used across services
 */

/**
 * Message role type
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Message interface
 */
export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
  metadata?: Record<string, any>;
}

/**
 * Job status enum
 */
export enum JobStatus {
  QUEUED = 'queued',
  PLANNING = 'planning',
  CODEGEN = 'codegen',
  APPLY = 'apply',
  TEST = 'test',
  PR_OPEN = 'pr_open',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

/**
 * Job interface
 */
export interface Job {
  id: string;
  status: JobStatus;
  repo: string;
  branch?: string;
  prUrl?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Chat request interface
 */
export interface ChatRequest {
  threadId?: string;
  message: string;
  context?: {
    repo?: string;
    notionalWorkspaceId?: string;
  };
}

/**
 * Chat response interface
 */
export interface ChatResponse {
  jobId?: string;
  reply?: string;
}

/**
 * Default AI model constants
 */
export const DefaultPlannerModel = 'gpt-4-turbo';
export const DefaultCodegenModel = 'accounts/fireworks/models/qwen2.5-coder-32b-instruct';
