import { ToolLoopAgent, isStepCount } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

// Compile-only: this function is never invoked or imported by the runtime test.
// Published provider/model/client constructors are lazy; inference starts later.
export function nativeModelTypecheck() {
  const provider = createCodexAppServer();
  const model = provider('gpt-6-luna');
  const specificationVersion: 'v4' = model.specificationVersion;
  const agent = new ToolLoopAgent({
    model,
    instructions: 'Compile-only native SDK 7 boundary; no inference authorized.',
    maxRetries: 0,
    stopWhen: isStepCount(1),
  });
  return { provider, agent, specificationVersion };
}
