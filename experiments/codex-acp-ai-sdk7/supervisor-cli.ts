import { open, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runAgentCli } from '../../scripts/doom-agent.mjs';
import { parseLease, record, requireLive } from './live-observation.ts';
import type { SupervisorPorts } from './supervisor-workflow.ts';

// Invocation-local state only; constructing these ports performs no I/O.
export function createCLIPorts(root: string): Pick<SupervisorPorts, 'cli' | 'readPng' | 'writeInstructions'> & {
  cleanup(): Promise<void>;
} {
  const promptFiles: string[] = [];
  let promptNumber = 0;
  let leaseFile: string | undefined;
  let receiptNumber = 0;
  return {
    async cli(args, signal) {
      const result = await runAgentCli(args, {
        temporaryRoot: root,
        transport: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([signal, init?.signal ?? signal]) }),
      });
      if (args[0] === 'attach') leaseFile = parseLease(result).leaseFile;
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
    },
    readPng: (path, signal) => readFile(path, { signal }),
    async writeInstructions(text, signal) {
      requireLive(leaseFile);
      requireLive(promptNumber < 2);
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
