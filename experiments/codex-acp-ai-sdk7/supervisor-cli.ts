import { open, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { executeAgentOperation, type AgentClientOptions } from '../../scripts/doom-agent-client.ts';
import { parseLease, record, requireLive } from './live-observation.ts';
import type { SupervisorPorts } from './supervisor-workflow.ts';

// Invocation-local state only; constructing these ports performs no I/O.
export function createCLIPorts(
  root: string,
  authorizedDecisions: number,
): Pick<
  SupervisorPorts,
  'attach' | 'observe' | 'setPrompt' | 'startRun' | 'decide' | 'getConfig' | 'readPng' | 'writeInstructions'
> & {
  cleanup(): Promise<void>;
} {
  requireLive(Number.isSafeInteger(authorizedDecisions) && authorizedDecisions > 0);
  const promptFiles: string[] = [];
  let promptNumber = 0;
  let leaseFile: string | undefined;
  let receiptNumber = 0;
  function options(signal: AbortSignal): AgentClientOptions {
    return {
      temporaryRoot: root,
      transport: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([signal, init?.signal ?? signal]) }),
    };
  }
  async function receipt<T>(result: T, signal: AbortSignal): Promise<T> {
    // Private local receipts retain correlation/native evidence, excluding
    // full instructions. Neither these files nor their IDs enter ACP input.
    const { configuration, instructions: _instructions, ...evidence } = record(result);
    if (configuration) {
      const { instructionTemplate: _template, ...settings } = record(configuration);
      evidence.configuration = settings;
    }
    await writeFile(join(root, `receipt-${++receiptNumber}.json`), JSON.stringify(evidence), {
      signal,
      flag: 'wx',
      mode: 0o600,
    });
    return result;
  }
  return {
    async attach(signal) {
      const result = await executeAgentOperation({ op: 'attach' }, options(signal));
      leaseFile = parseLease(result).leaseFile;
      return receipt(result, signal);
    },
    async observe(input, signal) {
      return receipt(await executeAgentOperation({ op: 'observe', ...input }, options(signal)), signal);
    },
    async setPrompt(input, signal) {
      return receipt(await executeAgentOperation({ op: 'set-prompt', ...input }, options(signal)), signal);
    },
    async startRun(input, signal) {
      return receipt(await executeAgentOperation({ op: 'start-run', ...input }, options(signal)), signal);
    },
    async decide(input, signal) {
      return receipt(await executeAgentOperation({ op: 'decide', ...input }, options(signal)), signal);
    },
    async getConfig(input, signal) {
      return receipt(await executeAgentOperation({ op: 'get-config', ...input }, options(signal)), signal);
    },
    readPng: (path, signal) => readFile(path, { signal }),
    async writeInstructions(text, signal) {
      requireLive(leaseFile);
      requireLive(promptNumber < authorizedDecisions);
      signal.throwIfAborted();
      const promptFile = join(dirname(leaseFile), `supervisor-instructions-${++promptNumber}.txt`);
      const handle = await open(promptFile, 'wx', 0o600);
      // EEXIST owns nothing. Register after creation, before a partial write can fail.
      promptFiles.push(promptFile);
      try {
        await handle.writeFile(text, { signal });
      } finally {
        await handle.close();
      }
      return promptFile;
    },
    // The entrypoint calls this after report publication, including failures.
    async cleanup() {
      const results = await Promise.allSettled(promptFiles.map((path) => rm(path, { force: true })));
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    },
  };
}
