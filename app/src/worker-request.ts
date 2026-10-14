import { healthy } from './native-observation-checks.ts';
import type {
  Operation,
  Reply,
  RequestExtra,
  Results,
  Success,
} from './worker-shared.ts';

// A structural view of the existing run: cancellation and receipts stay shared.
type WorkerRequestLifecycle = {
  cancel?: ((error: Error) => void) | null;
  evidence: {
    activeOperation?: Operation;
    workerError?: string;
    operations: {
      op: Operation;
      elapsedMs: number;
      result: Results[Operation];
    }[];
  };
};
type WorkerRequestHooks = {
  assertCurrent(): void;
  retire(): void;
};

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}

// The caller admits the operation before delegating its dispatch and settlement.
export function requestWorker<O extends Operation>(
  worker: Worker,
  lifecycle: WorkerRequestLifecycle,
  op: O,
  hooks: WorkerRequestHooks,
  ...args: O extends keyof RequestExtra
    ? [extra: RequestExtra[O], transfer?: Transferable[]]
    : [extra?: undefined, transfer?: Transferable[]]
): Promise<Success<O>> {
  const [extra = {}, transfer = []] = args;
  return new Promise<Success<O>>((resolve, reject) => {
    let settled = false;
    const finish = (
      ...outcome: [error: unknown] | [error: null, data: Success<O>]
    ) => {
      const [error, data] = outcome;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      lifecycle.cancel = null;
      if (error) {
        hooks.retire();
        reject(error);
      } else if (data) resolve(data);
      else {
        hooks.retire();
        reject(Error('Missing Worker completion receipt.'));
      }
    };
    const timer = setTimeout(
      () =>
        finish(Error(`${op} watchdog expired (2000 ms); completion unknown.`)),
      2000,
    );
    lifecycle.cancel = (error) => finish(error);
    worker.onerror = () =>
      finish(Error(`${op} Worker fault; completion unknown.`));
    worker.onmessageerror = () =>
      finish(Error(`${op} Worker reply unreadable; completion unknown.`));
    worker.onmessage = ({ data: incoming }: MessageEvent<unknown>) => {
      try {
        hooks.assertCurrent();
        check(
          incoming !== null &&
            typeof incoming === 'object' &&
            'op' in incoming &&
            incoming.op === op,
          'Unexpected Worker reply; completion unknown.',
        );
        // The exact bundled Worker owns this receipt shape. This assertion is a
        // protocol contract, not payload validation; native checks below still run.
        const data = incoming as Reply<O>;
        if (!data.ok) {
          // The Worker has no credential; retain only its bounded diagnostic.
          lifecycle.evidence.workerError =
            typeof data.error === 'string'
              ? data.error.slice(0, 500)
              : 'Worker operation failed.';
          throw Error(lifecycle.evidence.workerError);
        }
        lifecycle.evidence.operations.push({
          op,
          elapsedMs: data.elapsedMs,
          result: data.result,
        });
        delete lifecycle.evidence.activeOperation;
        // An action fault can still contain independently verifiable completed
        // steps. The action verifier must evaluate those before rejecting it.
        if (op !== 'action') healthy(data.result);
        finish(null, data);
      } catch (error) {
        finish(error);
      }
    };
    try {
      worker.postMessage({ op, ...extra }, transfer);
    } catch {
      finish(Error(`${op} dispatch failed; completion unknown.`));
    }
  });
}
