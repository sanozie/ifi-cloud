import { DefaultPlannerModel, DefaultCodegenModel } from '@ifi/shared';

// Vercel AI SDK v5
import { generateText, streamText, type ModelMessage, tool } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod'
// Shell Execution
import { exec } from 'child_process';
import { promisify } from 'util';
import fs, { Dirent } from 'fs';
import { promises } from 'fs';
// DB helpers
import {
  getThread,
  upsertDraftSpec,
  getLatestDraftSpec,
  createJob,
} from '@ifi/db';
import { JobStatus } from '@ifi/shared';

const execAsync = promisify(exec);

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
    name: 'searchCodebase',
    description:
      'Search a local cloned repository with Continue CLI using natural language queries.',
    inputSchema: z.object({
      query: z.string().describe('Natural language question about the codebase'),
      repository: z
        .string()
        .describe(
          'Optional repository name (folder under /repos). Defaults to first available.',
        )
        .optional(),
    }),
    async execute(
      {
        query,
        repository,
      }: {
        query: string;
        repository?: string;
      },
    ) {
      try {
        // Determine target repo directory (static fs import)
        const reposDir = '/repos';
        let dirEntries: Dirent[] | null = null;
        try {
          dirEntries = await promises.readdir(reposDir, { withFileTypes: true });
        } catch (e: any) {
          if (e?.code === 'ENOENT') {
            return {
              warning: true,
              message:
                '📂 The /repos directory does not exist. Repository setup was likely skipped (e.g., during CI).',
            };
          }
          throw e;
        }

        const repoDir =
          repository
            ? `${reposDir}/${repository}`
            : dirEntries.find((d) => d.isDirectory())?.name
            ? `${reposDir}/${dirEntries.find((d) => d.isDirectory())!.name}`
            : null;

        if (!repoDir) {
          return {
            warning: true,
            message:
              '📂 The /repos directory exists but contains no cloned repositories. Repository setup may have been skipped (e.g., in CI).',
          };
        }

        const cmd = `continue query "${query.replace(/\"/g, '\\"')}" --headless`;
        const { stdout } = await execAsync(cmd, { cwd: repoDir, maxBuffer: 5_000_000 });

        return { output: stdout.trim() };
      } catch (err: any) {
        return {
          error: true,
          message: `searchCodebase execution failed: ${err.message}`,
        };
      }
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
        const modelMessages: ModelMessage[] = thread.messages.map((m) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        }));
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
 * Stream a plan using OpenAI (UIMessageStreamResponse compatible)
 */
export async function plan(
  prompt: string,
  previousMessages?: ModelMessage[],
  onStepFinish?: (step: any) => void,
  config: Partial<ProviderConfig> = {}
) {
  try {
    const mergedConfig = { ...defaultConfig, ...config };

    const mcptool: any = tool;

    // Instantiate tools via helper factories
    const reportCompletionTool = createReportCompletionTool(mcptool);
    const searchCodebaseTool = createSearchCodebaseTool(mcptool);
    const draftSpecTool = createDraftSpecTool(mcptool);
    const finalizeSpecTool = createFinalizeSpecTool(mcptool);

    // Assemble tools while forcing lightweight types to avoid deep inference
    const tools = {
      web_search_preview: openai.tools.webSearchPreview({ searchContextSize: 'high' }) as any,
      search_codebase: searchCodebaseTool as any,
      report_completion: reportCompletionTool as any,
      draft_spec: draftSpecTool as any,
      finalize_spec: finalizeSpecTool as any,
    } as const;

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

General guidelines:
• Keep all normal conversation messages concise and focused.  
• NEVER leak internal reasoning or tool call JSON to the user—only properly formatted tool calls.  
• Do NOT output any completion text directly; the client UI renders results from tools.  
`,
    };

    // Create message array with context from previous messages if provided
    const userMessage: ModelMessage = { role: 'user', content: prompt };
    const messages: ModelMessage[] = previousMessages
      ? [systemMessage, ...previousMessages, userMessage]
      : [systemMessage, userMessage];

    // Delegate
    return streamText({
      model: openrouter(mergedConfig.plannerModel),
      messages,
      tools,
      onStepFinish,
      stopWhen: (response: any) =>
        response.toolCalls?.some(
          (call: { toolName?: string }) => call.toolName === 'reportCompletion',
        ),
      temperature: 0.2,
    });
  } catch (error: any) {
    console.error('Error planning with OpenAI via Vercel AI SDK:', error);
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
