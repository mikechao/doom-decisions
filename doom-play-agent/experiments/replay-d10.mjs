import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { parseAgentObserveResult } from '../../app/src/agent-control.ts';
import { agentPngBytes, parseAgentDecisionResult } from '../../app/src/agent-observation.ts';
import { DecisionFailure, masks } from '../../app/src/decision.ts';
import {
  defaultDecisionConfiguration,
  formatDecisionState,
  resolveDecisionInstructions,
} from '../../app/src/decision-request.ts';
import { hash } from '../../scripts/build_engine.mjs';
import { encodeFrame, frameRgbaSha256 } from './replay-png.mjs';

const WASM = '3c70f5c26d38dfee10162ea53e3546cacd02f94abfebc3fb3e125cca5f656335';
const IWAD = '1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771';
const ARCHIVE = '6e92fe66dc330223976e53db8a58a56f7648620c204ea7d6d0546022435632fc';
const START_FRAME = '37aa03dd0f33c9601e326b6ee605a29fa0994bfa368c7cac5f072d63c6d1e8ad';
const CONTROL_FRAME = '3d645d826970e17bf898470cf3e4aaa5181f356ce22f35f5701f974a15af3577';
const TURN_FRAME = '009a6bf8bf0a3f131a38a7615526209297aa41477129c81b220b0c7aac827b29';
const SUGGESTION = "The rear-left recess is not confirmed as B's basin-side route. Seek a viewpoint showing the floor beside the blue basin and near pillar. Check whether a visible strip continues past the pillar or ends; do not infer unseen connectivity.";
const LIMIT = 10;
const TICS = 6;
const choices = Object.keys(masks);
const localDirectory = fileURLToPath(new URL('../.local', import.meta.url));
const outputDirectory = join(localDirectory, 'offline-replays', 'tracked-d10-ab');
const usage = 'node doom-play-agent/experiments/replay-d10.mjs --wasm FILE --iwad FILE --run RESULT_JSON';

function readLocal(path, label) {
  try {
    return readFileSync(path);
  } catch (error) {
    throw Error(`Cannot read ${label} (${error.code ?? 'read failed'})`);
  }
}

function checkpoint({ tic, phase, mapIdentity, frame, counters, telemetry, facingProbe, previousAction }) {
  return {
    tic, phase, mapIdentity, frame, gametic: counters.gametic, leveltime: counters.leveltime,
    telemetry, facingProbe, previousAction,
  };
}

function verifyArchive(runPath) {
  const bytes = readLocal(runPath, '--run result.json');
  assert.equal(hash(bytes), ARCHIVE, '--run must be the original saved N=10 shareware result.json');
  const { schemaVersion, provenance, result: { records } } = JSON.parse(bytes);
  assert.equal(schemaVersion, 3);
  assert.equal(records.length, LIMIT);
  for (const [index, record] of records.entries()) {
    const ordinal = index + 1;
    const { admissionObservation: before, reasoningObservation, decision: { receipt } } = record;
    assert.equal(record.ordinal, ordinal);
    assert.ok(record.decision.kind === 'returned' && receipt.outcome === 'completed' && !receipt.completionUncertain);
    assert.ok(Object.hasOwn(masks, receipt.action), `D${ordinal} unknown archived action`);
    assert.deepEqual([receipt.requestedTics, receipt.reportedTics, receipt.verifiedTics], [TICS, TICS, TICS]);
    assert.deepEqual([before.tic, receipt.observation.tic, receipt.cumulativeTics],
      [1 + index * TICS, 1 + ordinal * TICS, 1 + ordinal * TICS]);
    assert.equal(receipt.beforeObservationId, before.observationId);
    assert.deepEqual(checkpoint(reasoningObservation), checkpoint(before));
    if (index) assert.deepEqual(checkpoint(before), checkpoint(records[index - 1].decision.receipt.observation));
    for (const [suffix, link, observation] of [
      ['before', record.beforePng, before], ['after', record.decision.afterPng, receipt.observation],
    ]) {
      const filename = `decision-${ordinal}-${suffix}.png`;
      assert.equal(link.file, filename);
      const png = readLocal(join(dirname(runPath), filename), `archived ${filename} alongside --run`);
      assert.equal(hash(png), observation.pngSha256, `${filename} PNG digest`);
      assert.equal(frameRgbaSha256(png), observation.frame.nativeSha256, `${filename} decoded RGBA digest`);
      assert.equal(observation.frame.nativeSha256, observation.frame.canvasSha256);
      assert.equal(observation.mapIdentity.mapKey, `doom-map:v1:iwad-sha256:${IWAD}:E1M1`);
    }
  }
  const d10 = records.at(-1);
  assert.equal(d10.admissionObservation.frame.nativeSha256, START_FRAME);
  assert.equal(d10.decision.receipt.action, 'forward');
  assert.equal(d10.decision.receipt.observation.frame.nativeSha256, CONTROL_FRAME);
  return { provenance: provenance.git, records };
}

