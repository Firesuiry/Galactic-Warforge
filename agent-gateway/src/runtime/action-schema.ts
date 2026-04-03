import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const AGENT_ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assistantMessage', 'actions', 'done'],
  properties: {
    assistantMessage: { type: 'string' },
    done: { type: 'boolean' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type'],
        properties: {
          type: {
            type: 'string',
            enum: ['game.query', 'game.command', 'game.cli', 'memory.note', 'final_answer'],
          },
          commandLine: { type: 'string' },
          message: { type: 'string' },
          note: { type: 'string' },
          query: { type: 'string' },
          args: { type: 'object' },
          command: { type: 'object' },
        },
      },
    },
  },
} as const;

export function assertSupportedAction(action: Record<string, unknown>) {
  if (typeof action.type !== 'string') {
    throw new Error('action.type is required');
  }
  if (action.type === 'game.cli' && typeof action.commandLine !== 'string') {
    throw new Error('game.cli requires commandLine');
  }
  if (action.type === 'final_answer' && typeof action.message !== 'string') {
    throw new Error('final_answer requires message');
  }
}

export async function ensureActionSchemaFile(root: string) {
  const dir = path.join(root, 'schemas');
  const filePath = path.join(dir, 'agent-turn.schema.json');

  try {
    await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, JSON.stringify(AGENT_ACTION_SCHEMA, null, 2), 'utf8');
  }

  return filePath;
}
