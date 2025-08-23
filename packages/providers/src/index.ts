import { DefaultPlannerModel, DefaultCodegenModel } from '@ifi/shared';

// Vercel AI SDK v5
import { generateText, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createFireworks } from '@ai-sdk/fireworks';
import { experimental_createMCPClient } from 'ai';
import { z } from 'zod';

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
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })

const fireworks = createFireworks({ apiKey: process.env.FIREWORKS_API_KEY })

/**
 * Generate a plan using OpenAI
 * @param prompt User prompt to generate a plan for
 * @param config Optional provider configuration
 * @returns A string containing the generated plan
 */
export async function plan(
  prompt: string,
  config: Partial<ProviderConfig> = {}
)  {
  const mergedConfig = { ...defaultConfig, ...config };

  // Load MCP tools if available
  const mcpTools = await getMcpTools();
  const tools = {
    ...mcpTools,
    web_search_preview: openai.tools.webSearchPreview({
      searchContextSize: 'high',
    }),
  };

  // Use streaming API and aggregate results
  return streamText({
    model: openai(mergedConfig.plannerModel),
    messages: [
      {
        role: 'system',
        content: 'You are a technical planning assistant. Use tools when needed to gather context, then produce a clear implementation plan. If the message does not have anything to do with any software implementations, just respond normally.',
      },
      {role: 'user', content: prompt},
    ],
    tools,
    maxOutputTokens: mergedConfig.maxTokens,
    temperature: 0.2,
  });
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
  // Stub if no Fireworks
  if (!fireworks) {
    console.warn('Fireworks API key not set, returning stub code');
    return `// Generated stub code for: ${instruction}\n\nfunction implementFeature() {\n  // TODO: Implement the actual feature\n  console.log("Feature implementation pending");\n  return "Not yet implemented";\n}\n`;
  }

  try {
    const { text } = await generateText({
      model: fireworks(mergedConfig.codegenModel),
      prompt: `You are an expert software developer. Generate code based on the following instruction:\n\n${instruction}\n\nCode:`,
      maxOutputTokens: mergedConfig.maxTokens,
      temperature: 0.1,
      topP: 0.95,
    });
    return text;
  } catch (error) {
    console.error('Error generating code with Fireworks via Vercel AI SDK:', error);
    throw new Error(`Failed to generate code: ${(error as Error).message}`);
  }
}

/**
 * Provider router
 */
export const providers = {
  plan,
  codegen,
};

export default providers;

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
