import type { AgentTemplate } from '../types.js';
import { listJsonFiles, readJsonFile, writeJsonFile } from './file-store.js';

export function createTemplateStore(root: string) {
  return {
    list: () => listJsonFiles<AgentTemplate>(root),
    get: (id: string) => readJsonFile<AgentTemplate>(root, `${id}.json`),
    save: (template: AgentTemplate) => writeJsonFile(root, `${template.id}.json`, template),
  };
}