function editSuggestion(instructions, replacement) {
  const marker = 'Untrusted advisory data (JSON): ';
  const lines = instructions.split('\n');
  const index = lines.findIndex((line) => line.startsWith(marker));
  assert.ok(index >= 0 && !lines.slice(index + 1).some((line) => line.startsWith(marker)),
    'Expected one archived advisory JSON line');
  const source = lines[index].slice(marker.length);
  const advisory = JSON.parse(source);
  assert.ok(JSON.stringify(advisory) === source, 'Advisory JSON cannot round-trip byte for byte');
  const original = advisory.landmarkInvestigation.suggestion;
  assert.equal(typeof original, 'string');
  advisory.landmarkInvestigation.suggestion = replacement;
  lines[index] = marker + JSON.stringify(advisory);
  return { original, instructions: lines.join('\n') };
}

function imageEvidence(observation) {
  const png = Buffer.from(agentPngBytes(observation.png));
  const rgbaSha256 = frameRgbaSha256(png);
  assert.equal(hash(png), observation.pngSha256);
  assert.equal(rgbaSha256, observation.frame.nativeSha256);
  assert.equal(rgbaSha256, observation.frame.canvasSha256);
  return { pngSha256: observation.pngSha256, rgbaSha256 };
}

function createArm(createController, { wasm, iwad, metadata }, label, evidence) {
  const epoch = crypto.randomUUID();
  const runId = crypto.randomUUID();
  let sessionId, view, painted, pending, thread, termination, fakeError;
  let attached = false;
  let key = 'offline-replay';
  const nativeActions = [];
  const assertLease = () => assert.ok(attached, `${label} local lease ended`);
  const provider = {
    probe: () => ({ status: 'Scripted offline replay', evidence: { provider: 'offline-fake' } }),
    create(value) {
      assert.ok(value === 'offline-replay', 'Unexpected fake provider marker');
      return { async request(request, _lifecycle, _diagnostics, hooks) {
        try {
          const { before, action, gate, arrived } = pending;
          assert.ok(view.agentBusy && view.verifiedTics === before.tic);
          assert.equal(view.evidence.decisions.at(-1).selectedTics, TICS);
          assert.ok(request.instructions === resolveDecisionInstructions(TICS, before.configuration.instructionTemplate),
            `${label} request instructions differ from the acknowledged revision`);
          assert.ok(request.png === before.png, `${label} request PNG differs from the admitted observation`);
          assert.deepEqual(request.permittedActions, choices);
          assert.ok(request.context === formatDecisionState(before.tic, before.configuration, before.telemetry,
            before.previousAction ?? undefined, before.facingProbe ?? undefined), `${label} request state context`);
          hooks.assertFresh();
          hooks.beforeCreate(); // Controller accounting and fences for this fake choice only.
          arrived.resolve(request);
          if (gate && !(await gate)) throw new DecisionFailure('Offline branch gate closed');
          hooks.assertFresh();
          pending.released = true;
          return { kind: 'choice', action };
        } catch (error) {
          fakeError = error;
          throw error;
        }
      } };
    },
  };
  const controller = createController({
    async localFetch(name, json = false) {
      if (name === 'doom-build.json' && json) return metadata;
      assert.equal(name, 'doom.wasm');
      assert.equal(json, false);
      return Uint8Array.from(wasm).buffer;
    },
    createWorker() {
      assert.equal(thread, undefined);
      thread = new Worker(new URL(import.meta.url), { name: `replay-d10-${label}`, env: {} });
      const port = {
        postMessage(request, transfer) {
          if (request.op === 'action') {
            const actual = { mask: request.mask, tics: request.tics };
            if (nativeActions.length === 0) {
              assert.deepEqual(actual, { mask: masks.neutral, tics: 1 }, `${label} startup action`);
            } else {
              assert.ok(pending?.released && !pending.dispatched, `${label} unexpected action dispatch`);
              assert.deepEqual(actual, { mask: masks[pending.action], tics: TICS }, `${label} scripted action`);
              pending.dispatched = true;
            }
            nativeActions.push(actual);
          }
          thread.postMessage(request, transfer);
        },
        terminate() { termination ??= thread.terminate(); },
      };
      thread.on('message', (data) => port.onmessage?.({ data }));
      thread.on('error', (error) => port.onerror?.(error));
      thread.on('messageerror', (error) => port.onmessageerror?.(error));
      return port;
    },
    readTics: () => TICS,
    readDecisionConfiguration: () => defaultDecisionConfiguration,
    takeKey() { const value = key; key = ''; return value; },
    clearKey() { key = ''; },
    focusBudget() { assert.fail('Unexpected budget prompt'); },
    paintAndReadback(rgba) {
      painted = new Uint8ClampedArray(rgba);
      return new Uint8ClampedArray(painted);
    },
    capture() {
      const rgba = new Uint8ClampedArray(painted);
      return { rgba, png: `data:image/png;base64,${encodeFrame(rgba).toString('base64')}` };
    },
    clearCanvas() { painted = undefined; },
    present(update) { view = update.session ?? view; },
  }, provider);

  const observe = async () => parseAgentObserveResult(await controller.observe(assertLease));
  return {
    async prepare() {
      await controller.initialize();
      await controller.prepare({ name: 'DOOM1.WAD', size: iwad.length,
        async arrayBuffer() { return Uint8Array.from(iwad).buffer; } });
      assert.ok(view?.prepared, `${label} controller preparation failed`);
      assert.deepEqual(view.evidence.assets, { wasm: { bytes: wasm.length, sha256: WASM },
        iwad: { bytes: iwad.length, sha256: IWAD } });
      assert.ok(view.evidence.neutralFirst.complete && view.evidence.idle.unchanged);
      assert.deepEqual(nativeActions, [{ mask: masks.neutral, tics: 1 }]);
      evidence.assets = view.evidence.assets;
      controller.attachAgent(epoch, true);
      attached = true;
    },
    async admission(record, instructions) {
      const reasoning = await observe();
      assert.deepEqual(checkpoint(reasoning), checkpoint(record.reasoningObservation), `${label} reasoning checkpoint`);
      assert.deepEqual(reasoning.configuration, record.reasoningObservation.configuration);
      if (!sessionId) {
        sessionId = reasoning.sessionId;
        const started = controller.startAgentRun(epoch, reasoning.observationId,
          { sessionId, runId, revision: reasoning.revision, limit: LIMIT }, assertLease);
        assert.deepEqual(started.run, { runId, active: true, limit: LIMIT, reserved: 0, sdkInvoked: 0, remaining: LIMIT });
        evidence.checkpoints.push({ ...checkpoint(reasoning), ...imageEvidence(reasoning) });
      }
      const update = controller.agentPrompt(epoch, sessionId, assertLease,
        { sessionId, runId, revision: reasoning.revision, instructions });
      assert.ok(update.instructions === instructions && update.revision === record.promptAcknowledged.revision,
        `${label} prompt acknowledgement`);
      const before = await observe();
      assert.deepEqual(checkpoint(before), checkpoint(record.admissionObservation), `${label} admission checkpoint`);
      assert.ok(before.sessionId === sessionId && before.observationId !== reasoning.observationId);
      assert.ok(before.revision === update.revision && isDeepStrictEqual(before.configuration,
        { ...record.admissionObservation.configuration, instructionTemplate: instructions }), `${label} admission configuration`);
      assert.deepEqual(before.run, { runId, active: true, limit: LIMIT, reserved: record.ordinal - 1,
        sdkInvoked: record.ordinal - 1, remaining: LIMIT - record.ordinal + 1 });
      imageEvidence(before);
      return before;
    },
    snapshot() {
      const { op, result: { counters, native } } = view.evidence.operations.at(-1);
      assert.equal(op, 'snapshot');
      return { counters, native, frame: view.frame };
    },
    decide(before, action, gate) {
      const arrived = Promise.withResolvers();
      pending = { before, action, gate, arrived };
      const operations = view.evidence.operations.length;
      const actionCount = nativeActions.length;
      const done = controller.agentNext(epoch, before.observationId, assertLease,
        { sessionId, runId, revision: before.revision }).then((value) => {
        if (fakeError) throw fakeError;
        const { observation, ...receipt } = parseAgentDecisionResult(value);
        assert.deepEqual([receipt.outcome, receipt.action, receipt.requestedTics, receipt.reportedTics,
          receipt.verifiedTics, receipt.cumulativeTics, receipt.sdkInvoked, receipt.completionUncertain],
        ['completed', action, TICS, TICS, TICS, before.tic + TICS, true, false], `${label} action receipt`);
        assert.equal(receipt.beforeObservationId, before.observationId);
        assert.equal(observation.sessionId, sessionId);
        assert.ok(view.evidence.decisions.at(-1).waitUnchanged && !view.waitingForSdk && view.controls.ready);
        const boundary = view.evidence.operations.slice(operations);
        assert.deepEqual(boundary.map(({ op }) => op), ['snapshot', 'snapshot', 'action', 'render', 'snapshot', 'snapshot']);
        assert.deepEqual(boundary[0].result, boundary[1].result, `${label} pre-dispatch state`);
        assert.deepEqual(nativeActions.slice(actionCount), [{ mask: masks[action], tics: TICS }]);
        evidence.receipts.push(receipt);
        return observation;
      });
      return { done, request: () => Promise.race([arrived.promise, done.then(() => assert.fail('Missing fake request'))]) };
    },
    verifyClosedBudget() {
      assert.deepEqual(view.agentAuthorization, { runId, active: false, limit: LIMIT,
        sdkInvoked: LIMIT, reserved: LIMIT, remaining: 0 });
      assert.equal(nativeActions.length, LIMIT + 1);
    },
    async close() {
      attached = false;
      controller.close();
      await termination;
      evidence.nativeActionCount = nativeActions.length;
      evidence.workerTerminated = !thread || thread.threadId === -1;
      assert.ok(evidence.workerTerminated, `${label} Worker still active`);
    },
  };
}

