// Synthetic files and direct middleware calls only: no server, game or provider.
import assert from 'node:assert/strict';
import fs, { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import promises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { runInNewContext } from 'node:vm';
import { afterEach, it, vi } from 'vitest';
import config from '../vite.config.js';
import { agentIwadError, agentIwadReadError, agentIwadUrl, createAgentIwad } from '../src/agent-iwad.ts';
import { agentOrigin } from '../src/agent-observation.ts';
import { IWAD_MAX_BYTES, IWAD_MIN_BYTES } from '../src/worker-shared.ts';
import { cleanup, fixture } from './fixtures/session.ts';

const roots: string[] = [];
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'doom-agent-iwad-'));
  roots.push(root);
  return root;
}
function bootstrap(root, setting?: string, env = { command: 'serve', mode: 'agent' }) {
  if (setting !== undefined) writeFileSync(join(root, '.env.agent.local'), `AGENT_IWAD_PATH="${setting}"\n`);
  const raw = config(env);
  const plugin = raw.plugins.find(p => p.name === 'agent-bootstrap');
  plugin.configResolved({ root, server: raw.server ?? {} });
  const load = () => plugin.load(plugin.resolveId('virtual:agent-bootstrap'));
  const source = load();
  const metadata = JSON.parse(JSON.stringify(runInNewContext(source.replaceAll('export ', '') + '\nlocalIwad')));
  return { raw, plugin, source, metadata, load };
}
function middleware(plugin) {
  let route;
  plugin.configureServer({ middlewares: { use(fn) { route = fn; } } });
  return async (overrides = {}) => {
    const headers = new Map();
    const req = {
      url: agentIwadUrl, method: 'GET', socket: { remoteAddress: '127.0.0.1' },
      headers: { host: new URL(agentOrigin).host, 'sec-fetch-site': 'same-origin' },
      ...overrides,
    };
    let body = Buffer.alloc(0), passed = false;
    const res = {
      statusCode: 200,
      setHeader(name, value) { headers.set(name, value); },
      end(bytes = '') { body = Buffer.from(bytes); },
    };
    await route(req, res, () => { passed = true; });
    return { status: res.statusCode, headers, body, passed };
  };
}

it.each([undefined, '', '   '])('keeps Freedoom for absent/blank path %s, without file reads or an available WAD', async setting => {
  const h = bootstrap(temporaryRoot(), setting);
  assert.equal(h.metadata, null);
  const open = vi.spyOn(promises, 'open');
  syncBuiltinESMExports();
  const reply = await middleware(h.plugin)();
  assert.equal(reply.status, 400);
  assert.equal(open.mock.calls.length, 0);
});

it('exports size only, serves exact synthetic bytes lazily, and freezes the configured selection', async () => {
  const root = temporaryRoot();
  const path = join(root, 'operator-private-name.wad');
  const bytes = Buffer.from('IWADsynthetic-input');
  writeFileSync(path, bytes);
  const open = vi.spyOn(promises, 'open');
  syncBuiltinESMExports();
  const h = bootstrap(root, path);
  assert.deepEqual(h.metadata, { size: bytes.length });
  assert.equal(open.mock.calls.length, 0, 'Metadata does not read WAD bytes');
  assert.equal(h.source.includes(path), false);
  assert.equal(h.source.includes('operator-private-name'), false);
  assert.equal(inspect(h.raw, { depth: 20 }).includes(path), false);
  const route = middleware(h.plugin);
  const fetch = vi.fn(async (url, options) => {
    assert.equal(url, agentIwadUrl);
    assert.deepEqual(options, { mode: 'same-origin', redirect: 'error', credentials: 'omit', cache: 'no-store' });
    const reply = await route();
    assert.equal(reply.status, 200);
    assert.equal(reply.headers.get('Content-Length'), bytes.length);
    assert.equal(reply.headers.get('Content-Type'), 'application/octet-stream');
    assert.equal(reply.headers.get('Cache-Control'), 'no-store');
    assert.equal(reply.headers.has('Access-Control-Allow-Origin'), false);
    return new Response(Uint8Array.from(reply.body));
  });
  vi.stubGlobal('fetch', fetch);
  const file = createAgentIwad(h.metadata.size);
  assert.equal(file.size, bytes.length);
  assert.equal(fetch.mock.calls.length, 0);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  assert.equal(open.mock.calls.length, 1);
  writeFileSync(join(root, '.env.agent.local'), 'AGENT_IWAD_PATH=relative-other.wad\n');
  assert.equal(h.load(), h.source, 'No runtime file switching');
  assert.deepEqual((await route()).body, bytes);
});

