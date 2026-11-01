import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAgentId } from '../app/src/agent-observation.ts';
import { agentCliError, executeAgentOperation } from './doom-agent-client.ts';

export { agentCliError };

// Importable for offline fake-transport tests. No environment/config/key reads.
/** @param {string[]} args @param {import('./doom-agent-client.ts').AgentClientOptions} [options] */
export async function runAgentCli(args, options = {}) {
  if (args.length === 1 && args[0] === 'attach') return executeAgentOperation({ op: 'attach' }, options);
  const deciding =
    [5, 11].includes(args.length) && args[0] === 'decide' && args[3] === '--observation' && isAgentId(args[4]);
  const starting =
    args.length === 9 &&
    args[0] === 'start-run' &&
    args[3] === '--observation' &&
    args[5] === '--session' &&
    args[7] === '--revision' &&
    /^(0|[1-9][0-9]*)$/.test(args[8]);
  const getting = args.length === 5 && ['get-prompt', 'get-config'].includes(args[0]) && args[3] === '--session';
  const setting = args.length === 11 && ['set-prompt', 'set-config'].includes(args[0]) && args[3] === '--session';
  if (
    ((args.length === 3 && args[0] === 'observe') || deciding || getting || setting || starting) &&
    args[1] === '--lease' &&
    isAbsolute(args[2])
  ) {
    const input = { op: args[0], leaseFile: args[2] };
    if (deciding || starting) input.observationId = args[4];
    if (starting) Object.assign(input, { sessionId: args[6], revision: Number(args[8]) });
    if (getting || setting) input.sessionId = args[4];
    if (setting || (deciding && args.length === 11)) {
      const offset = setting ? 5 : 7;
      const scope = {
        sessionId: setting ? args[4] : args[6],
        runId: args[offset + 1],
        revision: Number(args[offset + 3]),
      };
      if (setting) Object.assign(input, scope);
      else input.scope = scope;
    }
    if (setting) input[args[0] === 'set-config' ? 'configFile' : 'instructionsFile'] = args[10];
    return executeAgentOperation(input, options, () => {
      // Historically these syntax errors follow the lease read and ID creation.
      if (setting || (deciding && args.length === 11)) {
        const offset = setting ? 5 : 7;
        if (
          (!setting && args[5] !== '--session') ||
          args[offset] !== '--run' ||
          args[offset + 2] !== '--revision' ||
          !/^(0|[1-9][0-9]*)$/.test(args[offset + 3])
        )
          throw Error('Invalid command scope.');
      }
      if (setting && args[9] !== (args[0] === 'set-config' ? '--config-file' : '--instructions-file'))
        throw Error('Invalid settings file.');
    });
  }
  throw Error(
    'Usage: node scripts/doom-agent.mjs attach | observe --lease FILE | start-run --lease FILE --observation ID --session ID --revision N | get-prompt/get-config --lease FILE --session ID | set-prompt --lease FILE --session ID --run ID --revision N --instructions-file FILE | set-config --lease FILE --session ID --run ID --revision N --config-file FILE | decide --lease FILE --observation ID [--session ID --run ID --revision N] (absolute files required)',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runAgentCli(process.argv.slice(2)), null, 2));
  } catch (error) {
    // Do not print network bodies, stack traces, file contents or arbitrary errors.
    console.error(JSON.stringify(agentCliError(error)));
    process.exitCode = 1;
  }
}
