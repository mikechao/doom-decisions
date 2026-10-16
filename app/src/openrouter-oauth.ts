// Inert until constructed by the explicit OpenRouter development entry.
const pendingKey = 'doom-decisions.openrouter-oauth.pending.v1';
const initialMessage = 'Sign in or use an API key instead.';
const invalidReturn =
  'Cannot verify sign-in return. Try again or use an API key.';
const incomplete = 'Sign-in was not completed. Try again or use an API key.';
const exchangeFailure =
  'OpenRouter key exchange failed. Try again or use an API key.';
const callbackParams = [
  'code',
  'state',
  'error',
  'error_description',
  'error_uri',
];

type Browser = Pick<
  Window,
  'location' | 'history' | 'sessionStorage' | 'crypto' | 'fetch'
>;
type Pending = {
  verifier: string;
  state: string;
  callback: string;
  search: string;
  hash: string;
};

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function createS256Challenge(verifier: string, webCrypto: Crypto) {
  const digest = await webCrypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

function isPending(value: unknown): value is Pending {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Pending>;
  return (
    typeof p.verifier === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(p.verifier) &&
    typeof p.state === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(p.state) &&
    typeof p.callback === 'string' &&
    typeof p.search === 'string' &&
    (p.search === '' || p.search.startsWith('?')) &&
    typeof p.hash === 'string' &&
    (p.hash === '' || p.hash.startsWith('#'))
  );
}

export function createOpenRouterOAuth(browser: Browser) {
  let message = initialMessage;
  let key = '';
  let busy = false;
  let closed = false;
  let redirecting = false;
  let generation = 0;
  let active: AbortController | undefined;
  let claimed: { code: string; verifier: string } | undefined;

  // Synchronous claim/cleanup precedes DOM startup and every network await.
  try {
    const raw = browser.sessionStorage.getItem(pendingKey);
    if (raw !== null) {
      browser.sessionStorage.removeItem(pendingKey);
      const pending: unknown = JSON.parse(raw);
      const url = new URL(browser.location.href);
      if (
        !isPending(pending) ||
        pending.callback !== url.origin + url.pathname
      ) {
        message = invalidReturn;
      } else {
        const states = url.searchParams.getAll('state');
        const codes = url.searchParams.getAll('code');
        const owned = states.length === 1 && states[0] === pending.state;
        if (owned) {
          const restored = new URL(
            pending.callback + pending.search + pending.hash,
          );
          for (const name of callbackParams) restored.searchParams.delete(name);
          // The authorization callback itself has no original query/hash.
          // Preserve any additional return parameters as well as original data.
          for (const [name, value] of url.searchParams) {
            if (!callbackParams.includes(name))
              restored.searchParams.append(name, value);
          }
          if (url.hash) restored.hash = url.hash;
          browser.history.replaceState(
            browser.history.state,
            '',
            restored.pathname + restored.search + restored.hash,
          );
        }
        const duplicate = callbackParams.some(
          (name) => url.searchParams.getAll(name).length > 1,
        );
        const hasError = callbackParams
          .slice(2)
          .some((name) => url.searchParams.has(name));
        if (
          owned &&
          !duplicate &&
          !hasError &&
          codes.length === 1 &&
          /^[\x21-\x7e]+$/.test(codes[0])
        ) {
          claimed = { code: codes[0], verifier: pending.verifier };
        } else {
          message =
            codes.length === 0 && !duplicate ? incomplete : invalidReturn;
        }
      }
    }
  } catch {
    // Includes blocked storage, malformed metadata and failed history cleanup.
    message = invalidReturn;
  }

  function clear() {
    generation++;
    key = '';
    claimed = undefined;
    active?.abort();
    active = undefined;
    busy = false;
    message = 'OpenRouter key cleared from this page.';
  }

  return {
    get message() {
      return message;
    },
    get busy() {
      return busy;
    },
    get closed() {
      return closed;
    },
    get hasKey() {
      return key.length > 0;
    },
    clear,
    close() {
      closed = true;
      clear();
      // The deliberate outgoing redirect must retain its one-time verifier.
      if (!redirecting) {
        try {
          browser.sessionStorage.removeItem(pendingKey);
        } catch {
          // Storage blocked.
        }
      }
    },
    takeKey(manual = '') {
      if (closed) return '';
      if (manual.trim()) {
        // Even an invalid manual replacement discards the unused OAuth key.
        clear();
        return manual.trim();
      }
      const result = key;
      key = '';
      if (result)
        message = 'OpenRouter key consumed; client status shown below.';
      return result;
    },
    async begin() {
      if (closed || busy || key || claimed) return;
      busy = true;
      message = 'Connecting…';
      const ownGeneration = ++generation;
      try {
        browser.sessionStorage.removeItem(pendingKey);
        const url = new URL(browser.location.href);
        const verifier = base64url(
          browser.crypto.getRandomValues(new Uint8Array(32)),
        );
        const state = base64url(
          browser.crypto.getRandomValues(new Uint8Array(32)),
        );
        const challenge = await createS256Challenge(verifier, browser.crypto);
        if (closed || generation !== ownGeneration) return;
        const callback = url.origin + url.pathname;
        // Never persist a stale/unowned auth code or raw server error on retry.
        for (const name of callbackParams) url.searchParams.delete(name);
        const serialized = JSON.stringify({
          verifier,
          state,
          callback,
          search: url.search,
          hash: url.hash,
        } satisfies Pending);
        browser.sessionStorage.setItem(pendingKey, serialized);
        if (browser.sessionStorage.getItem(pendingKey) !== serialized) {
          throw new Error('Pending storage unavailable');
        }
        const authorize = new URL('https://openrouter.ai/auth');
        authorize.search = new URLSearchParams({
          callback_url: callback,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        }).toString();
        redirecting = true;
        browser.location.assign(authorize.href);
      } catch {
        if (generation !== ownGeneration || closed) return;
        redirecting = false;
        try {
          browser.sessionStorage.removeItem(pendingKey);
        } catch {
          // Storage blocked.
        }
        busy = false;
        message =
          'Cannot start OpenRouter sign-in. Check browser storage and try again, or use an API key.';
      }
    },
    async exchange() {
      if (!claimed || closed || busy) return;
      const { code, verifier } = claimed;
      // Never replay, even if timeout or reload loses the result.
      claimed = undefined;
      busy = true;
      message = 'Connecting…';
      const ownGeneration = ++generation;
      const controller = new AbortController();
      active = controller;
      let timedOut = false;
      let rejectAbort: () => void = () => {};
      const cancelled = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(new Error('Exchange cancelled'));
      });
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 10000);
      try {
        const responseWork = (async (): Promise<unknown> => {
          const response = await browser.fetch(
            'https://openrouter.ai/api/v1/auth/keys',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code,
                code_verifier: verifier,
                code_challenge_method: 'S256',
              }),
              signal: controller.signal,
              mode: 'cors',
              credentials: 'omit',
              cache: 'no-store',
              redirect: 'error',
              referrerPolicy: 'no-referrer',
            },
          );
          if (!response.ok) throw new Error('Exchange HTTP failure');
          return response.json();
        })();
        const data = await Promise.race([responseWork, cancelled]);
        if (closed || generation !== ownGeneration || controller.signal.aborted)
          return;
        if (
          !data ||
          typeof data !== 'object' ||
          !('key' in data) ||
          typeof data.key !== 'string' ||
          !/^[\x21-\x7e]+$/.test(data.key)
        ) {
          throw new Error('Invalid exchange response');
        }
        key = data.key;
        message =
          'OpenRouter key received (in this tab). Model access unverified.';
      } catch {
        if (!closed && generation === ownGeneration) {
          message = timedOut
            ? 'OpenRouter key exchange timed out. Try again or use an API key.'
            : exchangeFailure;
        }
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', rejectAbort);
        if (generation === ownGeneration) {
          active = undefined;
          busy = false;
        }
      }
    },
  };
}