it.each(['relative', 'missing', 'directory', 'unreadable', 'small', 'large'])('rejects %s configured input with a fixed actionable error and no file read', async kind => {
  const root = temporaryRoot();
  const file = join(root, 'private-input.wad');
  let path = file;
  if (kind === 'relative') path = 'private-relative.wad';
  if (kind === 'directory') path = root;
  if (['unreadable', 'small', 'large'].includes(kind)) writeFileSync(file, Buffer.alloc(12));
  if (kind === 'small') truncateSync(file, IWAD_MIN_BYTES - 1);
  if (kind === 'large') truncateSync(file, IWAD_MAX_BYTES + 1);
  if (kind === 'unreadable') {
    const access = fs.accessSync;
    vi.spyOn(fs, 'accessSync').mockImplementation((candidate, mode) => {
      if (candidate === path) throw Error(`EACCES ${path}`);
      return access(candidate, mode);
    });
  }
  const open = vi.spyOn(promises, 'open');
  syncBuiltinESMExports();
  const h = bootstrap(root, path);
  assert.equal(h.metadata.size, undefined);
  assert.match(h.metadata.error, /AGENT_IWAD_PATH.*fully stop and relaunch dev:agent/);
  if (!['small', 'large'].includes(kind)) assert.equal(h.metadata.error, agentIwadError);
  else assert.match(h.metadata.error, /12–33,554,432 bytes/);
  assert.equal(h.source.includes(path), false);
  const reply = await middleware(h.plugin)();
  assert.equal(reply.status, 400);
  assert.equal(reply.body.toString(), agentIwadReadError);
  assert.equal(open.mock.calls.length, 0);
});

it('rejects query lookups, other methods, hosts, origins and non-loopback/cross-site requests before opening a file', async () => {
  const root = temporaryRoot();
  const path = join(root, 'synthetic.wad');
  writeFileSync(path, Buffer.alloc(12));
  const h = bootstrap(root, path);
  const route = middleware(h.plugin);
  const open = vi.spyOn(promises, 'open');
  syncBuiltinESMExports();
  const headers = { host: new URL(agentOrigin).host, 'sec-fetch-site': 'same-origin' };
  for (const overrides of [
    { url: `${agentIwadUrl}?path=${encodeURIComponent(path)}` },
    { method: 'POST' },
    { headers: { ...headers, host: 'foreign.invalid:5174' } },
    { headers: { ...headers, origin: 'https://foreign.invalid' } },
    { headers: { ...headers, 'sec-fetch-site': 'cross-site' } },
    { headers: { host: headers.host } },
    { socket: { remoteAddress: '192.0.2.1' } },
  ]) {
    const reply = await route(overrides);
    assert.equal(reply.status, 403);
    assert.equal(reply.body.includes(path), false);
  }
  assert.equal((await route({ url: `${agentIwadUrl}/other.wad` })).passed, true);
  assert.equal(open.mock.calls.length, 0);
});

