import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vite';
import freedoom from './src/freedoom-identity.json' with { type: 'json' };

// Private input is read only when an agent dev page requests this module.
// Never put its contents in Vite env/define/config: debug output can print them.
function agentBootstrap(enabled) {
  const id = '\0doom-agent-bootstrap';
  let root;
  return {
    name: 'agent-bootstrap',
    configResolved(config) {
      root = config.root;
      if (enabled && config.server.host !== '127.0.0.1')
        throw new Error('AI Agent development requires host 127.0.0.1.');
    },
    resolveId(source) {
      if (source === 'virtual:agent-bootstrap') return id;
    },
    load(source) {
      if (source !== id) return;
      let key = '';
      if (enabled) {
        try {
          const candidate = parseEnv(
            readFileSync(join(root, '.env.agent.local'), 'utf8'),
          ).AGENT_OPENROUTER_API_KEY?.trim();
          if (candidate && /^[\x21-\x7e]+$/.test(candidate)) key = candidate;
        } catch {
          // An absent/unreadable optional credential must not block the game.
          // File/parse exceptions can contain private input; never log them.
        }
      }
      // Deliberate local-browser exposure. Transfer once into the app's ephemeral
      // credential port; no persistent exported key, DOM field or browser storage.
      return `export const enabled = ${enabled};
let key = ${JSON.stringify(key)};
export function takeKey() { const result = key; key = ''; return result; }`;
    },
  };
}

// Vite's static middleware labels *.gz as HTTP Content-Encoding:gzip. This
// particular asset is a gzip FILE: leave its bytes for DecompressionStream.
function freedoomFileHeaders() {
  let assetPath;
  const headers = (req, res, next) => {
    if (req.url?.split('?')[0] === assetPath) {
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Encoding', 'identity');
    }
    next();
  };
  return {
    name: 'freedoom-gzip-file',
    configResolved(config) {
      const base =
        config.base === './' || config.base === '' ? '/' : config.base;
      assetPath = base + freedoom.gzip.path;
    },
    configureServer(server) {
      server.middlewares.use(headers);
    },
    configurePreviewServer(server) {
      server.middlewares.use(headers);
    },
  };
}

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

export default defineConfig(({ command, mode, isPreview }) => {
  if (mode === 'agent' && (command !== 'serve' || isPreview))
    throw new Error(
      'AI Agent mode is development serving only; builds and preview are disabled.',
    );
  const agentServe = command === 'serve' && mode === 'agent' && !isPreview;
  return {
    base: './',
    worker: { format: 'es' },
    build: {
      minify: false,
      sourcemap: true,
    },
    ...(command === 'serve' && mode === 'jev' && !isPreview
      ? { server: { host: '127.0.0.1', cors: false, proxy: jevProxy() } }
      : {}),
    ...(agentServe
      ? {
          server: {
            host: '127.0.0.1',
            cors: false,
            headers: { 'Cache-Control': 'no-store' },
          },
        }
      : {}),
    // Vite preview otherwise inherits server.proxy. This is never a preview API.
    preview: { proxy: {} },
    plugins: [
      ...(command === 'serve' && !isPreview
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
        : []),
      freedoomFileHeaders(),
      agentBootstrap(agentServe),
    ],
  };
});
