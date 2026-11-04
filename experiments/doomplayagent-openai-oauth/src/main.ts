import { generateText, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAIOAuthTransport } from '@openai-oauth/core';
import { openaiCredentials } from '@openai-oauth/local';
import { z } from 'zod';

// 1. Load ~/.codex/auth.json credentials & create an in-process OAuth transport
const credentials = openaiCredentials();
const transport = createOpenAIOAuthTransport({
  auth: () => credentials.getSession(),
});

// 2. Initialize the official @ai-sdk/openai provider with the OAuth transport
const codexProvider = createOpenAI({
  apiKey: 'openai-oauth', // Placeholder string required by the SDK constructor
  baseURL: transport.baseURL,
  fetch: transport.fetch,
});

// 3. Call generateText with native AI SDK tools
async function main() {
  const result = await generateText({
    model: codexProvider('gpt-6-luna'),
    tools: {
      addNumbers: tool({
        description: 'Add two numbers together',
        inputSchema: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: async ({ a, b }) => ({ sum: a + b }),
      }),
    },
    stopWhen: stepCountIs(3),
    prompt: 'Tell a joke about AI and cats',
  });

  console.log('Final Text:', result.text);
  console.log('Steps Executed:', result.steps.length);
  console.log('Usage:', result.usage);
}

main();