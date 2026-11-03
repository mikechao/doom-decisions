import { hermesToolMiddleware } from '@ai-sdk-tool/parser';
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

export type CliProvider = {
  languageModel(): ReturnType<typeof wrapLanguageModel>;
  initialize(): Promise<void>;
  assertHealthy(): void;
  close(): Promise<void>;
  childExitObserved(): boolean;
};

export const cliModel = 'gpt-6.1-sol';
export const localCodexPath = '/Users/mike/.nvm/versions/node/v22.20.0/bin/codex';

export type CliFailureCode = 'CLI_PROVIDER_WARNING' | 'CLI_IMAGE_WRITE_FAILED' | 'CLI_STREAM_WARNING' |
  'CLI_NATIVE_TOOL_EVENT' | 'CLI_NATIVE_TOOL_DECLARATION' | 'CLI_PROVIDER_CLOSED' | 'CLI_MODEL_UNAVAILABLE' |
  'CLI_COMMAND_APPROVAL_REQUEST' | 'CLI_FILE_APPROVAL_REQUEST' | 'CLI_SKILL_APPROVAL_REQUEST' |
  'CLI_MCP_ELICITATION_REQUEST' | 'CLI_DYNAMIC_TOOL_REQUEST' | 'CLI_AUTH_REFRESH_REQUEST' | 'CLI_UNHANDLED_SERVER_REQUEST';

// Fixed host codes only. Never retain a provider message, rejected value or path.
export class CliProviderError extends Error {
  readonly code: CliFailureCode;
  constructor(code: CliFailureCode) { super(code); this.code = code; }
}

export function cliFailureCode(reason: unknown): CliFailureCode | null {
  return reason instanceof CliProviderError ? reason.code : null;
}

// A warning can mean the provider omitted the PNG. Never accept that request.
export function rejectCliProvider(abort: AbortController, code: CliFailureCode = 'CLI_PROVIDER_WARNING'): never {
  const error = new CliProviderError(code);
  abort.abort(error); // AbortController retains the first reason if Stop/deadline already won.
  throw error;
}

export function rejectCliWarning(abort: AbortController, message: string): never {
  return rejectCliProvider(abort, message.startsWith('[codex-app-server] Failed to write image to temp file:')
    ? 'CLI_IMAGE_WRITE_FAILED' : 'CLI_PROVIDER_WARNING');
}

// Below Hermes: inspect provider events before text parsing. Late startup must
// close again after settlement, because close() can race lazy client creation.
export function cliSafetyMiddleware(abort: AbortController, isClosed: () => boolean,
  close: () => Promise<void>): LanguageModelMiddleware {
  return {
    specificationVersion: 'v4',
    transformParams: async ({ params }) => {
      abort.signal.throwIfAborted();
      if (params.tools?.length) rejectCliProvider(abort, 'CLI_NATIVE_TOOL_DECLARATION');
      // Hermes has already rendered SDK tools into text and retains its parsing
      // metadata. The pinned provider warns for ANY defined tools value, even [].
      return params.tools?.length === 0 ? { ...params, tools: undefined } : params;
    },
    wrapGenerate: async () => { throw new Error('STREAMING_ONLY'); },
    wrapStream: async ({ doStream }) => {
      abort.signal.throwIfAborted();
      if (isClosed()) rejectCliProvider(abort, 'CLI_PROVIDER_CLOSED');
      try {
        const result = await doStream();
        abort.signal.throwIfAborted();
        if (isClosed()) rejectCliProvider(abort, 'CLI_PROVIDER_CLOSED');
        return { ...result, stream: result.stream.pipeThrough(new TransformStream({ transform(part, controller) {
          abort.signal.throwIfAborted();
          if (part.type === 'stream-start' && part.warnings.length) rejectCliProvider(abort, 'CLI_STREAM_WARNING');
          if (part.type === 'tool-result' || part.type === 'tool-call' || part.type === 'tool-input-start' ||
              part.type === 'tool-input-delta' || part.type === 'tool-input-end') rejectCliProvider(abort, 'CLI_NATIVE_TOOL_EVENT');
          controller.enqueue(part);
        } })) };
      } finally {
        if (isClosed()) await close();
      }
    },
  };
}

// Construction is lazy. No global configuration or authentication is changed.
export function createCliProvider(cwd: string, abort: AbortController): CliProvider {
  let exited = false, closed = false;
  const deny = (code: CliFailureCode) => abort.abort(new CliProviderError(code));
  const provider = createCodexAppServer({ defaultSettings: {
    codexPath: localCodexPath, cwd, threadMode: 'stateless',
    sandboxPolicy: 'read-only', approvalPolicy: 'on-request', autoApprove: false,
    connectionTimeoutMs: 15_000, requestTimeoutMs: 15_000,
    logger: {
      debug() {}, error() {},
      // The pinned provider catches a failed temp-image write and warns. Throw
      // here, before turn/start, rather than accepting an image-less request.
      // Fail on every warning, including unknown future warning formats.
      warn: message => rejectCliWarning(abort, message),
      info(message) { if (/codex app-server exited \(code=/.test(message)) exited = true; },
    },
    serverRequests: {
      onCommandExecutionApproval: async () => { deny('CLI_COMMAND_APPROVAL_REQUEST'); return { decision: 'decline' }; },
      onFileChangeApproval: async () => { deny('CLI_FILE_APPROVAL_REQUEST'); return { decision: 'decline' }; },
      onSkillApproval: async () => { deny('CLI_SKILL_APPROVAL_REQUEST'); return { decision: 'decline' }; },
      onMcpElicitation: async () => { deny('CLI_MCP_ELICITATION_REQUEST'); return { action: 'decline' }; },
      onDynamicToolCall: async () => { deny('CLI_DYNAMIC_TOOL_REQUEST'); return { contentItems: [], success: false }; },
      onAuthRefresh: async () => rejectCliProvider(abort, 'CLI_AUTH_REFRESH_REQUEST'),
      onUnhandled: async () => rejectCliProvider(abort, 'CLI_UNHANDLED_SERVER_REQUEST'),
    },
  } });
  const model = wrapLanguageModel({ model: provider(cliModel), middleware: [hermesToolMiddleware,
    cliSafetyMiddleware(abort, () => closed, () => provider.close()),
  ] });
  return {
    languageModel: () => model,
    async initialize() {
      abort.signal.throwIfAborted();
      if (closed) rejectCliProvider(abort, 'CLI_PROVIDER_CLOSED');
      const catalog = await provider.listModels();
      abort.signal.throwIfAborted();
      if (closed) rejectCliProvider(abort, 'CLI_PROVIDER_CLOSED');
      if (!catalog.models.some(model => model.model === cliModel || model.id === cliModel)) rejectCliProvider(abort, 'CLI_MODEL_UNAVAILABLE');
    },
    assertHealthy() { abort.signal.throwIfAborted(); if (closed) rejectCliProvider(abort, 'CLI_PROVIDER_CLOSED'); },
    async close() { closed = true; await provider.close(); },
    childExitObserved: () => exited,
  };
}
