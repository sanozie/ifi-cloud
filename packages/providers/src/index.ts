import { DefaultPlannerModel, DefaultCodegenModel } from '@ifi/shared';

// Vercel AI SDK v5
import { generateText, streamText, experimental_createMCPClient, type ModelMessage } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { openai } from '@ai-sdk/openai';

import { addMessage } from '@ifi/db';

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

// Cache configuration for MCP tools
const MCP_CACHE_TTL_MS = parseInt(process.env.MCP_TOOLS_CACHE_TTL_MS || '300000', 10);
let mcpToolsCache: any | undefined;
let mcpToolsCacheAt = 0;
let mcpFetchInFlight: Promise<any> | null = null;

// Instantiate model providers (null when missing API key so we can fall back to stub)
const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

/**
 * Stream a plan using OpenAI (UIMessageStreamResponse compatible)
 */
export async function plan(
  threadId: string,
  prompt: string,
  previousMessages?: ModelMessage[],
  config: Partial<ProviderConfig> = {}
): Promise<ReturnType<typeof streamText>> {
  try {
    const mergedConfig = { ...defaultConfig, ...config };

    // Load MCP tools if available
    const mcpTools = await getMcpTools();
    const tools = {
      ...mcpTools,
      web_search_preview: openai.tools.webSearchPreview({
        searchContextSize: 'high',
      }),
    };

    // System message that's always included
    const systemMessage = {
      role: 'system',
      content:
        'You are a technical planning assistant. Use tools when needed to gather context, then produce a clear implementation plan. If the message does not have anything to do with any software implementations, just respond normally.',
    } as const;

    // Create messages array with context from previous messages if provided
    const messages = previousMessages
      ? [
          systemMessage,
          ...previousMessages,
          { role: 'user', content: prompt } as const
        ] 
      : [
          systemMessage,
          { role: 'user', content: prompt } as const
        ];

    // Delegate
    return streamText({
      model: openrouter(mergedConfig.plannerModel),
      messages,
      tools,
      onStepFinish: async (response) => {
        if (threadId && response.text) {
          try {
            await addMessage({
              threadId,
              role: 'assistant',
              content: response.text,
              tokensPrompt: response.usage?.inputTokens,
              tokensCompletion: response.usage?.outputTokens,
              costUsd: response.usage?.totalTokens ? response.usage.totalTokens * 0.00001 : undefined, // Adjust cost calculation as needed
            });
          } catch (error) {
            console.error('Error saving assistant message:', error);
          }
        }
      },
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

/**
 * Build ToolSet that proxies to GitHub MCP server.
 */
async function getMcpTools(): Promise<any | undefined> {
  const base = process.env.MCP_GITHUB_URL;
  if (!base) {
    // no MCP configured – caller should treat as undefined
    return undefined;
  }

  // Check if cache is valid
  if (Date.now() - mcpToolsCacheAt < MCP_CACHE_TTL_MS && mcpToolsCache !== undefined) {
    return mcpToolsCache;
  }

  // If there's already a fetch in progress, wait for it
  if (mcpFetchInFlight) {
    await mcpFetchInFlight;
    return mcpToolsCache;
  }

  // Start a new fetch
  mcpFetchInFlight = (async () => {
    try {
      /** ----------------------------------------------------------------
       * Preferred path: create client with experimental_createMcpClient
       * ----------------------------------------------------------------*/
      try {
        const client = await experimental_createMCPClient({
          // Minimal HTTP transport – works with Smithery/AI SDK
          transport: {
            type: 'http',
            url: base.replace(/\/$/, ''),
          } as any,
        } as any);

        // Cache the tools
        mcpToolsCache = await client.tools();
        mcpToolsCacheAt = Date.now();
        return mcpToolsCache;
      } catch (err) {
        console.warn(
          'experimental_createMcpClient failed – falling back to HTTP search tool',
          err
        );
      }
    } catch (error) {
      // On failure, set cache to undefined but update timestamp for backoff
      mcpToolsCache = undefined;
      mcpToolsCacheAt = Date.now();
      console.error('Failed to fetch MCP tools:', error);
      return undefined;
    } finally {
      mcpFetchInFlight = null;
    }
  })();

  // Wait for the fetch to complete and return the result
  await mcpFetchInFlight;
  return mcpToolsCache;
}
