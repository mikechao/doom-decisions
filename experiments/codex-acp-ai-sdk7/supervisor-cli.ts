import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runAgentCli } from '../../scripts/doom-agent.mjs';
import { parseLease, record, requireLive } from './live-observation.ts';
import type { SupervisorPorts } from './supervisor-workflow.ts';

// Invocation-local state only; constructing these ports performs no I/O.
export function createCLIPorts(root: string): Pick<SupervisorPorts, 'cli' | 'readPng' | 'writeInstructions'> & {
  cleanup(): Promise<void>;
} {
  let promptFile: string | undefined;
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
      promptFile = join(dirname(leaseFile), 'supervisor-instructions.txt');
      await writeFile(promptFile, text, { signal, flag: 'wx', mode: 0o600 });
      return promptFile;
    },
    // The entrypoint calls this after report publication, including failures.
    async cleanup() {
      if (promptFile) await rm(promptFile, { force: true });
    },
  };
}
