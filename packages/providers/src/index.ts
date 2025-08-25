import { DefaultPlannerModel, DefaultCodegenModel } from '@ifi/shared';

// Vercel AI SDK v5
import { generateText, streamText, type ModelMessage, tool } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod'
// Shell Execution
import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';

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

    // Build the completion-reporting tool (runtime type is preserved,
    // compile-time type is erased to `any`).
    const reportCompletionTool = mcptool({
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

    // --- searchCodebase MCP tool -----------------------------
    const searchCodebaseTool = mcptool({
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
          let repoDir = repository
            ? `${reposDir}/${repository}`
            : (
                await fs.readdir(reposDir, { withFileTypes: true })
              ).find((d) => d.isDirectory())?.name
              ? `${reposDir}/${(
                  await fs.readdir(reposDir, { withFileTypes: true })
                ).find((d) => d.isDirectory())!.name}`
              : null;

          if (!repoDir) {
            throw new Error('No repository found under /repos');
          }

          // Build command – Continue CLI headless query
          const cmd = `continue query "${query.replace(/\"/g, '\\"')}" --headless`;

          // Execute within repo directory
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

    // Assemble tools while forcing lightweight types to avoid deep inference
    const tools = {
      web_search_preview: openai.tools.webSearchPreview({ searchContextSize: 'high' }) as any,
      search_codebase: searchCodebaseTool as any,
      report_completion: reportCompletionTool as any,
    } as const;

    // System message that's always included
    const systemMessage: ModelMessage = {
      role: 'system',
      content:
        'You are a technical planning assistant. Use tools when needed to gather context, then produce a clear implementation plan. When you have completed your work, CALL the reportCompletion tool exactly once with a short summary. Do NOT include any completion text directly in the user-visible response.',
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
