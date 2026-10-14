// Only the Node APIs consumed by synthetic-doom.ts; no @types/node dependency.
declare module 'node:assert/strict' {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
  };
  export default assert;
}
declare module 'node:crypto' {
  export function createHash(algorithm: string): {
    update(bytes: Uint8Array | Uint8ClampedArray): {
      digest(encoding: 'hex'): string;
    };
  };
}
