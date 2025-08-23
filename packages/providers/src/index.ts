import { DefaultPlannerModel, DefaultCodegenModel } from '@ifi/shared';

// Vercel AI SDK v5
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createFireworks } from '@ai-sdk/fireworks';

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
const openai = process.env.OPENAI_API_KEY
  ? createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const fireworks = process.env.FIREWORKS_API_KEY
  ? createFireworks({ apiKey: process.env.FIREWORKS_API_KEY })
  : null;

/**
 * Generate a plan using OpenAI
 * @param prompt User prompt to generate a plan for
 * @param config Optional provider configuration
 * @returns A string containing the generated plan
 */
export async function plan(
  prompt: string,
  config: Partial<ProviderConfig> = {}
): Promise<string> {
  const mergedConfig = { ...defaultConfig, ...config };
  // Stub if no OpenAI
  if (!openai) {
    console.warn('OpenAI API key not set, returning stub plan');
    return `# Plan for: ${prompt}\n\n1. Analyze the requirements\n2. Design a solution\n3. Implement the code\n4. Test the implementation\n5. Refine based on feedback`;
  }

  try {
    const { text } = await generateText({
      model: openai(mergedConfig.plannerModel),
      messages: [
        { role: 'system', content: 'You are a technical planning assistant. Create a clear, step-by-step plan to implement the user’s request. Focus on concrete actions and implementation details.' },
        { role: 'user', content: prompt },
      ],
      maxOutputTokens: mergedConfig.maxTokens,
      temperature: 0.2,
    });
    return text;
  } catch (error) {
    console.error('Error generating plan with OpenAI via Vercel AI SDK:', error);
    throw new Error(`Failed to generate plan: ${(error as Error).message}`);
  }
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
