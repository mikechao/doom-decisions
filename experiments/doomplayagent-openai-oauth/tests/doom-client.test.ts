import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { AgentObserveResult } from '../../../app/src/agent-control.ts';
import { createAgentMapIdentity } from '../../../app/src/agent-observation.ts';
import type { DoomClient } from '../src/doom-client.ts';

type Operation = 'attach' | 'observe' | 'detach';
type Fault = 'rejected' | 'lost' | 'invalid';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('imports and synchronous factory are inert and expose a frozen client', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Real network access is forbidden');
  });
  const originalArgv = process.argv;
  process.argv = [process.execPath, '/inert-import.ts', '--attach-doom'];
  t.after(() => { process.argv = originalArgv; });

  const { createDoomClient } = await import('../src/doom-client.ts');
  const { main } = await import('../src/main.ts');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'doom-client-inert-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const client = createDoomClient({ temporaryRoot });

  assert.equal(typeof (client as unknown as { then?: unknown }).then, 'undefined', 'factory returns synchronously');
  assert.equal(Object.isFrozen(client), true);
  assert.deepEqual(Object.keys(client).sort(), ['attach', 'detach', 'observe']);
  assert.equal(typeof createDoomClient, 'function');
  assert.equal(typeof main, 'function');
  assert.deepEqual(await readdir(temporaryRoot), []);
  await assert.rejects(main(['--unknown']), /Usage:/);
  assert.equal(network.mock.callCount(), 0);
});

async function broker(
  t: TestContext,
  options: { faults?: Partial<Record<Operation, Fault>>; blocked?: Operation } = {},
) {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Only the injected fake transport may be used');
  });
  const { createDoomClient } = await import('../src/doom-client.ts');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'doom-client-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const pageId = randomUUID(), epoch = randomUUID();
  const calls: string[] = [];
  const pendingStarted = deferred();
  const pendingRelease = deferred();
  let ownerId: string | undefined;

  // Minimal synthetic 640x400 IHDR for the executor's header and hash checks.
  // This tests parser/hash/materialization boundaries, not PNG decoding.
  const png = Buffer.alloc(33);
  png.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(400, 20);
  const observation: AgentObserveResult = {
    observationId: randomUUID(), sessionId: randomUUID(), tic: 43, phase: 'ready',
    mapIdentity: createAgentMapIdentity('a'.repeat(64), 1, 1),
    frame: { tic: 43, nativeSha256: 'c'.repeat(64), canvasSha256: 'c'.repeat(64) },
    counters: { gametic: 43, leveltime: 43, render: 44, frame: 44 },
    telemetry: { health: 100, x: 0, y: 0, angle: 0, weaponId: null,
      bullets: null, shells: null, cells: null, rockets: null, readyWeapon: null, ammo: null },
    facingProbe: null, previousAction: null,
    png: `data:image/png;base64,${png.toString('base64')}`,
    pngSha256: createHash('sha256').update(png).digest('hex'),
    revision: 0, run: null,
    configuration: { instructionTemplate: 'Synthetic {{tics}}.', tics: 6,
      includeReadyWeapon: false, includeAmmo: false, includeHealth: false,
      includeFacingProbe: false, includePreviousAction: false },
  };
  const transport: typeof fetch = async (url, init) => {
    const op = String(url).split('/').at(-1);
    assert.ok(op === 'attach' || op === 'observe' || op === 'detach', 'No gameplay operation');
    assert.equal(String(url), `http://127.0.0.1:5174/__doom_agent/${op}`);
    assert.equal(init?.method, 'POST');
    const command = JSON.parse(String(init?.body));
    calls.push(op);
    if (op === 'attach') {
      assert.deepEqual(Object.keys(command), ['ownerId']);
      ownerId = command.ownerId;
    } else {
      assert.deepEqual(Object.keys(command).sort(), ['commandId', 'epoch', 'ownerId', 'pageId']);
      assert.equal(command.ownerId, ownerId);
      assert.equal(command.pageId, pageId);
      assert.equal(command.epoch, epoch);
    }
    if (op === options.blocked) {
      pendingStarted.resolve();
      await pendingRelease.promise;
    }
    const fault = options.faults?.[op];
    if (fault === 'lost') throw new Error('sensitive raw transport detail');
    if (fault === 'rejected') return Response.json({ error: 'lease-revoked' }, { status: 409 });
    if (op === 'attach')
      return Response.json({ pageId, epoch, ownerId: fault === 'invalid' ? randomUUID() : ownerId });
    if (op === 'detach') return Response.json({ ...command, released: fault !== 'invalid' });
    return Response.json({ pageId, epoch,
      commandId: fault === 'invalid' ? randomUUID() : command.commandId, observation });
  };
  return {
    create: () => createDoomClient({ transport, temporaryRoot }),
    calls,
    observation,
    png,
    pendingStarted: pendingStarted.promise,
    releasePending: () => pendingRelease.resolve(),
  };
}

test('unattached observe and detach fail without dispatch', async (t) => {
  const fake = await broker(t);
  const client = fake.create();
  await assert.rejects(client.observe(), /not attached/);
  await assert.rejects(client.detach(), /not attached/);
  assert.deepEqual(fake.calls, []);
});

