import type { ModelProvider } from '../types.js';
import { listJsonFiles, readJsonFile, writeJsonFile } from './file-store.js';

export function createProviderStore(root: string) {
  return {
    list: () => listJsonFiles<ModelProvider>(root),
    get: (id: string) => readJsonFile<ModelProvider>(root, `${id}.json`),
    save: (provider: ModelProvider) => writeJsonFile(root, `${provider.id}.json`, provider),
  };
}
