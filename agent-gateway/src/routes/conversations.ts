import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { resolveMentionTargetsFromContent } from '../runtime/router.js';
import type { AgentInstance, Conversation, ConversationMessage } from '../types.js';

interface AgentStore {
  list: () => Promise<AgentInstance[]>;
  get: (id: string) => Promise<AgentInstance | null>;
}

interface ConversationStore {
  list: () => Promise<Conversation[]>;
  get: (id: string) => Promise<Conversation | null>;
  save: (conversation: Conversation) => Promise<void>;
}

interface MessageStore {
  listByConversation: (conversationId: string) => Promise<ConversationMessage[]>;
  append: (message: ConversationMessage) => Promise<void>;
}

interface ConversationRouteContext {
  agentStore: AgentStore;
  conversationStore: ConversationStore;
  messageStore: MessageStore;
  onMessageAccepted?: (conversation: Conversation, message: ConversationMessage) => void;
  eventBus?: {
    subscribe: (channelId: string, listener: (event: { type: string; payload: unknown }) => void) => () => void;
  };
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw) as T;
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function dedupe(values: string[]) {
  return [...new Set(values)];
}

async function canInviteByPlanet(
  actorType: 'player' | 'agent',
  actorId: string,
  agentStore: AgentStore,
) {
  if (actorType === 'player') {
    return true;
  }
  const actor = await agentStore.get(actorId);
  return Boolean(actor?.policy?.canInviteByPlanet);
}

export async function handleConversationRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  context: ConversationRouteContext,
) {
  const url = new URL(request.url ?? '/conversations', 'http://127.0.0.1');

  if (request.method === 'GET' && url.pathname === '/conversations') {
    writeJson(response, 200, await context.conversationStore.list());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/conversations') {
    const payload = await readJsonBody<{
      id?: string;
      workspaceId?: string;
      type: 'channel' | 'dm';
      name: string;
      topic?: string;
      createdByType: 'player' | 'agent';
      createdById: string;
      memberIds?: string[];
    }>(request);
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: payload.id ?? randomUUID(),
      workspaceId: payload.workspaceId ?? 'workspace-default',
      type: payload.type,
      name: payload.name,
      topic: payload.topic ?? '',
      memberIds: dedupe(payload.memberIds ?? []),
      createdByType: payload.createdByType,
      createdById: payload.createdById,
      createdAt: now,
      updatedAt: now,
    };
    await context.conversationStore.save(conversation);
    writeJson(response, 201, conversation);
    return;
  }

  if (request.method === 'GET' && url.pathname.match(/^\/conversations\/[^/]+\/messages$/)) {
    const conversationId = url.pathname.split('/')[2] ?? '';
    const conversation = await context.conversationStore.get(conversationId);
    if (!conversation) {
      writeJson(response, 404, { error: 'conversation_not_found' });
      return;
    }
    writeJson(response, 200, await context.messageStore.listByConversation(conversationId));
    return;
  }

  if (request.method === 'GET' && url.pathname.match(/^\/conversations\/[^/]+\/events$/)) {
    const conversationId = url.pathname.split('/')[2] ?? '';
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    response.write('\n');
    const unsubscribe = context.eventBus?.subscribe(`conversation:${conversationId}`, (event) => {
      response.write(`event: ${event.type}\n`);
      response.write(`data: ${JSON.stringify(event.payload)}\n\n`);
    }) ?? (() => {});
    request.on('close', unsubscribe);
    return;
  }

  if (request.method === 'POST' && url.pathname.match(/^\/conversations\/[^/]+\/messages$/)) {
    const conversationId = url.pathname.split('/')[2] ?? '';
    const conversation = await context.conversationStore.get(conversationId);
    if (!conversation) {
      writeJson(response, 404, { error: 'conversation_not_found' });
      return;
    }

    const payload = await readJsonBody<{
      senderType: 'player' | 'agent' | 'system' | 'schedule';
      senderId: string;
      content: string;
    }>(request);
    const agents = await context.agentStore.list();
    const memberAgents = agents.filter((agent) => conversation.memberIds.includes(`agent:${agent.id}`));
    const message: ConversationMessage = {
      id: randomUUID(),
      conversationId,
      senderType: payload.senderType,
      senderId: payload.senderId,
      kind: payload.senderType === 'schedule' ? 'schedule' : payload.senderType === 'system' ? 'system' : 'chat',
      content: payload.content,
      mentions: resolveMentionTargetsFromContent(payload.content, memberAgents),
      trigger:
        payload.senderType === 'player'
          ? 'player_message'
          : payload.senderType === 'agent'
            ? 'agent_message'
            : payload.senderType === 'schedule'
              ? 'schedule_message'
              : 'system_message',
      createdAt: new Date().toISOString(),
    };
    await context.messageStore.append(message);
    context.onMessageAccepted?.(conversation, message);
    writeJson(response, 202, { accepted: true, message });
    return;
  }

  if (request.method === 'POST' && url.pathname.match(/^\/conversations\/[^/]+\/members\/invite-by-planet$/)) {
    const conversationId = url.pathname.split('/')[2] ?? '';
    const conversation = await context.conversationStore.get(conversationId);
    if (!conversation) {
      writeJson(response, 404, { error: 'conversation_not_found' });
      return;
    }

    const payload = await readJsonBody<{
      actorType: 'player' | 'agent';
      actorId: string;
      planetId: string;
    }>(request);

    if (!await canInviteByPlanet(payload.actorType, payload.actorId, context.agentStore)) {
      writeJson(response, 403, { error: 'invite_by_planet_not_allowed' });
      return;
    }

    const agents = await context.agentStore.list();
    const matchingMemberIds = agents
      .filter((agent) => agent.policy?.planetIds.includes(payload.planetId))
      .map((agent) => `agent:${agent.id}`);
    conversation.memberIds = dedupe([...conversation.memberIds, ...matchingMemberIds]);
    conversation.updatedAt = new Date().toISOString();
    await context.conversationStore.save(conversation);
    writeJson(response, 200, {
      conversationId,
      memberIds: conversation.memberIds,
      added: matchingMemberIds,
    });
    return;
  }

  writeJson(response, 404, { error: 'conversation_route_not_found', path: url.pathname });
}
