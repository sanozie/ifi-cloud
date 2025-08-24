import { DefaultPlannerModel, DefaultCodegenModel } from '@ifi/shared';

// Vercel AI SDK v5
import { generateText, streamText, type ModelMessage, tool } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod'

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

    const tools = {
      web_search_preview: openai.tools.webSearchPreview({
        searchContextSize: 'high',
      }),
      reportCompletion: tool({
        name: 'reportCompletion',
        description: 'Signal task completion with summary and optional numeric code.',
        inputSchema: z.object({
          summary: z.string(),
          code: z.number().optional(), // single optional primitive is safe
        }),
        execute: async () => {
          return { acknowledged: true };
        },
      }),
    } as const;

    // System message that's always included
    const systemMessage = {
      role: 'system',
      content:
        'You are a technical planning assistant. Use tools when needed to gather context, then produce a clear implementation plan. If the message does not have anything to do with any software implementations, just respond normally.',
    } as const;

    // Create message array with context from previous messages if provided
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
      onStepFinish,
      stopWhen: (response: any) =>
        response.toolCalls?.some((call: any) => call.toolName === 'reportCompletion'),
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
