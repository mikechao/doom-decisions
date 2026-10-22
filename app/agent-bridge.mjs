import { createHash, randomUUID } from 'node:crypto';
import {
  agentOrigin,
  agentPath,
  agentPngBytes,
  isAgentId,
  parseAgentObservation,
  parseAgentDecisionResult,
} from './src/agent-observation.ts';
import {
  validAgentCommand,
  parseAgentPromptResult,
  parseAgentConfigResult,
} from './src/agent-control.ts';

// One page, one lease, one outstanding observation. No queue, retry or durable state.
export function createAgentBridge() {
  let page;
  // Only the most recently closed lease, with no grants/config/results. This
  // survives registration of a replacement page but can never authorize it.
  let terminal;
  const json = (res, status, data) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(data));
  };
  const fail = (res, error, status = 409) => json(res, status, { error });
  const event = (data) =>
    page?.stream?.write(`data: ${JSON.stringify(data)}\n\n`);
  function close(error = 'lease-revoked') {
    const old = page;
    page = undefined;
    if (!old) return;
    if (old.lease) terminal = { ...old.lease, error };
    clearTimeout(old.connectionTimer);
    clearInterval(old.heartbeat);
    if (old.pending) {
      clearTimeout(old.pending.timer);
      fail(old.pending.res, error);
    }
    old.stream?.end();
  }
  async function body(req) {
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 2_100_000) throw Error('body');
    }
    if (req.aborted || req.complete !== true) throw Error('incomplete-body');
    return JSON.parse(text);
  }
  function shape(data, fields) {
    return (
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      Object.keys(data).length === fields.length &&
      fields.every((key) => Object.hasOwn(data, key))
    );
  }
  function browser(req) {
    return (
      req.headers.origin === agentOrigin &&
      req.headers['x-doom-agent'] === 'page' &&
      req.headers['sec-fetch-site'] !== 'cross-site'
    );
  }
  function cli(req) {
    return (
      req.headers.origin === undefined &&
      req.headers['sec-fetch-site'] === undefined &&
      req.headers['x-doom-agent'] === 'cli'
    );
  }
  function ownsPage(data) {
    return page && data.pageId === page.id && data.pageToken === page.token;
  }
  function ownsLease(data) {
    return (
      page?.stream &&
      page.lease &&
      data.pageId === page.id &&
      data.epoch === page.lease.epoch &&
      data.ownerId === page.lease.ownerId
    );
  }
  async function route(req, res, next) {
    const url = new URL(req.url, agentOrigin);
    if (!url.pathname.startsWith(`${agentPath}/`)) return next();
    if (
      req.headers.host !== new URL(agentOrigin).host ||
      !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    )
      return fail(res, 'forbidden', 403);
    if (url.pathname === `${agentPath}/events` && req.method === 'GET') {
      if (
        (req.headers.origin !== undefined &&
          req.headers.origin !== agentOrigin) ||
        req.headers['sec-fetch-site'] !== 'same-origin' ||
        !ownsPage({
          pageId: url.searchParams.get('pageId'),
          pageToken: url.searchParams.get('pageToken'),
        }) ||
        page.stream
      )
        return fail(res, 'forbidden', 403);
      const active = page;
      clearTimeout(active.connectionTimer);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');
      active.stream = res;
      active.heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 1000);
      active.heartbeat.unref();
      res.once('close', () => {
        if (page === active) close();
      });
      return;
    }
    if (
      req.method !== 'POST' ||
      req.headers['content-type'] !== 'application/json' ||
      (!browser(req) && !cli(req)) ||
      url.search
    )
      return fail(res, 'forbidden', 403);
    let data;
    try {
      data = await body(req);
    } catch {
      return fail(res, 'invalid-request', 400);
    }
    const op = url.pathname.slice(agentPath.length + 1);
    if (op === 'register' && browser(req)) {
      if (!shape(data, ['pageId']) || !isAgentId(data.pageId))
        return fail(res, 'invalid-request', 400);
      if (page) {
        // A second page never takes over. Revoke the existing lease and fence the
        // original page too; both pages must reload after the ambiguity is removed.
        event({ type: 'revoked' });
        page.conflict = true;
        if (page.pending) {
          const pending = page.pending;
          page.pending = undefined;
          clearTimeout(pending.timer);
          fail(pending.res, 'multiple-pages');
        }
        page.lease = undefined;
        return fail(res, 'multiple-pages');
      }
      const active = { id: data.pageId, token: randomUUID(), seen: new Set() };
      page = active;
      active.connectionTimer = setTimeout(() => {
        if (page === active) close();
      }, 5000);
      active.connectionTimer.unref();
      return json(res, 200, { pageId: active.id, pageToken: active.token });
    }
    if (op === 'revoke' && browser(req)) {
      const intentional =
        shape(data, ['pageId', 'pageToken', 'reason']) &&
        data.reason === 'user-requested';
      if (
        (!intentional && !shape(data, ['pageId', 'pageToken'])) ||
        !ownsPage(data)
      )
        return fail(res, 'lease-revoked');
      close(intentional ? 'agent-stopped' : 'lease-revoked');
      return json(res, 200, { stopped: true });
    }
    if (op === 'attach' && cli(req)) {
      if (!shape(data, ['ownerId']) || !isAgentId(data.ownerId))
        return fail(res, 'invalid-request', 400);
      if (!page?.stream) return fail(res, 'no-ready-page');
      if (page.conflict) return fail(res, 'multiple-pages');
      if (page.lease) return fail(res, 'owner-already-attached');
      page.lease = {
        pageId: page.id,
        ownerId: data.ownerId,
        epoch: randomUUID(),
      };
      event({ type: 'attached', ...page.lease });
      return json(res, 200, page.lease);
    }
    if (
      [
        'observe',
        'decide',
        'get-prompt',
        'set-prompt',
        'get-config',
        'set-config',
      ].includes(op) &&
      cli(req)
    ) {
      if (!validAgentCommand(op, data))
        return fail(res, 'invalid-request', 400);
      if (!ownsLease(data))
        return fail(
          res,
          terminal &&
            data.pageId === terminal.pageId &&
            data.ownerId === terminal.ownerId &&
            data.epoch === terminal.epoch
            ? terminal.error
            : 'lease-revoked',
        );
      if (page.conflict) return fail(res, 'multiple-pages');
      if (page.seen.has(data.commandId)) return fail(res, 'duplicate-command');
      if (page.pending) return fail(res, 'observation-busy');
      page.seen.add(data.commandId);
      const active = page;
      const pending = {
        commandId: data.commandId,
        op,
        observationId: data.observationId,
        sessionId: data.sessionId,
        runId: data.runId,
        res,
      };
      active.pending = pending;
      pending.timer = setTimeout(
        () => {
          if (page === active && active.pending === pending) {
            event({ type: 'revoked' });
            close();
          }
        },
        op === 'decide' ? 30000 : 10000,
      );
      pending.timer.unref();
      res.once('close', () => {
        if (page === active && active.pending === pending) {
          event({ type: 'revoked' });
          close();
        }
      });
      event({ type: op, ...data });
      return;
    }
    if (op === 'result' && browser(req)) {
      if (!page?.pending) return fail(res, 'lease-revoked');
      const fields = [
        'pageId',
        'pageToken',
        'epoch',
        'commandId',
        ...[
          page?.pending?.op === 'decide'
            ? 'decision'
            : page?.pending?.op === 'observe'
              ? 'observation'
              : page.pending.op === 'get-config' ||
                  page.pending.op === 'set-config'
                ? 'config'
                : 'prompt',
        ],
      ];
      if (!shape(data, fields)) return fail(res, 'invalid-request', 400);
      const active = page;
      const pending = active?.pending;
      const acceptsResult = () =>
        req.complete === true &&
        !req.aborted &&
        page === active &&
        ownsPage(data) &&
        active.stream &&
        !active.conflict &&
        data.epoch === active.lease?.epoch &&
        pending &&
        active.pending === pending &&
        data.commandId === pending.commandId &&
        !pending.res.destroyed &&
        !pending.res.writableEnded;
      if (!acceptsResult()) return fail(res, 'lease-revoked');
      let observation, decision, prompt, config;
      try {
        if (pending.op === 'decide') {
          decision = parseAgentDecisionResult(data.decision);
          if (decision.beforeObservationId !== pending.observationId)
            throw Error('correlation');
          observation = decision.observation;
        }
        if (pending.op === 'get-prompt' || pending.op === 'set-prompt') {
          prompt = parseAgentPromptResult(data.prompt);
          if (
            !('error' in prompt) &&
            (prompt.sessionId !== pending.sessionId ||
              (active.sessionId && active.sessionId !== prompt.sessionId) ||
              (pending.op === 'set-prompt' &&
                prompt.run?.runId !== pending.runId))
          )
            throw Error('correlation');
        }
        if (pending.op === 'get-config' || pending.op === 'set-config') {
          config = parseAgentConfigResult(data.config);
          if (
            !('error' in config) &&
            (config.sessionId !== pending.sessionId ||
              (active.sessionId && active.sessionId !== config.sessionId) ||
              (pending.op === 'set-config' &&
                config.run?.runId !== pending.runId))
          )
            throw Error('correlation');
        }
        if (pending.op === 'observe' && data.observation !== null)
          observation = parseAgentObservation(data.observation);
        if (observation) {
          if (
            createHash('sha256')
              .update(agentPngBytes(observation.png))
              .digest('hex') !== observation.pngSha256
          )
            throw Error('hash');
          if (active.sessionId && active.sessionId !== observation.sessionId)
            throw Error('session');
        }
      } catch {
        event({ type: 'revoked' });
        close();
        return fail(res, 'invalid-observation', 400);
      }
      // Acceptance is synchronous with this final fence: no await before the
      // CLI response. A later Stop cannot undo a result already accepted here.
      if (!acceptsResult()) return fail(res, 'lease-revoked');
      if (observation) active.sessionId = observation.sessionId;
      clearTimeout(pending.timer);
      active.pending = undefined;
      if (observation || decision || prompt || config)
        json(pending.res, 200, {
          pageId: active.id,
          epoch: active.lease.epoch,
          commandId: data.commandId,
          ...(decision
            ? { decision }
            : prompt
              ? { prompt }
              : config
                ? { config }
                : { observation }),
        });
      else fail(pending.res, 'observation-unavailable');
      return json(res, 200, { received: true });
    }
    return fail(res, 'invalid-request', 400);
  }
  return {
    middleware(req, res, next) {
      void route(req, res, next).catch(() => {
        close();
        fail(res, 'invalid-request', 400);
      });
    },
    close,
  };
}

export function agentBridgePlugin() {
  return {
    name: 'agent-observation-bridge',
    configResolved(config) {
      if (
        config.server.host !== '127.0.0.1' ||
        config.server.port !== 5174 ||
        !config.server.strictPort ||
        config.server.https
      )
        throw Error(
          'Agent bridge requires http://127.0.0.1:5174 with strictPort.',
        );
    },
    configureServer(server) {
      const bridge = createAgentBridge();
      server.middlewares.use(bridge.middleware);
      server.httpServer?.once('close', bridge.close);
    },
  };
}
