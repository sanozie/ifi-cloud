import { DefaultCodegenModel, DefaultPlannerModel, JobStatus } from '@ifi/shared'

// Vercel AI SDK v5
import { generateText, type ModelMessage, streamText, type StreamTextOnFinishCallback, tool } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
// Shell Execution
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { Dirent, promises } from 'fs'
// MCP helpers
import { getAvailableBranches, getCurrentRepoContext, prepareRepoForContinue } from '@ifi/integrations'
// DB helpers
import { createJob, getLatestDraftSpec, getThread, upsertDraftSpec } from '@ifi/db'

const execAsync = promisify(exec);

/**
 * Provider configuration
 */
export interface ProviderConfig {
  plannerModel: string;
  codegenModel: string;
  maxTokens: number;
  timeoutMs: number;
  costCapUsd: number;
}

/**
 * Default provider configuration
 */
export const defaultConfig: ProviderConfig = {
  plannerModel: process.env.CODEGEN_PLANNER_MODEL || DefaultPlannerModel,
  codegenModel: process.env.CODEGEN_MODEL || DefaultCodegenModel,
  maxTokens: parseInt(process.env.CODEGEN_MAX_TOKENS || '8192', 10),
  timeoutMs: parseInt(process.env.CODEGEN_TIMEOUT_MS || '60000', 10),
  costCapUsd: parseFloat(process.env.CODEGEN_COST_CAP_USD || '1.0'),
};

// Instantiate model providers (null when missing API key so we can fall back to stub)
const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

/**
 * ------------------ MCP TOOL FACTORIES ------------------
 * We expose small helper functions that take the `mcptool`
 * constructor (aliased from `ai.tool`) and return a fully
 * configured tool definition.  This keeps `plan()` tidy and
 * maintains the original runtime behaviour.
 */

function createReportCompletionTool(mcptool: any) {
  return mcptool({
    name: 'reportCompletion',
    description:
      'Call this exactly once when you have produced the final plan. The summary should be a concise, one-sentence description of what you accomplished.',
    inputSchema: z.object({
      summary: z.string(),
      code: z.number().optional(),
    }),
    async execute() {
      return { acknowledged: true };
    },
  }) as any;
}


