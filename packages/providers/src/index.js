"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.providers = exports.defaultConfig = void 0;
exports.plan = plan;
exports.codegen = codegen;
const openai_1 = __importDefault(require("openai"));
const shared_1 = require("@ifi/shared");
/**
 * Default provider configuration
 */
exports.defaultConfig = {
    plannerModel: process.env.CODEGEN_PLANNER_MODEL || shared_1.DefaultPlannerModel,
    codegenModel: process.env.CODEGEN_MODEL || shared_1.DefaultCodegenModel,
    maxTokens: parseInt(process.env.CODEGEN_MAX_TOKENS || '8192', 10),
    timeoutMs: parseInt(process.env.CODEGEN_TIMEOUT_MS || '60000', 10),
    costCapUsd: parseFloat(process.env.CODEGEN_COST_CAP_USD || '1.0'),
};
// Initialize OpenAI client if API key is available
const openaiClient = process.env.OPENAI_API_KEY
    ? new openai_1.default({
        apiKey: process.env.OPENAI_API_KEY,
    })
    : null;
/**
 * Generate a plan using OpenAI
 * @param prompt User prompt to generate a plan for
 * @param config Optional provider configuration
 * @returns A string containing the generated plan
 */
async function plan(prompt, config = {}) {
    const mergedConfig = { ...exports.defaultConfig, ...config };
    // If OpenAI client is not available, return a stub plan
    if (!openaiClient) {
        console.warn('OpenAI API key not set, returning stub plan');
        return `# Plan for: ${prompt}\n\n1. Analyze the requirements\n2. Design a solution\n3. Implement the code\n4. Test the implementation\n5. Refine based on feedback`;
    }
    try {
        const response = await openaiClient.chat.completions.create({
            model: mergedConfig.plannerModel,
            messages: [
                {
                    role: 'system',
                    content: 'You are a technical planning assistant. Create a clear, step-by-step plan to implement the user\'s request. Focus on concrete actions and implementation details.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            max_tokens: mergedConfig.maxTokens,
            temperature: 0.2,
        });
        return response.choices[0]?.message?.content || 'Failed to generate plan';
    }
    catch (error) {
        console.error('Error generating plan with OpenAI:', error);
        throw new Error(`Failed to generate plan: ${error.message}`);
    }
}
/**
 * Generate code using Fireworks
 * @param instruction Instruction for code generation
 * @param config Optional provider configuration
 * @returns A string containing the generated code
 */
async function codegen(instruction, config = {}) {
    const mergedConfig = { ...exports.defaultConfig, ...config };
    // If Fireworks API key is not available, return a stub code
    if (!process.env.FIREWORKS_API_KEY) {
        console.warn('Fireworks API key not set, returning stub code');
        return `// Generated stub code for: ${instruction}\n\nfunction implementFeature() {\n  // TODO: Implement the actual feature\n  console.log("Feature implementation pending");\n  return "Not yet implemented";\n}\n`;
    }
    try {
        const response = await globalThis.fetch('https://api.fireworks.ai/inference/v1/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.FIREWORKS_API_KEY}`
            },
            body: JSON.stringify({
                model: mergedConfig.codegenModel,
                prompt: `You are an expert software developer. Generate code based on the following instruction:\n\n${instruction}\n\nCode:`,
                max_tokens: mergedConfig.maxTokens,
                temperature: 0.1,
                top_p: 0.95,
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Fireworks API error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        return data.choices[0]?.text || 'Failed to generate code';
    }
    catch (error) {
        console.error('Error generating code with Fireworks:', error);
        throw new Error(`Failed to generate code: ${error.message}`);
    }
}
/**
 * Provider router
 */
exports.providers = {
    plan,
    codegen,
};
exports.default = exports.providers;
