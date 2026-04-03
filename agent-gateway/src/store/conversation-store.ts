import type { Conversation } from '../types.js';
import { listJsonFiles, readJsonFile, writeJsonFile } from './file-store.js';

export function createConversationStore(root: string) {
  return {
    list: () => listJsonFiles<Conversation>(root),
    get: (id: string) => readJsonFile<Conversation>(root, `${id}.json`),
    save: (conversation: Conversation) => writeJsonFile(root, `${conversation.id}.json`, conversation),
  };
}
