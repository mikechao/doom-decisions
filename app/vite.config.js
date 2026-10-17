import { defineConfig } from 'vite';

const strictCsp =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self'; img-src data:; worker-src 'self'; connect-src 'self' https://openrouter.ai https://api.openai.com; base-uri 'none'; form-action 'none'";
// Vite serves imported CSS through inline style elements during development.
const devCsp = strictCsp.replace(
  "style-src 'self'",
  "style-src 'self' 'unsafe-inline'",
);
// Experimental provider, only when explicitly serving in Jev development mode.
const jevCsp = devCsp.replace(
  "connect-src 'self' https://openrouter.ai https://api.openai.com",
  "connect-src 'self'",
);
// Installed Impeccable setup: HTTP scripts/SSE and inline styles; Vite: HMR.
// Reconfirm the helper's actual origin before starting a Live trial.
const impeccableCsp = devCsp
  .replace("script-src 'self'", "script-src 'self' http://localhost:8400")
  .replace(
    "connect-src 'self'",
    "connect-src 'self' http://localhost:8400 ws://127.0.0.1:5173",
  );

function transformCsp(html, csp) {
  const fail = () => {
    throw new Error(
      'Dev CSP: expected exactly one unambiguous strict CSP meta element',
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
    ` content="${csp}"` +
    html.slice(offset + content[0].length)
  );
}

// The key stays in this closure, never in serializable proxy/config properties.
function jevProxy() {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key || !/^[\x21-\x7e]+$/.test(key))
    throw new Error(
      'Jev development requires a header-safe TYPESAFE_API_KEY on the Vite server.',
    );
  return {
    // Claim the namespace so unsupported paths fail instead of reaching upstream.
    '/__jev': {
      target: 'https://api.typesafe.ai',
      changeOrigin: true,
      secure: true,
      followRedirects: false,
      bypass(req) {
        const host = req.headers.host;
        if (
          req.url !== '/__jev/v1/systemone' ||
          req.method !== 'POST' ||
          !/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host ?? '') ||
          req.headers.origin !== `http://${host}` ||
          req.headers.expect !== undefined ||
          !/^multipart\/form-data;\s*boundary=/.test(
            req.headers['content-type'] ?? '',
          )
        )
          return false;
      },
      rewrite: () => '/v1/systemone',
      configure(proxy) {
        proxy.on('proxyReq', (outgoing) => {
          outgoing.setHeader('authorization', `Bearer ${key}`);
          for (const name of [
            'cookie',
            'proxy-authorization',
            'origin',
            'referer',
          ])
            outgoing.removeHeader(name);
        });
        proxy.on('proxyRes', (response) => {
          delete response.headers['set-cookie'];
        });
      },
    },
  };
}

export default defineConfig(({ command, mode, isPreview }) => ({
  base: './',
  worker: { format: 'es' },
  build: {
    minify: false,
    sourcemap: true,
  },
  ...(command === 'serve' && mode === 'jev' && !isPreview
    ? { server: { host: '127.0.0.1', cors: false, proxy: jevProxy() } }
    : {}),
  // Vite preview otherwise inherits server.proxy. This is never a preview API.
  preview: { proxy: {} },
  plugins:
    command === 'serve' && !isPreview
      ? [
          {
            name: 'dev-csp',
            transformIndexHtml: (html) =>
              transformCsp(
                html,
                mode === 'impeccable'
                  ? impeccableCsp
                  : mode === 'jev'
                    ? jevCsp
                    : devCsp,
              ),
          },
        ]
      : [],
}));
