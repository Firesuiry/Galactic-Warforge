import type { AgentThread } from '../types.js';
import { listJsonFiles, readJsonFile, writeJsonFile } from './file-store.js';

export function createThreadStore(root: string) {
  return {
    list: () => listJsonFiles<AgentThread>(root),
    get: (id: string) => readJsonFile<AgentThread>(root, `${id}.json`),
    save: (thread: AgentThread) => writeJsonFile(root, `${thread.id}.json`, thread),
  };
}
