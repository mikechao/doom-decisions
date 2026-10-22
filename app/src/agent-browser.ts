import {
  agentPath,
  isAgentId,
  type AgentObservation,
  type AgentDecisionResult,
} from './agent-observation.ts';
import {
  validAgentCommand,
  type AgentScope,
  type AgentPromptResult,
  type AgentConfigResult,
} from './agent-control.ts';
import type { DecisionConfiguration } from './decision-request.ts';

type Lease = { pageId: string; ownerId: string; epoch: string };
type Stream = Pick<EventSource, 'onmessage' | 'onerror' | 'close'>;
export type AgentBridgeState =
  | 'available'
  | 'attached'
  | 'authorized'
  | 'deciding'
  | 'settled'
  | 'stopped'
  | 'unavailable';
type Ports = {
  pageId: string;
  post(path: string, data: unknown, signal?: AbortSignal): Promise<unknown>;
  events(path: string): Stream;
  observe(assertFresh: () => void): Promise<AgentObservation>;
  attach?(epoch: string): void;
  allow?(epoch: string): boolean;
  allowRun?(epoch: string): boolean;
  prompt?(
    epoch: string,
    sessionId: string,
    fresh: () => void,
    update?: AgentScope & { instructions: string },
  ): AgentPromptResult;
  config?(
    epoch: string,
    sessionId: string,
    fresh: () => void,
    update?: AgentScope & { configuration: DecisionConfiguration },
  ): AgentConfigResult;
  stopAgent?(): void;
  decide?(
    epoch: string,
    observationId: string,
    fresh: () => void,
    scope?: AgentScope,
  ): Promise<AgentDecisionResult>;
  state(value: AgentBridgeState): void;
};

