import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { getAgentAllowedCommands, runCommandLine } from '../../../client-cli/src/runtime.js';
import { runAgentLoop } from '../runtime/loop.js';
import type { GatewayEvent } from '../runtime/events.js';
import { runTemplateTurn } from '../runtime/turn.js';
import type { AgentInstance, AgentPolicy, AgentTemplate, AgentThread, CliProviderConfig, OpenAICompatibleProviderConfig } from '../types.js';

interface AgentStore {
  list: () => Promise<AgentInstance[]>;
  get: (id: string) => Promise<AgentInstance | null>;
  save: (agent: AgentInstance) => Promise<void>;
}

interface TemplateStore {
  get: (id: string) => Promise<AgentTemplate | null>;
}

interface ThreadStore {
  list: () => Promise<AgentThread[]>;
  get: (id: string) => Promise<AgentThread | null>;
  save: (thread: AgentThread) => Promise<void>;
}

interface SecretStore {
  save: (id: string, value: string) => Promise<void>;
  readValue: (id: string) => Promise<string>;
}

interface EventBus {
  emit: (event: GatewayEvent) => void;
  subscribe: (agentId: string, listener: (event: GatewayEvent) => void) => () => void;
}

interface AgentRouteContext {
  dataRoot: string;
  agentStore: AgentStore;
  templateStore: TemplateStore;
  threadStore: ThreadStore;
  secretStore: SecretStore;
  eventBus: EventBus;
}

