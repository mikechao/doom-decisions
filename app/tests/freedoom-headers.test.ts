import assert from 'node:assert/strict';
import { it } from 'vitest';
import config from '../vite.config.js';

it('serves the exact gzip file without HTTP decoding in dev/preview, including canonical subpaths', () => {
  for (const base of ['./', '/', '/doom/']) {
    for (const hook of ['configureServer', 'configurePreviewServer']) {
      const plugin = config({ command: 'serve', mode: 'development' }).plugins.find(p => p.name === 'freedoom-gzip-file');
      plugin.configResolved({ base });
      let middleware;
      assert.equal(plugin[hook]({ middlewares: { use(handler) { middleware = handler; } } }), undefined);
      const prefix = base === './' ? '/' : base;
      for (const url of [prefix + 'iwads/freedoom1.wad.gz', prefix + 'iwads/freedoom1.wad.gz?verify=1', prefix + 'doom.wasm', prefix + 'other.wad.gz', '/elsewhere/iwads/freedoom1.wad.gz']) {
        const headers = new Map();
        let next = 0;
        middleware({ url }, { setHeader(name, value) { headers.set(name, value); } }, () => ++next);
        assert.equal(next, 1);
        assert.deepEqual(Object.fromEntries(headers), url.startsWith(prefix + 'iwads/freedoom1.wad.gz')
          ? { 'Content-Type': 'application/gzip', 'Content-Encoding': 'identity' }
          : {});
      }
    }
  }
});
