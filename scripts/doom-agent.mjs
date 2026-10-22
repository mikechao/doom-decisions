import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  agentOrigin, agentPath, agentPngBytes, isAgentId, parseAgentObservation, parseAgentDecisionResult,
} from '../app/src/agent-observation.ts';
import { validAgentCommand, parseAgentPromptResult, parseAgentConfigResult, promptErrors, maxAgentInstructions } from '../app/src/agent-control.ts';

const errors = new Set([
  'forbidden', 'invalid-request', 'no-ready-page', 'multiple-pages',
  'owner-already-attached', 'lease-revoked', 'duplicate-command',
  'observation-busy', 'observation-unavailable', 'invalid-observation',
  ...promptErrors,
]);
function leaseValue(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'epoch,ownerId,pageId' ||
      !Object.values(value).every(isAgentId)) throw Error('Invalid agent lease.');
  return value;
}

// Importable for offline fake-transport tests. No environment/config/key reads.
export async function runAgentCli(args, { transport = fetch, temporaryRoot = tmpdir() } = {}) {
  async function post(op, body) {
    const response = await transport(`${agentOrigin}${agentPath}/${op}`, {
      method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Doom-Agent': 'cli' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(op === 'decide' ? 35000 : 15000),
    });
    const text = await response.text();
    if (text.length > 2_100_000) throw Error('Invalid bridge response.');
    const data = JSON.parse(text);
    if (!response.ok) throw Error(errors.has(data?.error) ? data.error : 'Agent bridge rejected request.');
    return data;
  }
  if (args.length === 1 && args[0] === 'attach') {
    const ownerId = randomUUID();
    const lease = leaseValue(await post('attach', { ownerId }));
    if (lease.ownerId !== ownerId) throw Error('Invalid agent lease.');
    const directory = await mkdtemp(join(temporaryRoot, 'doom-agent-'));
    const leaseFile = join(directory, 'lease.json');
    await writeFile(leaseFile, JSON.stringify(lease), { mode: 0o600, flag: 'wx' });
    return { ...lease, leaseFile };
  }
  const deciding = [5, 11].includes(args.length) && args[0] === 'decide' && args[3] === '--observation' && isAgentId(args[4]);
  const configCommand = args[0] === 'get-config' || args[0] === 'set-config';
  const getting = args.length === 5 && ['get-prompt', 'get-config'].includes(args[0]) && args[3] === '--session';
  const setting = args.length === 11 && ['set-prompt', 'set-config'].includes(args[0]) && args[3] === '--session';
  if (((args.length === 3 && args[0] === 'observe') || deciding || getting || setting) && args[1] === '--lease' && isAbsolute(args[2])) {
    const lease = leaseValue(JSON.parse(await readFile(args[2], 'utf8')));
    // Same observation always reserves the same decision ID. Retrying can never
    // submit a second decision, even after an HTTP timeout/lost response.
    const commandId = deciding ? args[4] : randomUUID();
    const command = {
      ...lease, commandId, ...(deciding ? { observationId: args[4] } : {}),
    };
    if (getting || setting) command.sessionId = args[4];
    if (setting || (deciding && args.length === 11)) {
      const offset = setting ? 5 : 7;
      if ((!setting && args[5] !== '--session') || args[offset] !== '--run' || args[offset + 2] !== '--revision' ||
        !/^(0|[1-9][0-9]*)$/.test(args[offset + 3])) throw Error('Invalid command scope.');
      Object.assign(command, { sessionId: setting ? args[4] : args[6], runId: args[offset + 1], revision: Number(args[offset + 3]) });
    }
    if (setting) {
      if (args[9] !== (configCommand ? '--config-file' : '--instructions-file') || !isAbsolute(args[10]) || /(^|\/)\.env[^/]*$/.test(args[10])) throw Error('Invalid settings file.');
      const bytes = await readFile(args[10]);
      if (bytes.length > maxAgentInstructions * 4 + (configCommand ? 1024 : 0)) throw Error('Invalid settings file.');
      if (configCommand) command.configuration = JSON.parse(bytes.toString('utf8'));
      else command.instructions = bytes.toString('utf8');
    }
    const op = args[0];
    if (!validAgentCommand(op, command)) throw Error('Invalid command.');
    const result = await post(op, command);
    const field = deciding ? 'decision' : getting || setting ? configCommand ? 'config' : 'prompt' : 'observation';
    if (Object.keys(result).sort().join(',') !== ['commandId', 'epoch', field, 'pageId'].sort().join(',') ||
        result.pageId !== lease.pageId || result.epoch !== lease.epoch || result.commandId !== commandId)
      throw Error('Invalid command correlation.');
    if (getting || setting) {
      const prompt = configCommand ? parseAgentConfigResult(result.config) : parseAgentPromptResult(result.prompt);
      if ('error' in prompt) throw Error(prompt.error);
      if (prompt.sessionId !== command.sessionId || (setting && prompt.run?.runId !== command.runId)) throw Error('Invalid prompt correlation.');
      return { pageId: lease.pageId, epoch: lease.epoch, commandId, ...prompt };
    }
    const decision = deciding ? parseAgentDecisionResult(result.decision) : null;
    if (decision && decision.beforeObservationId !== args[4]) throw Error('Invalid decision correlation.');
    const observation = decision ? decision.observation : parseAgentObservation(result.observation);
    let pngPath = null, metadata = null;
    if (observation) {
      const bytes = agentPngBytes(observation.png);
      if (createHash('sha256').update(bytes).digest('hex') !== observation.pngSha256)
        throw Error('Invalid observation PNG hash.');
      pngPath = join(dirname(args[2]), `${commandId}.png`);
      await writeFile(pngPath, bytes, { mode: 0o600, flag: 'wx' });
      const { png: _png, ...rest } = observation;
      metadata = rest;
    }
    const correlation = { pageId: lease.pageId, epoch: lease.epoch, commandId, pngPath };
    if (decision) return { ...correlation, ...decision, observation: metadata };
    return { ...correlation, ...metadata };
  }
  throw Error('Usage: node scripts/doom-agent.mjs attach | observe --lease FILE | get-prompt/get-config --lease FILE --session ID | set-prompt --lease FILE --session ID --run ID --revision N --instructions-file FILE | set-config --lease FILE --session ID --run ID --revision N --config-file FILE | decide --lease FILE --observation ID [--session ID --run ID --revision N] (absolute files required)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runAgentCli(process.argv.slice(2)), null, 2));
  } catch (error) {
    // Do not print network bodies, stack traces, file contents or arbitrary errors.
    const message = errors.has(error?.message) || error?.message?.startsWith('Usage:')
      ? error.message : 'Agent command failed; outcome may be unknown. Check the dev:agent page and lease; no retry was made.';
    console.error(JSON.stringify({ error: message }));
    process.exitCode = 1;
  }
}
