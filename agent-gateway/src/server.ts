import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';

import { getAgentAllowedCommands, runCommandLine } from '../../client-cli/src/runtime.js';
import { exportBundle } from './export/bundle.js';
import { handleAgentRoutes } from './routes/agents.js';
import { handleConversationRoutes } from './routes/conversations.js';
import { handleScheduleRoutes } from './routes/schedules.js';
import { handleTemplateRoutes } from './routes/templates.js';
import { createEventBus } from './runtime/events.js';
import { runAgentLoop } from './runtime/loop.js';
import { createMailboxController, resolveMentionTargetsFromContent } from './runtime/router.js';
import { runDueSchedules } from './runtime/scheduler.js';
import { runTemplateTurn, type AgentTurnRunner } from './runtime/turn.js';
import { createAgentStore } from './store/agent-store.js';
import { createConversationStore } from './store/conversation-store.js';
import { createMessageStore } from './store/message-store.js';
import { createScheduleStore } from './store/schedule-store.js';
import { createSecretStore } from './store/secret-store.js';
import { createTemplateStore } from './store/template-store.js';
import { createThreadStore } from './store/thread-store.js';
import type { Conversation, ConversationMessage, GatewayCapabilities, ScheduleJob } from './types.js';

export interface GatewayServerHandle {
  url: string;
  close: () => Promise<void>;
}

export interface GatewayServerOptions {
  dataRoot: string;
  port: number;
  agentTurnRunner?: AgentTurnRunner;
  schedulerIntervalMs?: number;
}

function buildCapabilities(): GatewayCapabilities {
  return {
    status: 'ok',
    providers: {
      openai_compatible_http: { available: true },
      codex_cli: { available: false, reason: 'not_probed' },
      claude_code_cli: { available: false, reason: 'not_probed' },
    },
  };
}

