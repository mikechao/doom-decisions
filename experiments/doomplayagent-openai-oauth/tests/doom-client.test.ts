import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { AgentObserveResult } from '../../../app/src/agent-control.ts';
import { createAgentMapIdentity } from '../../../app/src/agent-observation.ts';
import type { DoomClient } from '../src/doom-client.ts';

test('client and entry imports are inert, including with the operator flag present', async (t) => {
  const network = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Real network access is forbidden');
  });
  const originalArgv = process.argv;
  // Even this flag cannot attach or initialize OAuth merely by importing main.
  process.argv = [process.execPath, '/inert-import.ts', '--attach-doom'];
  t.after(() => { process.argv = originalArgv; });
  const { initializeDoomClient } = await import('../src/doom-client.ts');
  const { main } = await import('../src/main.ts');
  assert.equal(typeof initializeDoomClient, 'function');
  assert.equal(typeof main, 'function');
  await assert.rejects(main(['--unknown']), /Usage:/);
  assert.equal(network.mock.callCount(), 0);
});

type Fault = 'rejected' | 'lost' | 'invalid';

async function broker(t: TestContext, faults: Partial<Record<'attach' | 'observe' | 'detach', Fault>> = {}) {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Only the injected fake transport may be used');
  });
  const { initializeDoomClient } = await import('../src/doom-client.ts');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'doom-client-test-'));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const pageId = randomUUID(), epoch = randomUUID();
  const calls: string[] = [];
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
    const fault = faults[op];
    if (fault === 'lost') throw new Error('sensitive raw transport detail');
    if (fault === 'rejected') return Response.json({ error: 'lease-revoked' }, { status: 409 });
    if (op === 'attach')
      return Response.json({ pageId, epoch, ownerId: fault === 'invalid' ? randomUUID() : ownerId });
    if (op === 'detach') return Response.json({ ...command, released: fault !== 'invalid' });
    return Response.json({ pageId, epoch,
      commandId: fault === 'invalid' ? randomUUID() : command.commandId, observation });
  };
  return { initialize: () => initializeDoomClient({ transport, temporaryRoot }), calls, observation, png };
}

test('one typed attach binds observe and confirmed detach to the acknowledged lease', async (t) => {
  const fake = await broker(t);
  const client: DoomClient = await fake.initialize();
  assert.deepEqual(fake.calls, ['attach']);
  assert.deepEqual(Object.keys(client).sort(), ['detach', 'observe']);
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
  test(`${fault} attach never returns a client or retries`, async (t) => {
    const fake = await broker(t, { attach: fault });
    await assert.rejects(fake.initialize(), {
      message: 'Doom attach unconfirmed; ownership may be held. Use Stop Agent in the browser before another attach. No retry was made.',
    });
    assert.deepEqual(fake.calls, ['attach']);
  });

  test(`${fault} detach never claims release or permits another attempt`, async (t) => {
    const fake = await broker(t, { detach: fault });
    const client = await fake.initialize();
    const expected = { message: 'Doom detach unconfirmed; client is closed. Use Stop Agent in the browser before another attach. No retry was made.' };
    await assert.rejects(client.detach(), expected);
    await assert.rejects(client.detach(), expected);
    await assert.rejects(client.observe(), expected);
    assert.deepEqual(fake.calls, ['attach', 'detach']);
  });

  test(`${fault} observation is surfaced once and still permits detach`, async (t) => {
    const fake = await broker(t, { observe: fault });
    const client = await fake.initialize();
    await assert.rejects(client.observe(), { message: 'Doom observation unconfirmed. No retry was made.' });
    assert.equal((await client.detach()).released, true);
    assert.deepEqual(fake.calls, ['attach', 'observe', 'detach']);
  });
}

test('overlapping observe/detach calls do not dispatch or retry', async (t) => {
  const fake = await broker(t);
  const client = await fake.initialize();
  const observation = client.observe();
  await assert.rejects(client.observe(), /busy/);
  await assert.rejects(client.detach(), /busy/);
  await observation;
  const detach = client.detach();
  await assert.rejects(client.detach(), /busy/);
  await assert.rejects(client.observe(), /busy/);
  await detach;
  assert.deepEqual(fake.calls, ['attach', 'observe', 'detach']);
});
