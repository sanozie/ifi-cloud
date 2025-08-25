# Multi-Spec Workflow Documentation

_Introduced in release `feature/multi-spec-workflow`_

---

## 1  |  Why a “multi-spec” workflow?

Pull-requests often require several rounds of feedback before merge.  
The first spec (our **plan**) opens a draft PR, but reviewer comments trigger follow-up changes.  
Instead of spawning new threads or losing context, **each thread can now own multiple specs**:

* **INITIAL spec** – creates the feature branch + first draft PR.  
* **UPDATE spec(s)** – iterate on the same branch / PR until it is merged.

Benefits:

* Keeps discussion, specs and code review in a single place.
* Allows the planner to re-enter “planning” after feedback without resetting context.
* Enables the worker to reuse the existing branch, minimising merge conflicts and churn.

---

## 2  |  Thread lifecycle states

| State | Purpose | Typical trigger |
|-------|---------|-----------------|
| `planning` | Assistant is gathering requirements / writing (next) spec. | User asks a question or thread transitioned back after feedback. |
| `working` | Job is running (codegen / apply / tests). | Worker picks up a queued job. |
| `waiting_for_feedback` | Draft PR is open and awaiting human review. | Worker finishes applying changes. |
| `archived` | Thread is complete & PR merged/closed. | Maintainer merges PR or explicitly archives thread. |

### State transitions

`planning → working → waiting_for_feedback → planning … → archived`

Transitions are recorded in `ThreadStateTransition` events and can be queried for analytics.

---

## 3  |  Spec types

| Type | When created | Key fields |
|------|--------------|------------|
| `initial` | First plan for a thread. Opens a **new** feature branch and draft PR. | `version = 1`, `branchPolicy.mode = 'new_branch'` |
| `update` | Subsequent plans to update an **existing** PR. | `version > 1`, `targetBranch = feature branch name` |

Each `Spec` row now has:
* `specType` (`initial` | `update`)
* `targetBranch` (nullable, set for `update`)
* `version` (auto-increment per thread)

---

## 4  |  New/updated API endpoints

| Method & Path | Purpose |
|---------------|---------|
| `GET  /v1/threads/:id` | Returns full thread, current PR (if any) and state. |
| `POST /v1/threads/:id/transition` | Change thread state (e.g. back to `planning`). |
| `GET  /v1/threads/:id/specs` | List all specs (initial + updates) for a thread. |
| `POST /v1/threads/:id/specs` | Create an **UPDATE** spec. Body: `{ title, content, targetBranch }`. |
| `POST /v1/threads/:id/checkout` | Use MCP to checkout the branch locally so _continue CLI_ can analyse the latest code. Body: `{ repo, branch? }`. |

All endpoints return consistent JSON and propagate errors with useful messages.

---

## 5  |  MCP (Model-Context-Protocol) tools

The new file `packages/integrations/src/mcp.ts` provides thin Git wrappers:

* `ensureRepoCloned(repoFullName)` – clone or fetch into `/tmp/ifi-repos/…`.
* `checkoutBranch(repo, branch)` – checks out existing branch or creates tracking one.
* `prepareRepoForContinue(repo, branch)` – one-shot helper returning `{ repoPath, branch, commit }` for the **continue** CLI.
* Utility functions: `branchExistsLocally`, `branchExistsRemotely`, `getDiff`, `readFile`, …

These functions are **pure Node**, rely on the host’s Git credentials and are exported via `@ifi/integrations`.

---

## 6  |  End-to-end example

1. **User:** “Add dark-mode toggle to settings.”
2. **Planner:** Creates `INITIAL` spec → worker opens draft PR `feat/autogen-a1b2`.
3. **State:** `planning ➜ working ➜ waiting_for_feedback`.
4. **Reviewer:** Comments “rename var and add tests”.
5. **User or webhook:** Calls `/threads/:id/transition` back to `planning`.
6. **Planner:** Generates `UPDATE` spec (version 2) targeting branch `feat/autogen-a1b2`.
7. **Worker:** Uses MCP to `git checkout feat/autogen-a1b2`, updates files, force-push, PR updates.
8. **State:** back to `waiting_for_feedback`.
9. **Reviewer:** Approves & merges → webhook marks thread `archived`.

---

## 7  |  Database schema changes

Prisma `schema.prisma` updates:

```prisma
model Thread {
  // …
  state            String   @default("planning")  // new
  currentPrBranch  String?  // new
  currentPrUrl     String?  // new
}

model Spec {
  // …
  specType     String   @default("initial")       // new
  targetBranch String?                           // new
}

model PullRequest {
  // unchanged, still linked to Job
}
```

New helper functions in `packages/db/src/index.ts`:

* `updateThreadState`
* `createUpdateSpec`
* `getActiveThread`, `getThreadSpecs`
* `threadHasActivePr`, `transitionThreadToPlanning`

---

## 8  |  Worker service enhancements

`services/worker/src/index.ts`

* Reads `specType` and `targetBranch`.
* For `update` specs it:
  * Verifies remote branch exists (`mcp.branchExistsRemotely`).
  * Checks out branch locally and skips `ensureBranch`.
  * Updates or creates files via Octokit, then updates existing PR if found.
* Publishes Redis events:
  * `thread:<id> state_change` whenever thread moves to `waiting_for_feedback`.
* After PR creation, thread is automatically placed in `waiting_for_feedback` with `currentPrBranch` + `currentPrUrl`.

---

## Summary

The multi-spec workflow keeps a single conversational thread in sync with an evolving pull-request, allowing seamless **plan → code → review → update** cycles until merge. The API, database, worker and integration layers have all been extended to support this behaviour while maintaining backward compatibility for legacy functionality.
