import assert from 'node:assert/strict';
import test from 'node:test';
import type { LanguageModel } from 'ai';
import type {
  DoomMemoryCandidate,
  DoomMemoryLookupResult,
  NearbyMemoryQuery,
} from '../src/doom-tools.ts';

type FindMemoryInput = {
  mapNamespace: string;
  x: number;
  y: number;
  angle: number;
};

function syntheticInput(): FindMemoryInput {
  return {
    mapNamespace: `doom-map:v1:iwad-sha256:${'a'.repeat(64)}:E1M1`,
    x: 131072,
    y: -196608,
    angle: 0x40000000,
  };
}

function candidate(mapNamespace: string): DoomMemoryCandidate {
  return {
    noteId: '66666666-6666-4666-8666-666666666666',
    revision: 1,
    mapNamespace,
    anchor: { x: 1, y: -4, headingDeg: 88 },
    source: 'synthetic-test',
    hypothesis: 'A synthetic corridor may be nearby.',
    nextQuestion: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'unverified',
    isLandmark: true,
    isActiveExploration: false,
    distance: 1.414,
    headingDifferenceDeg: 2,
    entries: [],
  };
}

type DoomToolSet = { findMemory: unknown };

type RunnableTool = {
  inputSchema: { safeParse(input: unknown): { success: boolean } };
  execute?: (input: unknown, options: unknown) => Promise<unknown>;
};

function runnableTool(tools: DoomToolSet): RunnableTool {
  return tools.findMemory as unknown as RunnableTool;
}

function executeTool(tools: DoomToolSet, input: unknown) {
  const execute = runnableTool(tools).execute;
  assert.equal(typeof execute, 'function');
  return execute!(input, { toolCallId: 'synthetic-tool-call', messages: [] });
}

const emptyMemory: DoomMemoryLookupResult = {
  caution: 'Underlying Doom memory caution.',
  candidates: [],
};

test('importing and constructing the native tool are inert', async (t) => {
  const fetchStub = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Network access is forbidden in this test.');
  });
  const { createDoomTools: factory } = await import('../src/doom-tools.ts');
  const tools = factory();

  assert.deepEqual(Object.keys(tools), ['findMemory']);
  assert.equal(typeof runnableTool(tools).execute, 'function');
  assert.equal(fetchStub.mock.callCount(), 0);
});

test('tool accepts only mapNamespace, x, y, and angle; radius and limit stay fixed', async () => {
  const { createDoomTools } = await import('../src/doom-tools.ts');
  const queries: NearbyMemoryQuery[] = [];
  const tools = createDoomTools({
    lookupMemory: async (query) => {
      queries.push(query);
      assert.equal(Object.isFrozen(query), true);
      return { caution: 'Synthetic caution.', candidates: [candidate(query.mapNamespace)] };
    },
  });
  const nativeTool = runnableTool(tools);
  const input = syntheticInput();

  assert.equal(nativeTool.inputSchema.safeParse(input).success, true);
  assert.equal(nativeTool.inputSchema.safeParse({
    ...input,
    radius: 1,
    limit: 10,
    mode: 'active-landmarks',
    databasePath: '/tmp/model-selected.sqlite',
  }).success, false);

  await assert.rejects(executeTool(tools, {
    ...input,
    radius: 1,
    limit: 10,
    mode: 'active-landmarks',
    databasePath: '/tmp/model-selected.sqlite',
  }));
  assert.equal(queries.length, 0);

  const result = await executeTool(tools, input) as {
    status: string;
    advisoryStatus: string;
    query: NearbyMemoryQuery;
    candidates: { advisoryStatus: string }[];
    caution: string;
  };
  assert.deepEqual(queries, [{
    mode: 'nearby',
    mapNamespace: input.mapNamespace,
    x: 2,
    y: -3,
    headingDeg: 90,
    radius: 128,
    limit: 3,
  }]);
  assert.equal(result.status, 'found');
  assert.equal(result.advisoryStatus, 'historical-advisory-unverified');
  assert.equal(result.candidates[0].advisoryStatus, 'historical-advisory-unverified');
  assert.match(result.caution, /Proximity does not verify/);
});

test('AI SDK executes the tool and forwards its advisory result to the next model step', async () => {
  const { createDoomTools } = await import('../src/doom-tools.ts');
  const toolInput = syntheticInput();
  const lookups: NearbyMemoryQuery[] = [];
  const tools = createDoomTools({
    lookupMemory: async (query) => {
      lookups.push(query);
      return {
        caution: 'Synthetic lookup only.',
        candidates: [candidate(query.mapNamespace)],
      };
    },
  });
  let modelCalls = 0;
  const usage = {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };
  const model: Extract<LanguageModel, { specificationVersion: 'v4' }> = {
    specificationVersion: 'v4',
    provider: 'synthetic-provider',
    modelId: 'synthetic-model',
    supportedUrls: {},
    async doGenerate({ prompt }) {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          content: [{
            type: 'tool-call',
            toolCallId: 'synthetic-memory-call',
            toolName: 'findMemory',
            input: JSON.stringify(toolInput),
          }],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage,
          warnings: [],
        };
      }
      assert.match(JSON.stringify(prompt), /historical-advisory-unverified/);
      assert.match(JSON.stringify(prompt), /A synthetic corridor may be nearby/);
      return {
        content: [{ type: 'text', text: 'The next step received advisory memory.' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
      };
    },
    async doStream() {
      throw new Error('Streaming is not part of this deterministic test.');
    },
  };

  const { generateText, stepCountIs } = await import('ai');
  const result = await generateText({
    model,
    tools,
    stopWhen: stepCountIs(2),
    maxRetries: 0,
    prompt: 'Look up nearby memory.',
  });

  assert.equal(modelCalls, 2);
  assert.equal(result.steps.length, 2);
  assert.equal(result.text, 'The next step received advisory memory.');
  assert.deepEqual(lookups, [{
    mode: 'nearby',
    mapNamespace: toolInput.mapNamespace,
    x: 2,
    y: -3,
    headingDeg: 90,
    radius: 128,
    limit: 3,
  }]);
  assert.equal(result.steps[0].toolResults[0].toolName, 'findMemory');
});

test('successful empty lookup and failed lookup are distinct, with no automatic retry', async () => {
  const { createDoomTools } = await import('../src/doom-tools.ts');
  const toolInput = syntheticInput();
  const emptyTools = createDoomTools({ lookupMemory: async () => emptyMemory });
  const empty = await executeTool(emptyTools, toolInput) as {
    status: string;
    candidates: unknown[];
  };
  assert.equal(empty.status, 'empty');
  assert.deepEqual(empty.candidates, []);

  let attempts = 0;
  const failedTools = createDoomTools({
    lookupMemory: async () => {
      attempts += 1;
      throw new Error('sensitive raw storage exception');
    },
  });
  const failed = await executeTool(failedTools, toolInput) as {
    status: string;
    error: string;
  };
  assert.equal(failed.status, 'lookup_failed');
  assert.equal(failed.error, 'memory-lookup-failed');
  assert.equal(attempts, 1);
  assert.doesNotMatch(JSON.stringify(failed), /sensitive raw storage exception/);
});