export async function createGatewayServer(options: GatewayServerOptions): Promise<GatewayServerHandle> {
  const templateStore = createTemplateStore(path.join(options.dataRoot, 'templates'));
  const agentStore = createAgentStore(path.join(options.dataRoot, 'agents'));
  const threadStore = createThreadStore(path.join(options.dataRoot, 'threads'));
  const conversationStore = createConversationStore(path.join(options.dataRoot, 'conversations'));
  const messageStore = createMessageStore(path.join(options.dataRoot, 'messages'));
  const scheduleStore = createScheduleStore(path.join(options.dataRoot, 'schedules'));
  const secretStore = createSecretStore(path.join(options.dataRoot, 'secrets'));
  const eventBus = createEventBus();
  const agentTurnRunner = options.agentTurnRunner ?? runTemplateTurn;

  function emitConversationEvent(conversationId: string, type: string, payload: unknown) {
    eventBus.emit({
      agentId: `conversation:${conversationId}`,
      type,
      payload,
    });
  }

  function buildHistoryForAgent(agentId: string, messages: ConversationMessage[]) {
    return messages.map((message) => ({
      role: message.senderType === 'agent' && message.senderId === agentId ? 'assistant' : 'user',
      content:
        message.senderType === 'agent'
          ? `${message.senderId}: ${message.content}`
          : message.content,
    }));
  }

  const mailboxController = createMailboxController({
    runAgent: async ({ agentId, conversation }) => {
      const agent = await agentStore.get(agentId);
      if (!agent) {
        return;
      }

      const template = await templateStore.get(agent.templateId);
      if (!template) {
        agent.status = 'error';
        agent.updatedAt = new Date().toISOString();
        await agentStore.save(agent);
        eventBus.emit({ agentId: agent.id, type: 'error', payload: { message: 'template_not_found' } });
        return;
      }

      const history = buildHistoryForAgent(
        agent.id,
        await messageStore.listByConversation(conversation.id),
      );

      agent.status = 'running';
      agent.updatedAt = new Date().toISOString();
      await agentStore.save(agent);
      eventBus.emit({ agentId: agent.id, type: 'status', payload: { status: 'running' } });

      try {
        const playerKey = await secretStore.readValue(agent.playerKeySecretId);
        await runAgentLoop({
          maxSteps: template.toolPolicy.maxSteps,
          provider: {
            runTurn: (input) => agentTurnRunner({
              dataRoot: options.dataRoot,
              template,
              secretStore,
              history: input.history,
              allowedCommands: getAgentAllowedCommands({
                allowedCategories: agent.policy?.commandCategories,
              }),
              contextSections: [
                `当前会话：${conversation.name}`,
                `当前智能体：${agent.name}`,
                '请在 assistantMessage 中直接给出你在当前会话里的回复。',
              ],
            }),
          },
          cliRuntime: {
            run: async (commandLine) => runCommandLine(commandLine, {
              currentPlayer: agent.playerId,
              serverUrl: agent.serverUrl,
              playerKey,
            }, {
              allowedCategories: agent.policy?.commandCategories,
              allowedPlanetIds: agent.policy?.planetIds,
            }),
          },
          initialContext: { goal: history.at(-1)?.content ?? '' },
          initialHistory: history,
          onAssistantMessage: async (assistantMessage) => {
            const memberAgents = (await agentStore.list()).filter((entry) => conversation.memberIds.includes(`agent:${entry.id}`));
            const responseMessage: ConversationMessage = {
              id: randomUUID(),
              conversationId: conversation.id,
              senderType: 'agent',
              senderId: agent.id,
              kind: 'chat',
              content: assistantMessage,
              mentions: resolveMentionTargetsFromContent(assistantMessage, memberAgents),
              trigger: 'agent_message',
              createdAt: new Date().toISOString(),
            };
            await messageStore.append(responseMessage);
            emitConversationEvent(conversation.id, 'message', responseMessage);
            void mailboxController.accept(conversation, responseMessage);
          },
        });

        agent.status = 'idle';
        agent.updatedAt = new Date().toISOString();
        await agentStore.save(agent);
        eventBus.emit({ agentId: agent.id, type: 'status', payload: { status: 'idle' } });
      } catch (error) {
        agent.status = 'error';
        agent.updatedAt = new Date().toISOString();
        await agentStore.save(agent);
        eventBus.emit({
          agentId: agent.id,
          type: 'error',
          payload: { message: error instanceof Error ? error.message : String(error) },
        });
      }
    },
  });

  async function handleAcceptedConversationMessage(conversation: Conversation, message: ConversationMessage) {
    emitConversationEvent(conversation.id, 'message', message);
    void mailboxController.accept(conversation, message);
  }

  async function ensureScheduleConversation(job: ScheduleJob) {
    if (job.targetType === 'conversation') {
      return conversationStore.get(job.targetId);
    }

    const actorMemberId = job.creatorType === 'player' ? `player:${job.creatorId}` : `agent:${job.creatorId}`;
    const targetMemberId = `agent:${job.targetId}`;
    const conversations = await conversationStore.list();
    const existing = conversations.find((conversation) => (
      conversation.type === 'dm'
      && conversation.memberIds.length === 2
      && conversation.memberIds.includes(actorMemberId)
      && conversation.memberIds.includes(targetMemberId)
    ));
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const created: Conversation = {
      id: randomUUID(),
      workspaceId: job.workspaceId,
      type: 'dm',
      name: `定时私聊 ${job.name}`,
      topic: '',
      memberIds: [actorMemberId, targetMemberId],
      createdByType: job.creatorType,
      createdById: job.creatorId,
      createdAt: now,
      updatedAt: now,
    };
    await conversationStore.save(created);
    return created;
  }

  const schedulerTimer = setInterval(() => {
    void (async () => {
      await runDueSchedules({
        now: new Date().toISOString(),
        schedules: await scheduleStore.list(),
        async onDispatch(schedule) {
          const conversation = await ensureScheduleConversation(schedule);
          if (!conversation) {
            return;
          }
          const memberAgents = (await agentStore.list()).filter((entry) => conversation.memberIds.includes(`agent:${entry.id}`));
          const message: ConversationMessage = {
            id: randomUUID(),
            conversationId: conversation.id,
            senderType: 'schedule',
            senderId: schedule.id,
            kind: 'schedule',
            content: schedule.messageTemplate,
            mentions: resolveMentionTargetsFromContent(schedule.messageTemplate, memberAgents),
            trigger: 'schedule_message',
            createdAt: new Date().toISOString(),
          };
          await messageStore.append(message);
          emitConversationEvent(conversation.id, 'message', message);
          void mailboxController.accept(conversation, message);
        },
        onSave: (schedule) => scheduleStore.save(schedule),
      });
    })().catch((error) => {
      console.error('schedule dispatch failed', error);
    });
  }, options.schedulerIntervalMs ?? 1000);

  async function readJsonBody<T>(request: import('node:http').IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    return JSON.parse(raw) as T;
  }

  const server = createServer(async (request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (request.url === '/capabilities') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(buildCapabilities()));
      return;
    }

    if (request.url?.startsWith('/templates')) {
      await handleTemplateRoutes(request, response, {
        templateStore,
        secretStore,
      });
      return;
    }

    if (request.url?.startsWith('/agents')) {
      await handleAgentRoutes(request, response, {
        dataRoot: options.dataRoot,
        agentStore,
        templateStore,
        threadStore,
        secretStore,
        eventBus,
      });
      return;
    }

    if (request.url?.startsWith('/conversations')) {
      await handleConversationRoutes(request, response, {
        agentStore,
        conversationStore,
        messageStore,
        onMessageAccepted: handleAcceptedConversationMessage,
        eventBus,
      });
      return;
    }

    if (request.url?.startsWith('/schedules')) {
      await handleScheduleRoutes(request, response, {
        agentStore,
        scheduleStore,
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/export') {
      const payload = await readJsonBody<{ includeSecrets?: boolean }>(request);
      const templates = await templateStore.list();
      const agents = await agentStore.list();
      const threads = await threadStore.list();
      const conversations = await conversationStore.list();
      const messages = await messageStore.list();
      const schedules = await scheduleStore.list();

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        ...exportBundle({
          templates,
          includeSecrets: Boolean(payload.includeSecrets),
          encryptedSecrets: [],
        }),
        agents,
        threads,
        conversations,
        messages,
        schedules,
      }));
      return;
    }

    if (request.method === 'POST' && request.url === '/import') {
      const payload = await readJsonBody<{
        templates?: Array<Awaited<ReturnType<typeof templateStore.list>>[number]>;
        agents?: Array<Awaited<ReturnType<typeof agentStore.list>>[number]>;
        threads?: Array<Awaited<ReturnType<typeof threadStore.list>>[number]>;
        conversations?: Array<Awaited<ReturnType<typeof conversationStore.list>>[number]>;
        messages?: Array<Awaited<ReturnType<typeof messageStore.list>>[number]>;
        schedules?: Array<Awaited<ReturnType<typeof scheduleStore.list>>[number]>;
      }>(request);

      await Promise.all((payload.templates ?? []).map((template) => templateStore.save(template)));
      await Promise.all((payload.agents ?? []).map((agent) => agentStore.save(agent)));
      await Promise.all((payload.threads ?? []).map((thread) => threadStore.save(thread)));
      await Promise.all((payload.conversations ?? []).map((conversation) => conversationStore.save(conversation)));
      await Promise.all((payload.messages ?? []).map((message) => messageStore.append(message)));
      await Promise.all((payload.schedules ?? []).map((schedule) => scheduleStore.save(schedule)));

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        imported: {
          templates: payload.templates?.length ?? 0,
          agents: payload.agents?.length ?? 0,
          threads: payload.threads?.length ?? 0,
          conversations: payload.conversations?.length ?? 0,
          messages: payload.messages?.length ?? 0,
          schedules: payload.schedules?.length ?? 0,
        },
      }));
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found', data_root: options.dataRoot }));
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('gateway server failed to bind');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      clearInterval(schedulerTimer);
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}
