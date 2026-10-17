import type { ActionName } from './decision.ts';

export type DecisionRequest = Readonly<{
  instructions: string;
  context: string;
  png: string;
  permittedActions: readonly ActionName[];
}>;

// Provider output remains untrusted until controller-side runtime validation.
export type DecisionResult =
  | { kind: 'refusal' }
  | {
      kind: 'choice';
      action: string;
      confidence?: unknown;
      probabilities?: unknown;
    };

// Structural views of the controller's existing mutable lifecycle/evidence.
export type DecisionLifecycle = {
  apiController?: AbortController;
  sdkRead?: Promise<void>;
};
export type DecisionDiagnostics = {
  requestId: string | null;
  http: number | null;
  latencyMs: number | null;
  // Encoding identifies the prepared call; only beforeCreate marks invocation.
  requestIdentity?: Readonly<{
    provider: 'OpenRouter' | 'OpenAI' | 'TypeSafe / Jev';
    requestedModel: string;
  }>;
  sdkInvoked?: boolean;
  responseMetadata?: Readonly<{
    reportedModel: string | null;
    usage: Readonly<{
      input: number | null;
      output: number | null;
      total: number | null;
    }>;
  }>;
};
export type DecisionHooks = {
  assertFresh(): void;
  // Exactly once, synchronously immediately before an invocation, after preflight.
  beforeCreate(): void;
  onReadStateChange(): void;
};

export interface DecisionProvider {
  // startedAt precedes domain AND wire construction. Result settlement never
  // releases sdkRead: it tracks all underlying response work independently.
  // Recoverable failures use DecisionFailure with fixed local messages; never
  // expose raw provider errors, response bodies or credentials in diagnostics.
  request(
    input: DecisionRequest,
    lifecycle: DecisionLifecycle,
    diagnostics: DecisionDiagnostics,
    hooks: DecisionHooks,
    startedAt: number,
  ): Promise<DecisionResult>;
}

export interface DecisionProviderFactory {
  // Inert availability check; evidence is display-only provider provenance.
  probe(): {
    status: string;
    evidence: Readonly<Record<string, string | boolean>>;
  };
  create(apiKey: string): DecisionProvider;
}
