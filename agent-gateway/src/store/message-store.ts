import type { ConversationMessage } from '../types.js';
import { listJsonFiles, readJsonFile, writeJsonFile } from './file-store.js';

async function readConversationMessages(root: string, conversationId: string) {
  return (await readJsonFile<ConversationMessage[]>(root, `${conversationId}.json`)) ?? [];
}

export function createMessageStore(root: string) {
  return {
    async list() {
      const buckets = await listJsonFiles<ConversationMessage[]>(root);
      return buckets.flat();
    },
    async listByConversation(conversationId: string) {
      return readConversationMessages(root, conversationId);
    },
    async append(message: ConversationMessage) {
      const messages = await readConversationMessages(root, message.conversationId);
      messages.push(message);
      await writeJsonFile(root, `${message.conversationId}.json`, messages);
    },
  };
}
