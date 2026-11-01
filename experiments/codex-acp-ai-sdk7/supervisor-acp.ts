import { fileURLToPath } from 'node:url';
import type { SupervisorPorts } from './supervisor-workflow.ts';

// Construct a closure only; provider/SDK imports and startup stay lazy.
export function createACPPort(cwd: string): SupervisorPorts['createACP'] {
  return async (signal) => {
    const { createACPProvider } = await import('@mcpc-tech/acp-ai-provider');
    const { generateText } = await import('ai');
    signal.throwIfAborted();
    const provider = createACPProvider({
      command: fileURLToPath(new URL('node_modules/.bin/codex-acp', import.meta.url)),
      env: { INITIAL_AGENT_MODE: 'read-only' },
      session: { cwd, mcpServers: [] },
      persistSession: true,
    });
    const model = provider.languageModel();
    return {
      connect: () => provider.connect(),
      initSession: () => provider.initSession(),
      getSessionId: () => provider.getSessionId(),
      cleanup: () => provider.cleanup(),
      generate: ({ text, image, signal: turnSignal, onCallStart }) =>
        generateText({
          model,
          maxRetries: 0,
          abortSignal: turnSignal,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text },
                { type: 'image', image, mediaType: 'image/png' },
              ],
            },
          ],
          onLanguageModelCallStart: onCallStart,
        }),
    };
  };
}
