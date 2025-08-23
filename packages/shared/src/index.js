"use strict";
/**
 * Common types and constants used across services
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultPlannerModelV1 = exports.PlannerModelV1 = exports.DefaultCodegenModel = exports.DefaultPlannerModel = exports.JobStatus = void 0;
/**
 * Job status enum
 */
var JobStatus;
(function (JobStatus) {
    JobStatus["QUEUED"] = "queued";
    JobStatus["PLANNING"] = "planning";
    JobStatus["CODEGEN"] = "codegen";
    JobStatus["APPLY"] = "apply";
    JobStatus["TEST"] = "test";
    JobStatus["PR_OPEN"] = "pr_open";
    JobStatus["COMPLETE"] = "complete";
    JobStatus["FAILED"] = "failed";
})(JobStatus || (exports.JobStatus = JobStatus = {}));
/**
 * Default AI model constants
 */
exports.DefaultPlannerModel = 'gpt-4-turbo';
exports.DefaultCodegenModel = 'accounts/fireworks/models/qwen2.5-coder-32b-instruct';
/**
 * --- Iteration 1 additions ---
 */
/**
 * Planner model for Iteration 1
 * GPT-5 is the default; override via env CODEGEN_PLANNER_MODEL
 */
exports.PlannerModelV1 = 'gpt-5';
/**
 * Back-compat alias (existing constant kept but updated to GPT-5)
 */
exports.DefaultPlannerModelV1 = exports.PlannerModelV1;
