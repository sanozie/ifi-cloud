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

/**
 * --- Iteration 1 additions ---
 */

/**
 * Planner model for Iteration 1
 * GPT-5 is the default; override via env CODEGEN_PLANNER_MODEL
 */
export const PlannerModelV1 = 'gpt-5';

/**
 * Branch policy describing how the worker should create / re-use branches
 */
export interface BranchPolicy {
  mode: 'new_branch' | 'existing';
  name?: string;
}

/**
 * Structured implementation specification contract
 */
export interface ImplementationSpec {
  goal: string;
  repo: string;
  baseBranch: string;
  branchPolicy: BranchPolicy;
  featureName: string;
  deliverables: Array<
    | {
        type: 'code';
        paths?: string[];
        desc: string;
      }
    | {
        type: 'tests';
        framework: string;
        paths?: string[];
        desc: string;
      }
  >;
  constraints: string[];
  acceptanceCriteria: string[];
  riskNotes: string[];
  testPlan?: {
    strategy: 'unit' | 'integration' | 'e2e';
    commands: string[];
  };
  implementationHints?: string[];
  fileTargets: Array<{ path: string; reason: string }>;
  contextSnapshot?: {
    topFiles: Array<{ path: string; hash?: string; excerpt?: string }>;
    deps?: string[];
  };
  completenessScore: number;
}

/**
 * Planner intent surfaced to the client
 */
export type Intent = 'ready_to_codegen' | 'needs_more_info';

/**
 * Server-Sent Events payloads
 */

/* Chat SSE */
export type ChatSSEEventPayload =
  | { event: 'status'; data: { state: 'thinking' | 'replying' | 'idle' } }
  | { event: 'token'; data: { provider: 'openai' | 'fireworks'; chunk: string } }
  | { event: 'assistant_message'; data: { id: string; content: string } }
  | {
      event: 'spec_updated';
      data: { completenessScore: number; missing: string[] };
    }
  | { event: 'intent'; data: { type: Intent } };

/* Job SSE */
export type JobSSEEventPayload =
  | {
      event: 'status';
      data: {
        phase:
          | 'queued'
          | 'planning'
          | 'codegen'
          | 'apply'
          | 'pr_open'
          | 'complete'
          | 'failed';
      };
    }
  | { event: 'log'; data: { at: string; msg: string } }
  | { event: 'diff_chunk'; data: { chunk: string } }
  | {
      event: 'pr';
      data: {
        url: string;
        number: number;
        status: 'draft' | 'open' | 'merged' | 'closed';
      };
    }
  | { event: 'error'; data: { code: string; message: string } };

/**
 * Back-compat alias (existing constant kept but updated to GPT-5)
 */
export const DefaultPlannerModelV1 = PlannerModelV1;
