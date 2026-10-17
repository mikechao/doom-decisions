import identity from './freedoom-identity.json';
import type { LocalIwad } from './session-controller';

const failure =
  'Included Freedoom could not be loaded or verified. Try again or choose a local IWAD.';

async function matches(
  bytes: ArrayBuffer,
  expected: { bytes: number; sha256: string },
) {
  if (bytes.byteLength !== expected.bytes) return false;
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  return hash === expected.sha256;
}

// Construction is inert. prepare() owns admission before invoking arrayBuffer().
export function createIncludedFreedoom(baseUrl: string): LocalIwad {
  return {
    size: identity.wad.bytes,
    async arrayBuffer() {
      if (typeof DecompressionStream === 'undefined')
        throw Error(
          'This browser cannot decompress included Freedoom. Choose a local IWAD.',
        );
      try {
        const response = await fetch(baseUrl + identity.gzip.path, {
          mode: 'same-origin',
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
        });
        if (!response.ok) throw Error(failure);
        const compressed = await response.arrayBuffer();
        // Require gzip FILE bytes after any HTTP decoding. A host that incorrectly
        // labels the stored gzip as Content-Encoding:gzip fails before decompression.
        if (!(await matches(compressed, identity.gzip))) throw Error(failure);
        const stream = new Response(compressed).body;
        if (!stream) throw Error(failure);
        const wad = await new Response(
          stream.pipeThrough(new DecompressionStream('gzip')),
        ).arrayBuffer();
        if (!(await matches(wad, identity.wad))) throw Error(failure);
        return wad;
      } catch {
        // Never display transport exceptions, URLs, or untrusted response bodies.
        throw Error(failure);
      }
    },
  };
}
