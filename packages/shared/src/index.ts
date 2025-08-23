/**
 * Common types and constants used across services
 */

// Message role type
export type MessageRole = 'user' | 'assistant' | 'system';

// Chat request/response (legacy)
export interface ChatRequest {
  threadId?: string;
  message: string;
  context?: {
    repo?: string;
    notionalWorkspaceId?: string;
  };
}

export interface ChatResponse {
  jobId?: string;
  reply?: string;
}

// Default AI model constants
export const DefaultPlannerModel = 'gpt-4-turbo';
export const DefaultCodegenModel = 'accounts/fireworks/models/qwen2.5-coder-32b-instruct';

// Iteration 1 planner default (alias kept for back-compat)
export const PlannerModelV1 = 'gpt-5';
export const DefaultPlannerModelV1 = PlannerModelV1;

// Job status enum
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

// Structured Implementation Spec (legacy; may be removed later)
export interface BranchPolicy {
  mode: 'new_branch' | 'existing';
  name?: string;
}

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

// Planner intent surfaced to the client
export type Intent = 'ready_to_codegen' | 'needs_more_info';
