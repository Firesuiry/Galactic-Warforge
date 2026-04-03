import { listJsonFiles, readJsonFile, writeJsonFile } from './file-store.js';

export interface AgentThreadRecord {
  id: string;
  agentId: string;
  title: string;
  messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }>;
  toolCalls: Array<{ type: string; payload: Record<string, unknown> }>;
  executionLogs: Array<{ level: 'info' | 'error'; message: string; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
}

export function createThreadStore(root: string) {
  return {
    list: () => listJsonFiles<AgentThreadRecord>(root),
    get: (id: string) => readJsonFile<AgentThreadRecord>(root, `${id}.json`),
    save: (thread: AgentThreadRecord) => writeJsonFile(root, `${thread.id}.json`, thread),
  };
}