function save(name, data) {
  writeFileSync(join(outputDirectory, name), data, { flag: 'wx', mode: 0o600 });
}

function reserveOutput() {
  for (const directory of [localDirectory, dirname(outputDirectory)]) {
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    assert.equal(realpathSync(directory), directory, 'Replay output parent must stay under the local repository');
  }
  try {
    mkdirSync(outputDirectory, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw Error('Replay output already exists. Move the prior output aside before rerunning.');
    throw error;
  }
}

async function replay({ wasm: wasmPath, iwad: iwadPath, run }) {
  const wasm = readLocal(wasmPath, '--wasm');
  const iwad = readLocal(iwadPath, '--iwad');
  assert.equal(hash(wasm), WASM, '--wasm must match the pinned controlled-title WASM');
  assert.equal(hash(iwad), IWAD, '--iwad must match the pinned shareware DOOM1.WAD');
  const metadata = JSON.parse(readLocal(join(dirname(wasmPath), 'doom-build.json'), 'doom-build.json alongside --wasm'));
  assert.deepEqual([metadata.profile, metadata.a1Fixtures, metadata.embeddedIwad, metadata.bytes, metadata.sha256],
    ['controlled-title', true, false, wasm.length, WASM], 'Staged WASM profile or identity differs');
  const { provenance, records } = verifyArchive(run);
  const d10 = records.at(-1);
  const original = d10.promptAcknowledged.instructions;
  assert.ok(original === d10.guidance && original === d10.admissionObservation.configuration.instructionTemplate);
  const treatment = editSuggestion(original, SUGGESTION);
  assert.ok(treatment.original !== SUGGESTION && editSuggestion(treatment.instructions, treatment.original).instructions === original);

  const source = new URL('../../app/src/', import.meta.url);
  const resolver = registerHooks({ resolve(specifier, context, nextResolve) {
    // These production imports ordinarily get their extensions from Vite.
    if (context.parentURL?.startsWith(source.href) && ['./decision', './collision-evidence', './worker-shared'].includes(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  } });
  let createController;
  try {
    ({ createSessionController: createController } = await import('../../app/src/session-controller.ts'));
  } finally {
    resolver.deregister();
  }

  reserveOutput();
  const report = { status: 'failed', mode: 'offline-fake', archiveSha256: ARCHIVE, provenance,
    historicalWasmSha256: null, arms: { A: { checkpoints: [], receipts: [] }, B: { checkpoints: [], receipts: [] } } };
  const a = createArm(createController, { wasm, iwad, metadata }, 'A', report.arms.A);
  const b = createArm(createController, { wasm, iwad, metadata }, 'B', report.arms.B);
  const gate = Promise.withResolvers();
  let work = [];
  let stage = 'preparation';
  try {
    await a.prepare();
    await b.prepare();
    for (const record of records.slice(0, -1)) {
      stage = `D${record.ordinal} prefix`;
      for (const [label, arm] of [['A', a], ['B', b]]) {
        const before = await arm.admission(record, record.promptAcknowledged.instructions);
        const after = await arm.decide(before, record.decision.receipt.action).done;
        assert.deepEqual(checkpoint(after), checkpoint(record.decision.receipt.observation), `${label} historical resulting checkpoint`);
        report.arms[label].checkpoints.push({ ...checkpoint(after), ...imageEvidence(after) });
      }
    }

    stage = 'D10 admission';
    const aBefore = await a.admission(d10, original);
    const bBefore = await b.admission(d10, treatment.instructions);
    assert.notEqual(aBefore.sessionId, bBefore.sessionId);
    assert.notEqual(aBefore.observationId, bBefore.observationId);
    assert.notEqual(aBefore.run.runId, bBefore.run.runId);
    const start = a.snapshot();
    assert.deepEqual(start, b.snapshot(), 'Independent tic-55 native snapshots');
    const aCall = a.decide(aBefore, d10.decision.receipt.action, gate.promise);
    const bCall = b.decide(bBefore, 'turn_right', gate.promise);
    work = [aCall.done, bCall.done];
    const [aRequest, bRequest] = await Promise.all([aCall.request(), bCall.request()]);
    assert.ok(
      isDeepStrictEqual(start, a.snapshot()) && isDeepStrictEqual(start, b.snapshot()),
      'D10 passive admission changed the checkpoint',
    );
    const restoredRequest = {
      ...bRequest,
      instructions: editSuggestion(bRequest.instructions, treatment.original).instructions,
    };
    assert.ok(
      aRequest.instructions !== bRequest.instructions && isDeepStrictEqual(aRequest, restoredRequest),
      'D10 requests must differ only in landmarkInvestigation.suggestion',
    );
    report.shared = {
      ...start,
      ...imageEvidence(aBefore),
      allowedDifference: 'landmarkInvestigation.suggestion',
      instructionSha256: { A: hash(aRequest.instructions), B: hash(bRequest.instructions) },
    };
    save('tic55-shared.png', agentPngBytes(aBefore.png));
    gate.resolve(true);

    stage = 'D10 resulting frames';
    const [aAfter, bAfter] = await Promise.all(work);
    assert.deepEqual(checkpoint(aAfter), checkpoint(d10.decision.receipt.observation), 'A historical D10 checkpoint');
    assert.deepEqual(bAfter.telemetry, { ...aAfter.telemetry, x: 62074026, y: -224098294, angle: 1409286144 });
    assert.deepEqual(bAfter.facingProbe, { tic: 61, kind: 2, door: 0, distance: 41 });
    assert.deepEqual(bAfter.mapIdentity, aAfter.mapIdentity);
    assert.deepEqual([bAfter.previousAction.action, bAfter.previousAction.tics, bAfter.previousAction.endTic], ['turn_right', TICS, 61]);
    for (const [label, arm, before, after, expected] of [
      ['A', a, aBefore, aAfter, CONTROL_FRAME], ['B', b, bBefore, bAfter, TURN_FRAME],
    ]) {
      const image = imageEvidence(after);
      assert.equal(image.rgbaSha256, expected, `${label} tic-61 RGBA`);
      arm.verifyClosedBudget();
      report.arms[label].d10 = {
        scope: { sessionId: before.sessionId, runId: before.run.runId, revision: before.revision },
        beforeObservationId: before.observationId,
        after: checkpoint(after),
        native: arm.snapshot().native,
        ...image,
      };
      save(`tic61-${label}.png`, agentPngBytes(after.png));
    }
    report.status = 'passed';
  } catch (error) {
    report.failure = { stage, message: error.message.split('\n')[0] };
    throw error;
  } finally {
    gate.resolve(false);
    await Promise.allSettled(work);
    const cleanup = await Promise.allSettled([a.close(), b.close()]);
    const failure = cleanup.find(({ status }) => status === 'rejected');
    if (failure && report.status === 'passed') {
      report.status = 'failed';
      report.failure = { stage: 'cleanup', message: 'Worker retirement failed' };
    }
    save('evidence.json', `${JSON.stringify(report, null, 2)}\n`);
    if (failure) throw failure.reason;
  }
  console.log('Offline D10 replay passed. Evidence is in doom-play-agent/.local/offline-replays/tracked-d10-ab/.');
}

if (isMainThread) {
  try {
    const { values } = parseArgs({ options: {
      wasm: { type: 'string' }, iwad: { type: 'string' }, run: { type: 'string' }, help: { type: 'boolean' },
    } });
    if (values.help) console.log(usage);
    else {
      assert.ok(values.wasm && values.iwad && values.run, usage);
      globalThis.fetch = () => { throw Error('Offline replay disallows fetch'); };
      await replay(values);
    }
  } catch (error) {
    console.error(`D10 replay failed. ${error.message.split('\n')[0]}`);
    process.exitCode = 1;
  }
} else {
  globalThis.fetch = () => { throw Error('Offline replay Worker disallows fetch'); };
  globalThis.self = {
    postMessage: (reply, transfer) => parentPort.postMessage(reply, transfer),
    close: () => parentPort.close(),
  };
  await import('../../app/src/worker.ts');
  parentPort.on('message', (data) => self.onmessage({ data }));
}
