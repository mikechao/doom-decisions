import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  agentOrigin, agentPath, agentPngBytes, isAgentId, parseAgentObservation,
} from '../app/src/agent-observation.ts';

const errors = new Set([
  'forbidden', 'invalid-request', 'no-ready-page', 'multiple-pages',
  'owner-already-attached', 'lease-revoked', 'duplicate-command',
  'observation-busy', 'observation-unavailable', 'invalid-observation',
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
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
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
  if (args.length === 3 && args[0] === 'observe' && args[1] === '--lease' && isAbsolute(args[2])) {
    const lease = leaseValue(JSON.parse(await readFile(args[2], 'utf8')));
    const commandId = randomUUID();
    const result = await post('observe', { ...lease, commandId });
    if (Object.keys(result).sort().join(',') !== 'commandId,epoch,observation,pageId' ||
        result.pageId !== lease.pageId || result.epoch !== lease.epoch || result.commandId !== commandId)
      throw Error('Invalid observation correlation.');
    const observation = parseAgentObservation(result.observation);
    const bytes = agentPngBytes(observation.png);
    if (createHash('sha256').update(bytes).digest('hex') !== observation.pngSha256)
      throw Error('Invalid observation PNG hash.');
    const pngPath = join(dirname(args[2]), `${commandId}.png`);
    await writeFile(pngPath, bytes, { mode: 0o600, flag: 'wx' });
    const { png: _png, ...metadata } = observation;
    return { pageId: lease.pageId, epoch: lease.epoch, commandId, pngPath, ...metadata };
  }
  throw Error('Usage: node scripts/doom-agent.mjs attach | observe --lease ABSOLUTE_LEASE_FILE');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runAgentCli(process.argv.slice(2)), null, 2));
  } catch (error) {
    // Do not print network bodies, stack traces, file contents or arbitrary errors.
    const message = errors.has(error?.message) || error?.message?.startsWith('Usage:')
      ? error.message : 'Agent observation failed. Check the dev:agent page and lease; no retry was made.';
    console.error(JSON.stringify({ error: message }));
    process.exitCode = 1;
  }
}