function createDefaultPolicy(): AgentPolicy {
  return {
    planetIds: [],
    commandCategories: [],
    canCreateChannel: false,
    canManageMembers: false,
    canInviteByPlanet: false,
    canCreateSchedules: false,
    canDirectMessageAgentIds: [],
    canDispatchAgentIds: [],
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

async function appendThreadMessage(
  threadStore: ThreadStore,
  threadId: string,
  role: 'user' | 'assistant' | 'tool',
  content: string,
) {
  const thread = await threadStore.get(threadId);
  if (!thread) {
    throw new Error(`thread not found: ${threadId}`);
  }
  const now = new Date().toISOString();
  thread.messages.push({ role, content, createdAt: now });
  thread.updatedAt = now;
  await threadStore.save(thread);
}

export async function handleAgentRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  context: AgentRouteContext,
) {
  const url = new URL(request.url ?? '/agents', 'http://127.0.0.1');

  if (request.method === 'GET' && url.pathname === '/agents') {
    writeJson(response, 200, await context.agentStore.list());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/agents') {
    const payload = await readJsonBody<{
      id?: string;
      name: string;
      templateId: string;
      serverUrl: string;
      playerId: string;
      playerKey: string;
      goal?: string;
      role?: 'worker' | 'manager' | 'director';
      policy?: Partial<AgentPolicy>;
      supervisorAgentIds?: string[];
      managedAgentIds?: string[];
      activeConversationIds?: string[];
    }>(request);
    const now = new Date().toISOString();
    const id = payload.id || randomUUID();
    const threadId = `thread-${id}`;
    const playerKeySecretId = `agent-${id}-player-key`;

    await context.secretStore.save(playerKeySecretId, payload.playerKey);

    const agent: AgentInstance = {
      id,
      name: payload.name,
      templateId: payload.templateId,
      serverUrl: payload.serverUrl,
      playerId: payload.playerId,
      playerKeySecretId,
      status: 'idle',
      goal: payload.goal ?? '',
      activeThreadId: threadId,
      role: payload.role ?? 'worker',
      policy: {
        ...createDefaultPolicy(),
        ...payload.policy,
        planetIds: payload.policy?.planetIds ?? [],
        commandCategories: payload.policy?.commandCategories ?? [],
        canDirectMessageAgentIds: payload.policy?.canDirectMessageAgentIds ?? [],
        canDispatchAgentIds: payload.policy?.canDispatchAgentIds ?? [],
      },
      supervisorAgentIds: payload.supervisorAgentIds ?? [],
      managedAgentIds: payload.managedAgentIds ?? [],
      activeConversationIds: payload.activeConversationIds ?? [],
      createdAt: now,
      updatedAt: now,
    };
    const thread: AgentThread = {
      id: threadId,
      agentId: id,
      title: payload.name,
      messages: [],
      toolCalls: [],
      executionLogs: [],
      createdAt: now,
      updatedAt: now,
    };

    await context.agentStore.save(agent);
    await context.threadStore.save(thread);
    writeJson(response, 201, agent);
    return;
  }

  if (request.method === 'GET' && url.pathname.match(/^\/agents\/[^/]+$/)) {
    const id = url.pathname.split('/')[2] ?? '';
    const agent = await context.agentStore.get(id);
    if (!agent) {
      writeJson(response, 404, { error: 'agent_not_found' });
      return;
    }
    writeJson(response, 200, agent);
    return;
  }

  if (request.method === 'GET' && url.pathname.match(/^\/agents\/[^/]+\/thread$/)) {
    const id = url.pathname.split('/')[2] ?? '';
    const agent = await context.agentStore.get(id);
    if (!agent) {
      writeJson(response, 404, { error: 'agent_not_found' });
      return;
    }
    const thread = await context.threadStore.get(agent.activeThreadId);
    writeJson(response, 200, thread);
    return;
  }

  if (request.method === 'GET' && url.pathname.match(/^\/agents\/[^/]+\/events$/)) {
    const id = url.pathname.split('/')[2] ?? '';
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    response.write('\n');
    const unsubscribe = context.eventBus.subscribe(id, (event) => {
      response.write(`event: ${event.type}\n`);
      response.write(`data: ${JSON.stringify(event.payload)}\n\n`);
    });
    request.on('close', unsubscribe);
    return;
  }

  if (request.method === 'POST' && url.pathname.match(/^\/agents\/[^/]+\/messages$/)) {
    const id = url.pathname.split('/')[2] ?? '';
    const agent = await context.agentStore.get(id);
    if (!agent) {
      writeJson(response, 404, { error: 'agent_not_found' });
      return;
    }

    if (agent.status === 'running') {
      writeJson(response, 409, { error: 'agent_already_running' });
      return;
    }

    const template = await context.templateStore.get(agent.templateId);
    if (!template) {
      writeJson(response, 404, { error: 'template_not_found' });
      return;
    }

    const payload = await readJsonBody<{ content: string }>(request);
    const thread = await context.threadStore.get(agent.activeThreadId);
    if (!thread) {
      writeJson(response, 404, { error: 'thread_not_found' });
      return;
    }

    await appendThreadMessage(context.threadStore, thread.id, 'user', payload.content);
    agent.status = 'running';
    agent.goal = payload.content;
    agent.updatedAt = new Date().toISOString();
    await context.agentStore.save(agent);
    context.eventBus.emit({ agentId: agent.id, type: 'status', payload: { status: 'running' } });

    void (async () => {
      try {
        const playerKey = await context.secretStore.readValue(agent.playerKeySecretId);
        const latestThread = await context.threadStore.get(thread.id);
        const history = latestThread?.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })) ?? [{ role: 'user', content: payload.content }];

        const result = await runAgentLoop({
          maxSteps: template.toolPolicy.maxSteps,
          provider: {
            runTurn: (input) => runTemplateTurn({
              dataRoot: context.dataRoot,
              template,
              secretStore: context.secretStore,
              history: input.history,
              allowedCommands: getAgentAllowedCommands({
                allowedCategories: agent.policy?.commandCategories,
              }),
            }),
          },
          cliRuntime: {
            run: async (commandLine) => {
              const output = await runCommandLine(commandLine, {
                currentPlayer: agent.playerId,
                serverUrl: agent.serverUrl,
                playerKey,
              }, {
                allowedCategories: agent.policy?.commandCategories,
                allowedPlanetIds: agent.policy?.planetIds,
              });
              const currentThread = await context.threadStore.get(thread.id);
              if (currentThread) {
                currentThread.toolCalls.push({
                  type: 'game.cli',
                  payload: { commandLine, output },
                });
                currentThread.executionLogs.push({
                  level: 'info',
                  message: commandLine,
                  createdAt: new Date().toISOString(),
                });
                currentThread.updatedAt = new Date().toISOString();
                await context.threadStore.save(currentThread);
              }
              return output;
            },
          },
          initialContext: { goal: payload.content },
          initialHistory: history,
          onAssistantMessage: async (message) => {
            await appendThreadMessage(context.threadStore, thread.id, 'assistant', message);
            context.eventBus.emit({ agentId: agent.id, type: 'assistant_message', payload: { message } });
          },
          onToolCall: async (commandLine, output) => {
            await appendThreadMessage(context.threadStore, thread.id, 'tool', output);
            context.eventBus.emit({ agentId: agent.id, type: 'tool_result', payload: { commandLine, output } });
          },
        });

        agent.status = 'completed';
        agent.updatedAt = new Date().toISOString();
        await context.agentStore.save(agent);
        context.eventBus.emit({
          agentId: agent.id,
          type: 'completed',
          payload: { finalMessage: result.finalMessage },
        });
      } catch (error) {
        agent.status = 'error';
        agent.updatedAt = new Date().toISOString();
        await context.agentStore.save(agent);
        context.eventBus.emit({
          agentId: agent.id,
          type: 'error',
          payload: { message: error instanceof Error ? error.message : String(error) },
        });
      }
    })();

    writeJson(response, 202, { accepted: true });
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'agent_route_not_found', path: url.pathname }));
}
