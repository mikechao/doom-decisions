import type { LocalIwad } from './session-controller.ts';

export const agentIwadUrl = '/__agent_iwad';
export const agentIwadError =
  'AGENT_IWAD_PATH must name a readable regular file using an absolute path. Correct app/.env.agent.local, then fully stop and relaunch dev:agent.';
export const agentIwadReadError =
  'Configured agent IWAD could not be read or its size changed. Check AGENT_IWAD_PATH, then fully stop and relaunch dev:agent.';
export type AgentIwadMetadata = null | { size: number } | { error: string };

// Inert until the unchanged controller admits preparation and reads the file.
export function createAgentIwad(size: number): LocalIwad {
  return {
    size,
    async arrayBuffer() {
      try {
        const response = await fetch(agentIwadUrl, {
          mode: 'same-origin',
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
        });
        if (!response.ok) throw Error(agentIwadReadError);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== size) throw Error(agentIwadReadError);
        return bytes;
      } catch {
        // Never expose transport exceptions or response bodies.
        throw Error(agentIwadReadError);
      }
    },
  };
}
