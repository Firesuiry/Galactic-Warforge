import { listJsonFiles, readJsonFile, writeJsonFile } from './file-store.js';

export interface AgentInstanceRecord {
  id: string;
  name: string;
  templateId: string;
  serverUrl: string;
  playerId: string;
  status: 'idle' | 'running' | 'paused' | 'error' | 'completed';
  goal: string;
  activeThreadId: string;
  createdAt: string;
  updatedAt: string;
}

export function createAgentStore(root: string) {
  return {
    list: () => listJsonFiles<AgentInstanceRecord>(root),
    get: (id: string) => readJsonFile<AgentInstanceRecord>(root, `${id}.json`),
    save: (agent: AgentInstanceRecord) => writeJsonFile(root, `${agent.id}.json`, agent),
  };
}
