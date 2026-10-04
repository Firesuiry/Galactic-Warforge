import type { AgentInstance } from '@gw/shared/agent-gateway';
import { listJsonFiles, readJsonFile, writeJsonFile } from './file-store.js';

export function createAgentStore(root: string) {
  return {
    list: () => listJsonFiles<AgentInstance>(root),
    get: (id: string) => readJsonFile<AgentInstance>(root, `${id}.json`),
    save: (agent: AgentInstance) => writeJsonFile(root, `${agent.id}.json`, agent),
  };
}
