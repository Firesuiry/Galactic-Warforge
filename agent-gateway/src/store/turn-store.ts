import type { ConversationTurn } from '../types.js';
import { listJsonFiles, readJsonFile, writeJsonFile } from './file-store.js';

export function createTurnStore(root: string) {
  return {
    async list() {
      const turns = await listJsonFiles<ConversationTurn>(root);
      return turns.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },
    async listByConversation(conversationId: string) {
      const turns = await listJsonFiles<ConversationTurn>(root);
      return turns
        .filter((turn) => turn.conversationId === conversationId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },
    async get(turnId: string) {
      return readJsonFile<ConversationTurn>(root, `${turnId}.json`);
    },
    async save(turn: ConversationTurn) {
      await writeJsonFile(root, `${turn.id}.json`, turn);
    },
  };
}