function createSearchCodebaseTool(mcptool: any) {
  return mcptool({
    name: 'searchCodebaseCapture',
    description:
      'Run Continue CLI (cn -p) to ask the Continue CLI AI Agent questions about the particular codebase. Questions should be formatted as human-like full sentences.',
    inputSchema: z.object({
      query: z.string().describe('Natural language question about the codebase, formatted as human-like full sentences.'),
      repository: z
        .string()
        .describe('Repository name (folder under /app/services/api/repos)'),
      timeoutMs: z
        .number()
        .optional()
        .describe('Timeout in milliseconds (default: 300000 = 5 minutes)')
    }),
    async execute({ query, repository, timeoutMs = 300000 }: { query: string; repository?: string; timeoutMs?: number }) {
      const startTime = Date.now();
      console.log('[searchCodebaseCaptureTool] 🔍 ENTER - Starting long-running capture run');
      console.log('[searchCodebaseCaptureTool] 📝 Query:', query);
      console.log('[searchCodebaseCaptureTool] 📁 Repository:', repository || 'auto-detect');
      console.log('[searchCodebaseCaptureTool] ⏰ Timeout set to:', timeoutMs, 'ms');

      // Resolve repository directory
      const reposDir = '/app/services/api/repos';
      let dirEntries: Dirent[];
      try {
        dirEntries = await promises.readdir(reposDir, { withFileTypes: true });
        console.log('[searchCodebaseCaptureTool] 📂 Found', dirEntries.filter(d => d.isDirectory()).length, 'directories in repos');
      } catch (e: any) {
        console.log('[searchCodebaseCaptureTool] ❌ ERROR - Failed to read repos directory:', e.message);
        if (e?.code === 'ENOENT') {
          return { warning: true, message: '📂 The /app/services/api/repos directory does not exist.' };
        }
        throw e;
      }

      const repoDir = repository
        ? `${reposDir}/${repository}`
        : dirEntries.find((d) => d.isDirectory())?.name
        ? `${reposDir}/${dirEntries.find((d) => d.isDirectory())!.name}`
        : null;

      if (!repoDir) {
        console.log('[searchCodebaseCaptureTool] ⚠️ WARNING - No repositories available');
        return { warning: true, message: '📂 No repositories available under /app/services/api/repos.' };
      }

      console.log('[searchCodebaseCaptureTool] 🎯 Using repository directory:', repoDir);
      console.log('[searchCodebaseCaptureTool] 🚀 Executing command: cn -p "' + query + '"');

      // Use execAsync for direct block output collection instead of streaming
      console.log('[searchCodebaseCaptureTool] ⏳ Waiting for complete stdout block (with timeout)...');
      
      let result: { stdout: string; stderr: string } | null = null;
      let executionError: any = null;
      let timedOut = false;

      // Periodic status logger for long-running commands
      const statusInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        console.log('[searchCodebaseCaptureTool] 🕐 Status update:');
        console.log(`  ├─ Elapsed: ${Math.round(elapsed / 1000)}s / ${Math.round(timeoutMs / 1000)}s`);
        console.log(`  └─ Waiting for complete stdout/stderr blocks (no streaming events)`);
      }, 30000); // Log status every 30 seconds

      try {
        // Create a timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            timedOut = true;
            reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)} seconds`));
          }, timeoutMs);
        });

        console.log('[searchCodebaseCaptureTool] doing -> ' + 'cn -p "' + query.replace(/"/g, '\\"') + '"')
        // Execute command and race against timeout
        const execPromise = execAsync('cn -p "' + query.replace(/"/g, '\\"') + '"', {
          cwd: repoDir,
          env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
          maxBuffer: 1024 * 1024 * 10, // 10MB buffer to handle large outputs
        });

        result = await Promise.race([execPromise, timeoutPromise]);
        
      } catch (error: any) {
        executionError = error;
        if (!timedOut) {
          console.log('[searchCodebaseCaptureTool] ❌ Command execution error:', error.message);
        } else {
          console.log('[searchCodebaseCaptureTool] ⏰ TIMEOUT - Command exceeded timeout limit');
        }
      } finally {
        clearInterval(statusInterval);
      }

      const totalTime = Date.now() - startTime;
      console.log('[searchCodebaseCaptureTool] ⏱️ Total execution time:', Math.round(totalTime / 1000), 'seconds');

      // Handle timeout case
      if (timedOut) {
        const timeoutMsg = `Command timed out after ${Math.round(timeoutMs / 1000)} seconds`;
        console.log('[searchCodebaseCaptureTool] ⏰ TIMEOUT RESULT -', timeoutMsg);
        return { 
          timeout: true, 
          message: timeoutMsg,
          partialOutput: null, // execAsync doesn't provide partial output on timeout
          exitCode: -2,
          executionTimeMs: totalTime
        };
      }

      // Handle execution error
      if (executionError && !result) {
        console.log('[searchCodebaseCaptureTool] ❌ COMMAND EXECUTION FAILED - Detailed error analysis:');
        console.log('[searchCodebaseCaptureTool] 🔍 Error message:', executionError.message);
        console.log('[searchCodebaseCaptureTool] 🔍 Error type:', executionError.constructor.name);
        console.log('[searchCodebaseCaptureTool] 🔍 Exit code:', executionError.code || 'unknown');
        console.log('[searchCodebaseCaptureTool] 🔍 Signal:', executionError.signal || 'none');
        console.log('[searchCodebaseCaptureTool] 🔍 Error number (errno):', executionError.errno || 'none');
        console.log('[searchCodebaseCaptureTool] 🔍 System call:', executionError.syscall || 'none');
        console.log('[searchCodebaseCaptureTool] 🔍 Error path:', executionError.path || 'none');
        console.log('[searchCodebaseCaptureTool] 🔍 Command that failed: cn -p "' + query.replace(/"/g, '\\"') + '"');
        console.log('[searchCodebaseCaptureTool] 🔍 Working directory:', repoDir);
        
        // Log stdout/stderr content even on failure (if available)
        if (executionError.stdout) {
          console.log('[searchCodebaseCaptureTool] 📤 STDOUT from failed command:');
          console.log('  Length:', executionError.stdout.length, 'characters');
          console.log('  Content:', executionError.stdout.substring(0, 1000) + (executionError.stdout.length > 1000 ? '... [TRUNCATED]' : ''));
        } else {
          console.log('[searchCodebaseCaptureTool] 📤 STDOUT: No output captured');
        }
        
        if (executionError.stderr) {
          console.log('[searchCodebaseCaptureTool] 📥 STDERR from failed command:');
          console.log('  Length:', executionError.stderr.length, 'characters');
          console.log('  Content:', executionError.stderr.substring(0, 1000) + (executionError.stderr.length > 1000 ? '... [TRUNCATED]' : ''));
        } else {
          console.log('[searchCodebaseCaptureTool] 📥 STDERR: No error output captured');
        }
        
        // Additional debugging information
        console.log('[searchCodebaseCaptureTool] 🔍 Process information:');
        console.log('  ├─ PID:', process.pid);
        console.log('  ├─ Platform:', process.platform);
        console.log('  ├─ Architecture:', process.arch);
        console.log('  ├─ Node.js version:', process.version);
        console.log('  ├─ Current working directory:', process.cwd());
        console.log('  └─ Memory usage:', JSON.stringify(process.memoryUsage(), null, 2));
        
        return {
          warning: true,
          message: `Command failed: ${executionError.message}`,
          exitCode: executionError.code || -1,
          executionTimeMs: totalTime,
          errorDetails: {
            type: executionError.constructor.name,
            signal: executionError.signal,
            errno: executionError.errno,
            syscall: executionError.syscall,
            path: executionError.path,
            stdout: executionError.stdout,
            stderr: executionError.stderr
          }
        };
      }

      const finalStdout = result?.stdout?.trim() || '';
      const finalStderr = result?.stderr?.trim() || '';
      const final = finalStdout || finalStderr;

      console.log('[searchCodebaseCaptureTool] 📊 Output summary - STDOUT:', finalStdout.length, 'chars, STDERR:', finalStderr.length, 'chars');

      if (!final) {
        console.log('[searchCodebaseCaptureTool] ⚠️ WARNING - No output produced by Continue CLI');
        return { 
          warning: true, 
          message: 'Continue CLI produced no output.',
          exitCode: 0, // execAsync completed without error but no output
          executionTimeMs: totalTime
        };
      }

      console.log('[searchCodebaseCaptureTool] ✅ SUCCESS - Returning output with', final.length, 'characters');
      console.log('[searchCodebaseCaptureTool] 🔚 EXIT - Command completed successfully');

      return { 
        output: final, 
        exitCode: 0, // execAsync completed successfully
        stderr: finalStderr,
        executionTimeMs: totalTime,
        blockBased: true // Indicator that we're using block-based approach, not streaming
      } as any;
    },
  }) as any;
}

function createDraftSpecTool(mcptool: any) {
  return mcptool({
    name: 'draftSpec',
    description:
      'Create or update a draft design spec for a given thread based on the conversation so far.',
    inputSchema: z.object({
      threadId: z.string().describe('ID of the thread for which to draft the spec'),
    }),
    async execute({ threadId }: { threadId: string }) {
      try {
        const thread = await getThread(threadId);
        if (!thread) {
          return { error: true, message: `Thread ${threadId} not found` };
        }
        const modelMessages = thread.chat as ModelMessage[];
        const content = await draftSpecFromMessages(modelMessages);

        let title = 'Draft Spec';
        const firstLine = content.split('\n')[0] ?? '';
        if (firstLine.startsWith('#')) {
          title = firstLine.replace(/^#+\s*/, '').trim();
        } else if (thread.title) {
          title = `Draft Spec for ${thread.title}`;
        }

        const spec = await upsertDraftSpec(threadId, { title, content });
        return { specId: spec.id, content: spec.content };
      } catch (err: any) {
        return { error: true, message: `draftSpec failed: ${err.message}` };
      }
    },
  }) as any;
}

function createFinalizeSpecTool(mcptool: any) {
  return mcptool({
    name: 'finalizeSpec',
    description:
      'Finalize the latest draft spec for a thread and create a queued implementation job.',
    inputSchema: z.object({
      threadId: z.string().describe('ID of the thread whose spec should be finalized'),
    }),
    async execute({ threadId }: { threadId: string }) {
      try {
        const spec = await getLatestDraftSpec(threadId);
        if (!spec) {
          return { error: true, message: 'No draft spec found to finalize' };
        }
        const job = await createJob({
          threadId,
          specId: spec.id,
          status: JobStatus.QUEUED,
        });
        return { jobId: job.id };
      } catch (err: any) {
        return { error: true, message: `finalizeSpec failed: ${err.message}` };
      }
    },
  }) as any;
}

/**
 * Returns information about the current repo context (branch, commit, etc.)
 */
function createGetCurrentBranchTool(mcptool: any) {
  return mcptool({
    name: 'getCurrentBranch',
    description:
      'Get the current Git repository context (branch, commit) so the planner can decide whether it needs to switch branches.',
    inputSchema: z.object({
      repo: z.string().describe('Full repo name, e.g. owner/repo'),
    }),
    async execute({ repo }: { repo: string }) {
      try {
        const ctx = await getCurrentRepoContext(repo);
        return ctx;
      } catch (err: any) {
        return { error: true, message: `getCurrentBranch failed: ${err.message}` };
      }
    },
  }) as any;
}

/**
 * Checkout / prepare the repository for continue CLI on a specific branch.
 */
function createCheckoutBranchTool(mcptool: any) {
  return mcptool({
    name: 'checkoutBranch',
    description:
      'Clone (if needed) and checkout the specified branch so continue CLI can load the correct context.',
    inputSchema: z.object({
      repo: z.string().describe('Full repo name, e.g. owner/repo'),
      branch: z.string().describe('Branch to checkout (feature branch or main)'),
    }),
    async execute({ repo, branch }: { repo: string; branch: string }) {
      try {
        const result = await prepareRepoForContinue(repo, branch);
        return result;
      } catch (err: any) {
        return { error: true, message: `checkoutBranch failed: ${err.message}` };
      }
    },
  }) as any;
}

/**
 * List all available branches (local & remote) for a repository – useful when
 * the planner needs to decide which branch to work on.
 */
function createGetBranchesTool(mcptool: any) {
  return mcptool({
    name: 'getBranches',
    description:
      'Return the list of local and remote branches for the specified repository.',
    inputSchema: z.object({
      repo: z.string().describe('Full repo name, e.g. owner/repo'),
    }),
    async execute({ repo }: { repo: string }) {
      try {
        const result = await getAvailableBranches(repo);
        return result;
      } catch (err: any) {
        return { error: true, message: `getBranches failed: ${err.message}` };
      }
    },
  }) as any;
}

function createUpdateTitleTool(mcptool: any) {
  return mcptool({
    name: 'update_title',
    description:
      'Update the title of a conversation thread. Use this sparingly when the overall topic or goal changes significantly.',
    inputSchema: z.object({
      threadId: z.string().describe('ID of the thread to rename'),
      title: z.string().min(3).max(120).describe('A concise, human-friendly title that summarizes the thread'),
    }),
    async execute({ threadId, title }: { threadId: string; title: string }) {
      try {
        // Update via DB to avoid cross-HTTP calls
        const { prisma } = await import('@ifi/db');
        const trimmed = title.trim();
        if (!trimmed) {
          return { error: true, message: 'Title cannot be empty' };
        }
        const updated = await prisma.thread.update({
          where: { id: threadId },
          data: { title: trimmed },
          select: { id: true, title: true, updatedAt: true },
        });
        return { id: updated.id, title: updated.title, updatedAt: updated.updatedAt };
      } catch (err: any) {
        if (err?.code === 'P2025') {
          return { error: true, message: 'Thread not found' };
        }
        return { error: true, message: `update_title failed: ${err.message}` };
      }
    },
  }) as any;
}

/**
 * Stream a plan using OpenAI (UIMessageStreamResponse compatible)
 */
export async function plan({ messages, onFinish, config = {} }:
                           {
                             messages: ModelMessage[],
                             onFinish?: StreamTextOnFinishCallback<any>
                             config?: Partial<ProviderConfig>
                           }) {
  try {

    const mergedConfig = { ...defaultConfig, ...config };

    /* --------------------------------------------------------------- */
    /* 1)  Function entry                                              */
    /* --------------------------------------------------------------- */
    console.log("[plan]▶️  ENTER");

    const mcptool: any = tool;

    // Instantiate tools via helper factories
    const reportCompletionTool = createReportCompletionTool(mcptool);
    const searchCodebaseTool = createSearchCodebaseTool(mcptool);
    const draftSpecTool = createDraftSpecTool(mcptool);
    const finalizeSpecTool = createFinalizeSpecTool(mcptool);
    const getCurrentBranchTool = createGetCurrentBranchTool(mcptool);
    const checkoutBranchTool = createCheckoutBranchTool(mcptool);
    const getBranchesTool = createGetBranchesTool(mcptool);
    const updateTitleTool = createUpdateTitleTool(mcptool);

    // Assemble tools while forcing lightweight types to avoid deep inference
    const tools = {
      web_search_preview: openai.tools.webSearchPreview({ searchContextSize: 'high' }) as any,
      search_codebase: searchCodebaseTool as any,
      report_completion: reportCompletionTool as any,
      draft_spec: draftSpecTool as any,
      finalize_spec: finalizeSpecTool as any,
      get_current_branch: getCurrentBranchTool as any,
      checkout_branch: checkoutBranchTool as any,
      get_branches: getBranchesTool as any,
      update_title: updateTitleTool as any,
    } as const;

    console.log(`[plan] 🛠️  Tools configured: ${Object.keys(tools).join(', ')}`);

    // System message that's always included
    const systemMessage: ModelMessage = {
      role: 'system',
      content: `
You are IFI, an AI engineering assistant that guides a user through THREE distinct stages:

1. **Planning Discussion** – Conversational back-and-forth to understand the user’s goal.
2. **Drafting Spec** – Produce a structured design/implementation spec that the user can review.
3. **Finalization & Implementation** – After explicit user approval, queue an implementation job.

Determine the CURRENT INTENT from the latest user message:
• If they are still clarifying requirements or asking questions → stay in *Planning Discussion*.  
• If they indicate they are **ready to see a spec** ( e.g. “sounds good, can you draft a spec?” or “let’s proceed” ) → CALL the \`draft_spec\` tool exactly once.  
• If they explicitly **approve the draft spec** ( e.g. “looks good, ship it”, “approved”, “go ahead with implementation” ) → CALL the \`finalize_spec\` tool exactly once.  

Tool usage rules:
• Never call \`draft_spec\` or \`finalize_spec\` without meeting the intent criteria above.  
• After calling a tool, wait for the tool response before progressing to the next stage.  
• When the overall task (including any necessary tool calls) is complete, CALL the \`reportCompletion\` tool **exactly once** with a one-sentence summary.  

Branch-context tools:  
• If you are unsure which branch is currently checked-out (or whether the repo exists locally), CALL the \`get_current_branch\` tool with the \`repo\` parameter.  
• When you need to work on an **UPDATE** spec or otherwise switch to a different branch, CALL the \`checkout_branch\` tool with the desired \`repo\` and \`branch\`.  
• Use these tools to ensure the **continue** CLI receives the correct code context before performing any codebase queries.
• To view all available branches (local & remote) before deciding, CALL the \`get_branches\` tool.
• The \`search_codebase\` tool gives you access to an AI agent capable of answering complex questions about a particular repo. Use it when you need to gather context from the actual code, and format your query as human-like full sentences.

General guidelines:
• Keep all normal conversation messages concise and focused.  
• NEVER leak internal reasoning or tool call JSON to the user—only properly formatted tool calls.  
• Do NOT output any completion text directly; the client UI renders results from tools.  

Thread title management:
• When a brand-new thread is created from a user’s first prompt, propose an initial concise title and CALL the \`update_title\` tool once to set it. As more messages arrive and the user’s true intent becomes clearer, you may refine the title – but only when there is a substantial change in scope or objective.
• You may CALL the \`update_title\` tool to rename the current thread when there is a substantial shift in topic, goal, or deliverable. Avoid updating after every single message.
• Choose a concise, human-friendly title that accurately represents the thread overall. Prefer specific, outcome-oriented phrasing (e.g., "Implement long-press rename for threads") over vague titles.
• If a thread identifier is provided in system context (e.g., "Thread Context: threadId=…"), use that threadId when calling update_title.
• If no threadId is known, do not guess; continue planning without renaming.
`,
    };

    console.log(`[plan] 🚀 Calling streamText(model="${mergedConfig.plannerModel}") …`);

    // Delegate
    return streamText({
      model: openrouter(mergedConfig.plannerModel),
      messages: [systemMessage, ...messages],
      tools,
      onFinish,
      stopWhen: (response: any) => response.toolCalls?.some(
        (call: { toolName?: string }) => call.toolName === 'reportCompletion',
      ),
      temperature: 0.2,
    });
  } catch (error: any) {
    console.error("[plan] 🛑 Error: ", error.message);
    throw new Error(`Failed to plan: ${error.message}`);
  }
}

