import {
  executeAgentOperation,
  type AgentClientOptions,
  type AttachedLease,
  type DetachedLease,
  type MaterializedObserve,
} from '../../../scripts/doom-agent-client.ts';

export type DoomClient = Readonly<{
  attach(): Promise<AttachedLease>;
  observe(): Promise<MaterializedObserve>;
  detach(): Promise<DetachedLease>;
}>;

const recovery = 'Use Stop Agent in the browser before another attach. No retry was made.';

type State = 'new' | 'attaching' | 'ready' | 'observing' | 'detaching' |
  'attach-failed' | 'detached' | 'detach-failed';

export function createDoomClient(options: AgentClientOptions = {}): DoomClient {
  const clientOptions = { ...options };
  let state: State = 'new';
  let lease: AttachedLease | undefined;

  function requireReady(): AttachedLease {
    if (state === 'attach-failed')
      throw new Error(`Doom attach unconfirmed; ownership may be held. ${recovery}`);
    if (state === 'detach-failed')
      throw new Error(`Doom detach unconfirmed; client is closed. ${recovery}`);
    if (state === 'new') throw new Error('Doom client is not attached.');
    if (state === 'attaching' || state === 'observing' || state === 'detaching')
      throw new Error('Doom client is busy.');
    if (state === 'detached') throw new Error('Doom client is closed.');
    return lease!;
  }

  return Object.freeze({
    async attach(): Promise<AttachedLease> {
      if (state === 'attach-failed')
        throw new Error(`Doom attach unconfirmed; ownership may be held. ${recovery}`);
      if (state === 'detach-failed')
        throw new Error(`Doom detach unconfirmed; client is closed. ${recovery}`);
      if (state === 'attaching' || state === 'observing' || state === 'detaching')
        throw new Error('Doom client is busy.');
      if (state === 'ready') throw new Error('Doom client is already attached.');
      if (state !== 'new') throw new Error('Doom client is closed.');

      state = 'attaching';
      try {
        const attached = await executeAgentOperation({ op: 'attach' }, clientOptions);
        lease = attached;
        state = 'ready';
        return attached;
      } catch {
        state = 'attach-failed';
        throw new Error(`Doom attach unconfirmed; ownership may be held. ${recovery}`);
      }
    },
    async observe(): Promise<MaterializedObserve> {
      const attached = requireReady();
      state = 'observing';
      try {
        return await executeAgentOperation({ op: 'observe', leaseFile: attached.leaseFile }, clientOptions);
      } catch {
        throw new Error('Doom observation unconfirmed. No retry was made.');
      } finally {
        state = 'ready';
      }
    },
    async detach(): Promise<DetachedLease> {
      const attached = requireReady();
      state = 'detaching';
      try {
        const released = await executeAgentOperation({ op: 'detach', leaseFile: attached.leaseFile }, clientOptions);
        state = 'detached';
        return released;
      } catch {
        state = 'detach-failed';
        throw new Error(`Doom detach unconfirmed; client is closed. ${recovery}`);
      }
    },
  });
}
