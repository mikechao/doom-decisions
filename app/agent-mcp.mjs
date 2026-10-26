import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { agentCliError, runAgentCli } from '../scripts/doom-agent.mjs';
import { isAgentId } from './src/agent-observation.ts';

const file = z.string().refine(isAbsolute, 'Absolute file required.');
const id = z.string().refine(isAgentId, 'Agent UUID required.');
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const lease = { leaseFile: file };
const session = { ...lease, sessionId: id };
const scope = { ...session, runId: id, revision };
const tools = [
  ['attach', {}, 'Attach once; grants no attempts.'],
  [
    'observe',
    lease,
    'Read verified passive evidence, configuration/revision and run counters; follow skill image rules.',
  ],
  [
    'get-config',
    session,
    'Read effective configuration and bounded run counters.',
  ],
  [
    'get-prompt',
    session,
    'Read effective instructions and bounded run counters.',
  ],
  [
    'start-run',
    { ...session, observationId: id, revision },
    'Claim the configured allowance once; never retry.',
  ],
  [
    'set-config',
    { ...scope, configFile: file },
    'CAS-replace configuration from file; obtain a fresh observation.',
  ],
  [
    'set-prompt',
    { ...scope, instructionsFile: file },
    'CAS-replace disclosed instructions from file; obtain a fresh observation.',
  ],
  [
    'decide',
    {
      ...lease,
      observationId: id,
      sessionId: id.optional(),
      runId: id.optional(),
      revision: revision.optional(),
    },
    'Request one provider-selected action using fresh evidence; never retry.',
  ],
];

function argumentsFor(op, input) {
  if (op === 'attach') return [op];
  const args = [op, '--lease', input.leaseFile];
  if (op === 'observe') return args;
  if (op === 'decide' || op === 'start-run')
    args.push('--observation', input.observationId);
  if (input.sessionId !== undefined) args.push('--session', input.sessionId);
  if (input.runId !== undefined) args.push('--run', input.runId);
  if (input.revision !== undefined)
    args.push('--revision', String(input.revision));
  if (op === 'set-config') args.push('--config-file', input.configFile);
  if (op === 'set-prompt')
    args.push('--instructions-file', input.instructionsFile);
  return args;
}

// No bridge I/O, lease discovery or allowance on construction/connection/listing.
// Tests inject the same fake transport and temporaryRoot as the CLI tests.
export function createAgentMcpServer({
  transport = fetch,
  temporaryRoot,
} = {}) {
  const server = new McpServer({ name: 'doom-decisions', version: '0.1.0' });
  const lifetime = new AbortController();
  server.server.onclose = () => lifetime.abort();
  for (const [op, shape, description] of tools) {
    let inputSchema = z.strictObject(shape);
    if (op === 'decide')
      inputSchema = inputSchema.refine((input) => {
        const count = ['sessionId', 'runId', 'revision'].filter(
          (key) => input[key] !== undefined,
        ).length;
        return count === 0 || count === 3;
      }, 'Supply sessionId, runId and revision together.');
    server.registerTool(
      `doom_${op.replaceAll('-', '_')}`,
      { description, inputSchema },
      async (input, context) => {
        const signal = AbortSignal.any([
          lifetime.signal,
          context.mcpReq.signal,
        ]);
        try {
          signal.throwIfAborted();
          const result = await runAgentCli(argumentsFor(op, input), {
            temporaryRoot,
            transport: (url, options) =>
              transport(url, {
                ...options,
                signal: AbortSignal.any([options.signal, signal]),
              }),
          });
          signal.throwIfAborted();
          // Delivery success is not gameplay success: retain every outcome field.
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
            isError: false,
          };
        } catch (error) {
          const result = agentCliError(error);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
            isError: true,
          };
        }
      },
    );
  }
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = () =>
    console.error(
      'Doom MCP protocol failure; completion may be unknown. No retry was made.',
    );
  const handle = serveStdio(() => createAgentMcpServer(), { onerror: report });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void handle.close().catch(report);
    });
}
