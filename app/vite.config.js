import { defineConfig } from 'vite';

const strictCsp =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self'; worker-src 'self'; connect-src 'self' https://api.openai.com; base-uri 'none'; form-action 'none'";
// Installed Impeccable setup: HTTP scripts/SSE and inline styles; Vite: HMR.
// Reconfirm the helper's actual origin before starting a Live trial.
const impeccableCsp = strictCsp
  .replace("script-src 'self'", "script-src 'self' http://localhost:8400")
  .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
  .replace(
    "connect-src 'self'",
    "connect-src 'self' http://localhost:8400 ws://127.0.0.1:5173",
  );

function transformCsp(html) {
  const fail = () => {
    throw new Error(
      'Impeccable dev CSP: expected exactly one unambiguous strict CSP meta element',
    );
  };
  // Quoted values may contain >; attributes may be reordered or added by Live.
  const metas = [...html.matchAll(/<meta\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)];
  const candidates = metas.flatMap((meta) => {
    const attrs = [
      ...meta[0].matchAll(
        /\s+([^\s="'<>/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g,
      ),
    ];
    const values = (name) =>
      attrs.filter((attr) => attr[1].toLowerCase() === name);
    const equiv = values('http-equiv');
    const value = (attr) =>
      (attr[2] ?? '')
        .replace(/^(["'])([\s\S]*)\1$/, '$2')
        .replace(/&#39;|&#x27;|&apos;/gi, "'");
    if (
      !equiv.some(
        (attr) => value(attr).toLowerCase() === 'content-security-policy',
      )
    ) {
      return [];
    }
    const content = values('content');
    const original = values('data-impeccable-csp-original');
    if (equiv.length !== 1 || content.length !== 1 || original.length > 1)
      fail();
    // Live may rewrite content and retain the original in this extra attribute.
    // Always emit our bounded policy, never inherit Live's added permissions.
    const originalPolicy =
      original.length === 1
        ? Buffer.from(value(original[0]), 'base64').toString('utf8')
        : value(content[0]);
    if (originalPolicy !== strictCsp) fail();
    return [{ meta, content: content[0] }];
  });
  if (candidates.length !== 1) fail();
  const { meta, content } = candidates[0];
  const offset = meta.index + content.index;
  return (
    html.slice(0, offset) +
    ` content="${impeccableCsp}"` +
    html.slice(offset + content[0].length)
  );
}

export default defineConfig(({ command, mode }) => ({
  base: './',
  worker: { format: 'es' },
  plugins:
    command === 'serve' && mode === 'impeccable'
      ? [{ name: 'impeccable-dev-csp', transformIndexHtml: transformCsp }]
      : [],
}));