test('attach, observe, and detach use the acknowledged lease and materialize the PNG', async (t) => {
  const fake = await broker(t);
  const client: DoomClient = fake.create();
  const lease = await client.attach();
  assert.deepEqual(fake.calls, ['attach']);
  assert.ok(lease.leaseFile);

  const observed = await client.observe();
  const { png: _png, ...metadata } = fake.observation;
  assert.deepEqual({ ...metadata, pageId: observed.pageId, epoch: observed.epoch,
    commandId: observed.commandId, pngPath: observed.pngPath }, observed);
  assert.deepEqual(await readFile(observed.pngPath), fake.png);

  const detached = await client.detach();
  assert.equal(detached.released, true);
  assert.equal(detached.pageId, observed.pageId);
  assert.equal(detached.epoch, observed.epoch);
  await assert.rejects(client.observe(), /closed/);
  await assert.rejects(client.detach(), /closed/);
  assert.deepEqual(fake.calls, ['attach', 'observe', 'detach']);
});

for (const fault of ['rejected', 'lost', 'invalid'] as const) {
  test(`${fault} attach is uncertain, surfaced safely, and never retried`, async (t) => {
    const fake = await broker(t, { faults: { attach: fault } });
    const client = fake.create();
    const expected = {
      message: 'Doom attach unconfirmed; ownership may be held. Use Stop Agent in the browser before another attach. No retry was made.',
    };
    await assert.rejects(client.attach(), expected);
    await assert.rejects(client.attach(), expected);
    await assert.rejects(client.observe(), expected);
    await assert.rejects(client.detach(), expected);
    assert.deepEqual(fake.calls, ['attach']);
  });

  test(`${fault} detach is unconfirmed, closes the client, and is never retried`, async (t) => {
    const fake = await broker(t, { faults: { detach: fault } });
    const client = fake.create();
    await client.attach();
    const expected = {
      message: 'Doom detach unconfirmed; client is closed. Use Stop Agent in the browser before another attach. No retry was made.',
    };
    await assert.rejects(client.detach(), expected);
    await assert.rejects(client.detach(), expected);
    await assert.rejects(client.observe(), expected);
    await assert.rejects(client.attach(), expected);
    assert.deepEqual(fake.calls, ['attach', 'detach']);
  });

  test(`${fault} observation is surfaced once and still permits explicit detach`, async (t) => {
    const fake = await broker(t, { faults: { observe: fault } });
    const client = fake.create();
    await client.attach();
    await assert.rejects(client.observe(), {
      message: 'Doom observation unconfirmed. No retry was made.',
    });
    assert.equal((await client.detach()).released, true);
    assert.deepEqual(fake.calls, ['attach', 'observe', 'detach']);
  });
}

test('overlapping attach and observation operations do not dispatch', async (t) => {
  const attachFake = await broker(t, { blocked: 'attach' });
  const attaching = attachFake.create();
  const attachment = attaching.attach();
  await attachFake.pendingStarted;
  await assert.rejects(attaching.attach(), /busy/);
  await assert.rejects(attaching.observe(), /busy/);
  await assert.rejects(attaching.detach(), /busy/);
  assert.deepEqual(attachFake.calls, ['attach']);
  attachFake.releasePending();
  await attachment;
  await assert.rejects(attaching.attach(), /already attached/);
  assert.deepEqual(attachFake.calls, ['attach']);

  const observeFake = await broker(t, { blocked: 'observe' });
  const observing = observeFake.create();
  await observing.attach();
  const observation = observing.observe();
  await observeFake.pendingStarted;
  await assert.rejects(observing.observe(), /busy/);
  await assert.rejects(observing.detach(), /busy/);
  await assert.rejects(observing.attach(), /busy/);
  assert.deepEqual(observeFake.calls, ['attach', 'observe']);
  observeFake.releasePending();
  await observation;
  assert.equal((await observing.detach()).released, true);
  assert.deepEqual(observeFake.calls, ['attach', 'observe', 'detach']);
});

test('overlapping detach and calls after detach do not dispatch', async (t) => {
  const fake = await broker(t, { blocked: 'detach' });
  const client = fake.create();
  await client.attach();
  const detach = client.detach();
  await fake.pendingStarted;
  await assert.rejects(client.detach(), /busy/);
  await assert.rejects(client.observe(), /busy/);
  await assert.rejects(client.attach(), /busy/);
  assert.deepEqual(fake.calls, ['attach', 'detach']);
  fake.releasePending();
  await detach;
  await assert.rejects(client.observe(), /closed/);
  await assert.rejects(client.detach(), /closed/);
  await assert.rejects(client.attach(), /closed/);
  assert.deepEqual(fake.calls, ['attach', 'detach']);
});

test('main attaches only for the explicit flag and skips detach after uncertain attach', async (t) => {
  const { main } = await import('../src/main.ts');
  let factoryCalls = 0;
  await assert.rejects(main(['--unknown'], () => {
    factoryCalls++;
    return {} as DoomClient;
  }), /Usage:/);
  assert.equal(factoryCalls, 0);

  const fake = await broker(t);
  await main(['--attach-doom'], fake.create);
  assert.deepEqual(fake.calls, ['attach', 'observe', 'detach']);

  const uncertain = await broker(t, { faults: { attach: 'lost' } });
  await assert.rejects(main(['--attach-doom'], uncertain.create), /ownership may be held/);
  assert.deepEqual(uncertain.calls, ['attach']);
});