// Constructed once after verified preparation, only in dev:agent. EventSource's
// built-in retry is disabled by closing on error. Stop never calls Continuous Stop.
export function startAgentObservationBridge(ports: Ports) {
  let ended = false;
  let userRequested = false;
  let pageToken: string | undefined;
  let stream: Stream | undefined;
  let lease: Lease | undefined;
  let processing = false;
  const seen = new Set<string>();
  // An accepted result can still be awaiting its HTTP acknowledgement when the
  // next command arrives. Stop cancels every transfer still owned by this page.
  const uploads = new Set<AbortController>();
  function revoke() {
    if (!pageToken) return;
    const transfer = new AbortController();
    const closingStream = stream;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      transfer.abort();
      if (userRequested) closingStream?.close();
    };
    // Local admission is already revoked. Give intentional reason delivery a
    // bounded chance before explicit stream closure; failure stays generic.
    const timer = setTimeout(finish, 1000);
    void Promise.resolve()
      .then(() =>
        ports.post(
          `${agentPath}/revoke`,
          {
            pageId: ports.pageId,
            pageToken,
            ...(userRequested ? { reason: 'user-requested' } : {}),
          },
          transfer.signal,
        ),
      )
      .catch(() => {})
      .finally(finish);
  }
  function stop(intentional = false) {
    if (ended) return;
    // The local admission fence changes synchronously, before network/cleanup.
    ended = true;
    userRequested = intentional;
    lease = undefined;
    ports.stopAgent?.(); // Controller Stop is synchronous, before cancellation/network.
    for (const upload of uploads) upload.abort();
    if (!userRequested) stream?.close();
    ports.state('stopped');
    revoke();
  }
  async function message(raw: string) {
    if (ended) return;
    try {
      const data = JSON.parse(raw);
      if (data.type === 'revoked') {
        stop();
        return;
      }
      if (
        data.pageId !== ports.pageId ||
        !isAgentId(data.epoch) ||
        !isAgentId(data.ownerId)
      )
        throw Error('invalid');
      if (data.type === 'attached' && !lease) {
        lease = {
          pageId: data.pageId,
          ownerId: data.ownerId,
          epoch: data.epoch,
        };
        ports.attach?.(lease.epoch);
        ports.state('attached');
        return;
      }
      if (
        !validAgentCommand(
          data.type,
          Object.fromEntries(
            Object.entries(data).filter(([key]) => key !== 'type'),
          ),
        ) ||
        !lease ||
        data.epoch !== lease.epoch ||
        data.ownerId !== lease.ownerId ||
        !isAgentId(data.commandId) ||
        (data.type === 'decide' && !isAgentId(data.observationId))
      )
        throw Error('invalid');
      if (processing || seen.has(data.commandId)) throw Error('duplicate');
      seen.add(data.commandId);
      const admitted = lease;
      const fresh = () => {
        if (ended || lease !== admitted) throw Error('Agent lease revoked.');
      };
      processing = true;
      let observation: AgentObservation | null = null;
      let decision: AgentDecisionResult | null = null;
      let prompt: AgentPromptResult = { error: 'not-ready' };
      let config: AgentConfigResult = { error: 'not-ready' };
      const scope = data.runId
        ? {
            runId: data.runId,
            sessionId: data.sessionId,
            revision: data.revision,
          }
        : undefined;
      try {
        fresh();
        if (data.type === 'decide') {
          if (!ports.decide) throw Error('unavailable');
          ports.state('deciding');
          decision = await ports.decide(
            admitted.epoch,
            data.observationId,
            fresh,
            scope,
          );
          if (!ended) ports.state('settled');
        } else if (data.type === 'observe')
          observation = await ports.observe(fresh);
        else if (data.type === 'get-config' || data.type === 'set-config') {
          if (ports.config)
            config = ports.config(
              admitted.epoch,
              data.sessionId,
              fresh,
              data.type === 'set-config' && scope
                ? { ...scope, configuration: data.configuration }
                : undefined,
            );
        } else if (ports.prompt)
          prompt = ports.prompt(
            admitted.epoch,
            data.sessionId,
            fresh,
            data.type === 'set-prompt' && scope
              ? { ...scope, instructions: data.instructions }
              : undefined,
          );
        fresh();
      } catch {
        observation = null; // Fixed category only; never forward exception text.
      } finally {
        processing = false;
      }
      if (ended || lease !== admitted) return;
      const upload = new AbortController();
      uploads.add(upload);
      try {
        await ports.post(
          `${agentPath}/result`,
          {
            pageId: ports.pageId,
            pageToken,
            epoch: admitted.epoch,
            commandId: data.commandId,
            ...(data.type === 'decide'
              ? { decision }
              : data.type === 'observe'
                ? { observation }
                : data.type === 'get-config' || data.type === 'set-config'
                  ? { config }
                  : { prompt }),
          },
          upload.signal,
        );
        fresh(); // A late acknowledgement never restores a revoked lease.
      } finally {
        uploads.delete(upload);
      }
    } catch {
      stop();
    }
  }
  const ready = (async () => {
    try {
      const data = (await ports.post(`${agentPath}/register`, {
        pageId: ports.pageId,
      })) as {
        pageId: string;
        pageToken: string;
      };
      if (data.pageId !== ports.pageId || !isAgentId(data.pageToken))
        throw Error('invalid');
      pageToken = data.pageToken;
      if (ended) {
        revoke();
        return;
      }
      stream = ports.events(
        `${agentPath}/events?pageId=${ports.pageId}&pageToken=${pageToken}`,
      );
      stream.onmessage = (event) => {
        void message(event.data);
      };
      stream.onerror = () => stop();
      ports.state('available');
    } catch {
      stop();
      ports.state('unavailable');
    }
  })();
  return {
    stop: () => stop(true),
    disconnect: () => stop(),
    ready,
    authorizationRevoked() {
      if (!ended && lease) ports.state('attached');
    },
    allow() {
      if (ended || !lease || processing || !ports.allow?.(lease.epoch))
        return false;
      ports.state('authorized');
      return true;
    },
    allowRun() {
      if (ended || !lease || processing || !ports.allowRun?.(lease.epoch))
        return false;
      ports.state('attached');
      return true;
    },
  };
}
