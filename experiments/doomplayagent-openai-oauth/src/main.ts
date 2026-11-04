import { pathToFileURL } from 'node:url';
import { initializeDoomClient } from './doom-client.ts';
import { createDoomTools } from './doom-tools.ts';

async function runOAuthSmoke() {
  const { generateText, tool, stepCountIs } = await import('ai');
  const { createOpenAI } = await import('@ai-sdk/openai');
  const { createOpenAIOAuthTransport } = await import('@openai-oauth/core');
  const { openaiCredentials } = await import('@openai-oauth/local');
  const { z } = await import('zod');

  const credentials = openaiCredentials();
  const transport = createOpenAIOAuthTransport({
    auth: () => credentials.getSession(),
  });
  const codexProvider = createOpenAI({
    apiKey: 'openai-oauth', // Placeholder string required by the SDK constructor
    baseURL: transport.baseURL,
    fetch: transport.fetch,
  });

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

export async function main(args: readonly string[] = process.argv.slice(2)) {
  if (args.length === 0) return runOAuthSmoke();
  if (args.length !== 1 || args[0] !== '--attach-doom')
    throw new Error('Usage: main.ts [--attach-doom]');

  const doomClient = await initializeDoomClient();
  try {
    const observation = await doomClient.observe();
    const doomTools = createDoomTools();
    console.log('Doom attach mode: passive observation only; no model inference or tool execution.');
    console.log('Doom observation:', {
      mapSlot: observation.mapIdentity.mapSlot,
      tic: observation.tic,
    });
    console.log('Doom tools composed:', Object.keys(doomTools));
  } finally {
    await doomClient.detach();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    // Doom errors are bounded locally; OAuth errors may contain sensitive details.
    const doomOnly = process.argv.length === 3 && process.argv[2] === '--attach-doom';
    console.error(doomOnly && error instanceof Error ? error.message : 'Experiment failed.');
    process.exitCode = 1;
  });
}
