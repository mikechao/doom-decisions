declare module 'virtual:agent-bootstrap' {
  export const enabled: boolean;
  export const localIwad: import('./agent-iwad').AgentIwadMetadata;
  export const model: import('./openrouter-decision-provider').OpenRouterModel;
  export function takeKey(): string;
}