/**
 * Build a Markdown design spec from a conversation transcript.
 */
export async function draftSpecFromMessages(
  messages: ModelMessage[],
  config: Partial<ProviderConfig> = {}
): Promise<string> {
  const mergedConfig = { ...defaultConfig, ...config };

  const transcript = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  const prompt = `You are a senior software engineer producing a concise internal design specification in Markdown format.
The following is the full planning conversation between the user and assistant delimited by triple backticks.
\`\`\`
${transcript}
\`\`\`

Write a clear, well-structured design spec that includes a title, overview, requirements, proposed solution, next steps and acceptance criteria.
Respond ONLY with Markdown.`;

  const { text } = await generateText({
    model: openrouter(mergedConfig.plannerModel),
    prompt,
    maxOutputTokens: mergedConfig.maxTokens,
    temperature: 0.3,
  });

  return text;
}

/**
 * Generate code using Fireworks
 * @param instruction Instruction for code generation
 * @param config Optional provider configuration
 * @returns A string containing the generated code
 */
export async function codegen(
  instruction: string,
  config: Partial<ProviderConfig> = {}
): Promise<string> {
  const mergedConfig = { ...defaultConfig, ...config };
  // Stub if no OpenRouter
  if (!openrouter) {
    console.warn('OpenRouter API key not set, returning stub code');
    return `// Generated stub code for: ${instruction}\n\nfunction implementFeature() {\n  // TODO: Implement the actual feature\n  console.log("Feature implementation pending");\n  return "Not yet implemented";\n}\n`;
  }

  try {
    const { text } = await generateText({
      model: openrouter(mergedConfig.codegenModel),
      prompt: `You are an expert software developer. Generate code based on the following instruction:\n\n${instruction}\n\nCode:`,
      maxOutputTokens: mergedConfig.maxTokens,
      temperature: 0.1,
      topP: 0.95,
    });
    return text;
  } catch (error) {
    console.error('Error generating code with OpenRouter via Vercel AI SDK:', error);
    throw new Error(`Failed to generate code: ${(error as Error).message}`);
  }
}
