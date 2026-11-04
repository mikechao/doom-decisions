import { pathToFileURL } from 'node:url';
import { createDoomClient } from './doom-client.ts';
import { DoomAttachError, type DoomAttachErrorCode, type DoomClient } from './doom-client.ts';
import { createDoomTools } from './doom-tools.ts';

const usage = 'Usage: main.ts (takes no arguments; no arguments performs passive Doom attach)';
const unconfirmedAttachGuidance =
  'Doom attach unconfirmed; ownership may be held. If the local page is not running, from the repository root run `npm --prefix app run dev:agent`, open `http://127.0.0.1:5174`, and wait for the Doom page to be ready. If a page is already open, check its connection and use Stop Agent to release possible ownership before a fresh operator-initiated attempt. No automatic retry was made.';

const attachGuidance: Record<DoomAttachErrorCode, string> = {
  'no-ready-page':
    'The broker reports that no browser page is ready. From the repository root, start the local Doom page with `npm --prefix app run dev:agent`, open `http://127.0.0.1:5174`, and wait for the page to be ready before a fresh operator-initiated attempt. This response does not indicate whether npm is running.',
  'owner-already-attached':
    'Another client already holds the browser page. Stop or release the existing agent before trying again. This client did not acquire ownership.',
  'multiple-pages':
    'The browser reports a registration conflict. Resolve duplicate Doom pages, reload the intended page, then make a fresh operator-initiated attempt.',
  forbidden:
    'The broker rejected the attach as forbidden. Check the local dev server and browser setup before a fresh operator-initiated attempt.',
  'invalid-request':
    'The broker rejected the attach request as invalid. Check the local dev server and browser setup before a fresh operator-initiated attempt.',
  'lease-revoked':
    'The broker reported that the page lease was revoked during attach. Reload the intended Doom page before a fresh operator-initiated attempt.',
};

function safeAttachError(error: unknown): DoomAttachError {
  if (error instanceof DoomAttachError && error.code !== null)
    return new DoomAttachError(error.code, attachGuidance[error.code]);
  return new DoomAttachError(null, unconfirmedAttachGuidance);
}

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

export async function main(
  args: readonly string[] = process.argv.slice(2),
  makeDoomClient: typeof createDoomClient = createDoomClient,
) {
  if (args.length !== 0) throw new Error(usage);

  const doomClient: DoomClient = makeDoomClient();
  let attached = false;
  try {
    try {
      await doomClient.attach();
    } catch (error) {
      throw safeAttachError(error);
    }
    attached = true;
    const observation = await doomClient.observe();
    const doomTools = createDoomTools();
    console.log('Doom attach mode: passive observation only; no model inference or tool execution.');
    console.log('Doom observation:', {
      mapSlot: observation.mapIdentity.mapSlot,
      tic: observation.tic,
    });
    console.log('Doom tools composed:', Object.keys(doomTools));
  } finally {
    if (attached) {
      const detached = await doomClient.detach();
      console.log('Doom lease detached:', { released: detached.released });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const args = process.argv.slice(2);
    const safeDoomMessage =
      error instanceof DoomAttachError ||
      (error instanceof Error && [
        'Doom observation unconfirmed. No retry was made.',
        'Doom detach unconfirmed; client is closed. Use Stop Agent in the browser before another attach. No retry was made.',
      ].includes(error.message));
    if (error instanceof Error && error.message === usage) console.error(usage);
    else if (args.length === 0 && safeDoomMessage && error instanceof Error) console.error(error.message);
    else if (args.length === 0) console.error('Doom operation failed; ownership or cleanup may be uncertain. Check the local dev server and browser.');
    else console.error('Experiment failed.');
    process.exitCode = 1;
  });
}