it('sanitizes file removal and size changes after metadata, with no fallback or retry', async () => {
  const root = temporaryRoot();
  const path = join(root, 'synthetic.wad');
  writeFileSync(path, Buffer.alloc(12));
  const h = bootstrap(root, path);
  const route = middleware(h.plugin);
  for (const change of [() => writeFileSync(path, Buffer.alloc(13)), () => rmSync(path)]) {
    change();
    const reply = await route();
    assert.equal(reply.status, 400);
    assert.equal(reply.body.toString(), agentIwadReadError);
  }
});

it('does not register middleware or inspect the configured IWAD outside agent serve', () => {
  const root = temporaryRoot();
  const path = join(root, 'never-open.wad');
  const read = vi.spyOn(fs, 'readFileSync');
  const stat = vi.spyOn(fs, 'statSync');
  syncBuiltinESMExports();
  for (const env of [
    { command: 'serve', mode: 'development' }, { command: 'serve', mode: 'impeccable' },
    { command: 'serve', mode: 'jev', isPreview: true },
    { command: 'build', mode: 'production' }, { command: 'build', mode: 'jev' },
  ]) {
    read.mockClear(); stat.mockClear();
    const h = bootstrap(root, path, env);
    assert.equal(h.plugin.configureServer, undefined);
    assert.equal(h.metadata, null);
    assert.equal(h.source.includes(path), false);
    assert.equal(read.mock.calls.length, 0);
    assert.equal(stat.mock.calls.length, 0);
  }
});

it('passes the local wrapper through unchanged controller proofs and native-admission failures without provider calls', async () => {
  const wad = new Uint8Array(12).fill(17).buffer;
  for (const rejectNative of [false, true]) {
    const h = fixture({ key: '', wad, mutateResult(data, result) {
      if (rejectNative && data.op === 'init') result.status = -2;
    } });
    const fetch = vi.fn(async () => new Response(wad));
    vi.stubGlobal('fetch', fetch);
    try {
      await h.controller.initialize();
      assert.equal(fetch.mock.calls.length, 0);
      await h.select(createAgentIwad(wad.byteLength));
      assert.equal(h.sdkCalls, 0);
      assert.equal(fetch.mock.calls.length, 1);
      assert.equal(h.view.session.prepared, !rejectNative);
      if (rejectNative) {
        assert.equal(h.view.session.phase, 'error');
        assert.match(h.view.status, /Native init failed/);
      } else {
        assert.equal(h.view.session.phase, 'ready');
        assert.equal(h.view.session.verifiedTics, 1);
        assert.equal(h.view.session.evidence.assets.iwad.bytes, wad.byteLength);
        assert.equal(h.view.session.evidence.idle.unchanged, true);
        assert.equal(h.view.session.hasClient, false);
      }
    } finally { await h.dispose(); }
  }
});

it('rejects out-of-bounds wrappers before any read and sanitizes transport and length failures', async () => {
  const h = fixture({ key: '' });
  const fetch = vi.fn(() => assert.fail('Out-of-bounds selection must not fetch'));
  vi.stubGlobal('fetch', fetch);
  try {
    await h.controller.initialize();
    for (const size of [IWAD_MIN_BYTES - 1, IWAD_MAX_BYTES + 1]) {
      await h.select(createAgentIwad(size));
      assert.equal(h.view.session.prepared, false);
      assert.equal(h.view.session.phase, 'unprepared');
      assert.equal(h.creations, 0);
    }
    assert.equal(fetch.mock.calls.length, 0);
    for (const result of [
      () => { throw Error('private transport details'); },
      () => new Response('private response body', { status: 400 }),
      () => new Response(new Uint8Array(13)),
    ]) {
      fetch.mockImplementation(result);
      await h.select(createAgentIwad(12));
      assert.equal(h.view.session.phase, 'unprepared');
      assert.equal(h.creations, 0);
      assert.match(h.view.status, /Configured agent IWAD could not be read/);
      assert.doesNotMatch(h.view.status, /private/);
    }
    assert.equal(fetch.mock.calls.length, 3, 'No retries');
    assert.equal(h.sdkCalls, 0);
  } finally { await h.dispose(); }
});
