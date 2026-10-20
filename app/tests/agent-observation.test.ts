import assert from 'node:assert/strict';
import { afterEach, it, vi } from 'vitest';
import { agentPngBytes, parseAgentObservation } from '../src/agent-observation.ts';
import { cleanup, fixture } from './fixtures/session.ts';
import { pngFor } from './fixtures/agent.ts';
import { death } from './fixtures/synthetic-doom.ts';

afterEach(cleanup);
function session() {
  const providerFactory = {
    probe: () => ({ status: 'Offline observation', evidence: { provider: 'offline' } }),
    create: vi.fn(() => assert.fail('Observation must never construct a provider')),
  };
  const h = fixture({ key: '', providerFactory });
  const capture = h.ports.capture;
  h.ports.capture = () => {
    const { rgba } = capture();
    return { rgba, png: pngFor(rgba) };
  };
  return { h, providerFactory };
}
it('exports a fresh detached verified PNG/state with no key, provider or gameplay', async () => {
  const { h, providerFactory } = session();
  try {
    await assert.rejects(h.controller.observe(() => {}), /not ready/);
    await h.prepare();
    const before = h.native.observe();
    const result = await h.controller.observe(() => {});
    assert.equal(parseAgentObservation(result), result);
    assert.ok(agentPngBytes(result.png).length > 33);
    assert.equal(result.tic, 1);
    assert.equal(result.frame.nativeSha256, result.frame.canvasSha256);
    assert.deepEqual(h.native.observe().native, before.native);
    assert.equal(h.native.observe().counters.gametic, 1);
    assert.equal(result.counters.render, before.counters.render + 1);
    assert.equal(h.gameCalls, 0);
    assert.equal(h.sdkCalls, 0);
    assert.equal(providerFactory.create.mock.calls.length, 0);
    assert.deepEqual(Object.keys(result).sort(), ['counters', 'frame', 'observationId', 'phase', 'png', 'pngSha256', 'previousAction', 'sessionId', 'telemetry', 'tic']);
    const sessionId = result.sessionId;
    result.frame.tic = 99; result.telemetry.health = 0;
    const again = await h.controller.observe(() => {});
    assert.equal(again.sessionId, sessionId);
    assert.equal(again.frame.tic, 1);
    assert.equal(again.counters.render, result.counters.render + 1);
    assert.equal(h.view.session.controls.ready, true);
  } finally { await h.dispose(); }
});
it('owns admission only while observing and safely drains a locally revoked snapshot', async () => {
  const { h } = session();
  try {
    await h.prepare();
    let live = true;
    const hold = h.hold('snapshot');
    const work = h.controller.observe(() => { if (!live) throw Error('revoked'); });
    const rejected = assert.rejects(work, /lease revoked/);
    await hold.waiting;
    assert.equal(h.view.session.phase, 'busy');
    assert.equal(await h.next(), 'not-admitted');
    await h.start();
    assert.equal(h.view.session.continuous, undefined);
    await assert.rejects(h.controller.observe(() => {}), /not ready/);
    live = false;
    hold.release();
    await rejected;
    assert.equal(h.view.session.phase, 'ready');
    assert.equal(h.view.session.controls.ready, true);
    assert.equal(h.worker.terminate.mock.calls.length, 0);
    assert.equal(h.gameCalls, 0);
    const ops = h.ops.length;
    await assert.rejects(h.controller.observe(() => { throw Error('old lease'); }), /lease revoked/);
    assert.equal(h.ops.length, ops);
  } finally { await h.dispose(); }
});
it('rejects a capture revoked during asynchronous hashing without publishing a result', async () => {
  const { h } = session();
  try {
    await h.prepare();
    let live = true;
    const hold = h.holdDigest(3); // Render pixels + Canvas, then observation capture.
    const work = h.controller.observe(() => { if (!live) throw Error('revoked'); });
    const rejected = assert.rejects(work, /lease revoked/);
    await hold.waiting;
    live = false;
    hold.release();
    await rejected;
    assert.equal(h.view.session.controls.ready, true);
    assert.equal(h.gameCalls, 0);
  } finally { await h.dispose(); }
});
it('retires mismatched Canvas/native or changed passive state and rejects retired observations', async () => {
  for (const fault of ['badCanvas', 'corruptSnapshot', 'badCapture']) {
    const { h } = session();
    try {
      await h.prepare();
      if (fault === 'badCapture') {
        const capture = h.ports.capture;
        h.ports.capture = () => { const data = capture(); data.rgba[0]++; return data; };
      } else h.faults[fault] = fault === 'corruptSnapshot' ? 1 : true;
      await assert.rejects(h.controller.observe(() => {}), /verification failed/);
      assert.equal(h.view.session.phase, 'error');
      await assert.rejects(h.controller.observe(() => {}), /not ready/);
      assert.equal(h.gameCalls, 0);
    } finally { await h.dispose(); }
  }
});
it('cannot label a delayed capture current after page retirement', async () => {
  const { h } = session();
  try {
    await h.prepare();
    const hold = h.holdDigest(3);
    const work = h.controller.observe(() => {});
    const rejected = assert.rejects(work, /verification failed/);
    await hold.waiting;
    h.controller.close();
    hold.release();
    await rejected;
    assert.equal(h.view.session.controls.ready, false);
  } finally { await h.dispose(); }
});
it('rejects a verified terminal preparation instead of exporting it as current/ready', async () => {
  const h = fixture({ key: '', at: 0, signals: death });
  try {
    await h.controller.initialize();
    await h.select();
    assert.equal(h.view.session.phase, 'terminal');
    await assert.rejects(h.controller.observe(() => {}), /not ready/);
    assert.equal(h.sdkCalls, 0);
  } finally { await h.dispose(); }
});
