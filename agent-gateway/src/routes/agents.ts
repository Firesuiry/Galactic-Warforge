import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { getAgentAllowedCommands, runCommandLine } from '../../../client-cli/src/runtime.js';
import { runAgentLoop } from '../runtime/loop.js';
import type { GatewayEvent } from '../runtime/events.js';
import { classifyPublicTurnError } from '../runtime/provider-error.js';
import { runProviderTurn, type AgentTurnRunner } from '../runtime/turn.js';
import { countsAsExecutedAction } from '../runtime/turn-validator.js';
import type { AgentInstance, AgentPolicy, AgentThread, ModelProvider } from '../types.js';

interface AgentStore {
  list: () => Promise<AgentInstance[]>;
  get: (id: string) => Promise<AgentInstance | null>;
  save: (agent: AgentInstance) => Promise<void>;
}

interface ProviderStore {
  get: (id: string) => Promise<ModelProvider | null>;
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
  providerStore: ProviderStore;
  threadStore: ThreadStore;
  secretStore: SecretStore;
  eventBus: EventBus;
  createManagedAgent?: (actor: AgentInstance, action: Record<string, unknown>) => Promise<string>;
  updateManagedAgent?: (actor: AgentInstance, action: Record<string, unknown>) => Promise<string>;
  ensureDirectConversation?: (actor: AgentInstance, targetAgentId: string) => Promise<string>;
  sendConversationMessage?: (actor: AgentInstance, action: Record<string, unknown>) => Promise<string>;
  turnRunner?: AgentTurnRunner;
}

function createDefaultPolicy(): AgentPolicy {
  return {
    planetIds: [],
    commandCategories: [],
    canCreateAgents: false,
    canCreateChannel: false,
    canManageMembers: false,
    canInviteByPlanet: false,
    canCreateSchedules: false,
    canDirectMessageAgentIds: [],
    canDispatchAgentIds: [],
  };
}

function normalizePolicy(policy?: Partial<AgentPolicy>, base?: AgentPolicy): AgentPolicy {
  const fallback = base ?? createDefaultPolicy();
  return {
    ...fallback,
    ...policy,
    planetIds: policy?.planetIds ?? fallback.planetIds,
    commandCategories: policy?.commandCategories ?? fallback.commandCategories,
    canCreateAgents: policy?.canCreateAgents ?? fallback.canCreateAgents,
    canDirectMessageAgentIds: policy?.canDirectMessageAgentIds ?? fallback.canDirectMessageAgentIds,
    canDispatchAgentIds: policy?.canDispatchAgentIds ?? fallback.canDispatchAgentIds,
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

async function updateThread(
  threadStore: ThreadStore,
  threadId: string,
  updater: (thread: AgentThread, now: string) => void,
) {
  const thread = await threadStore.get(threadId);
  if (!thread) {
    throw new Error(`thread not found: ${threadId}`);
  }
  const now = new Date().toISOString();
  updater(thread, now);
  thread.updatedAt = now;
  await threadStore.save(thread);
}

async function appendThreadToolResult(
  threadStore: ThreadStore,
  threadId: string,
  type: string,
  payload: Record<string, unknown>,
  output: string,
) {
  await updateThread(threadStore, threadId, (thread, now) => {
    thread.messages.push({ role: 'tool', content: output, createdAt: now });
    thread.toolCalls.push({ type, payload });
    thread.executionLogs.push({
      level: 'info',
      message: `${type} ${output}`,
      createdAt: now,
    });
  });
}

async function buildManagedAgentContext(
  agentStore: AgentStore,
  agent: AgentInstance,
) {
  const relatedIds = [
    ...(agent.managedAgentIds ?? []),
    ...(agent.policy?.canDispatchAgentIds ?? []),
    ...(agent.policy?.canDirectMessageAgentIds ?? []),
  ];
  const uniqueIds = [...new Set(relatedIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return [];
  }

  const managedAgents = (await Promise.all(uniqueIds.map((id) => agentStore.get(id))))
    .filter((candidate): candidate is AgentInstance => Boolean(candidate));
  if (managedAgents.length === 0) {
    return [];
  }

  return [
    `当前可调度成员：${managedAgents.map((managedAgent) => (
      `${managedAgent.name}(${managedAgent.id}) role=${managedAgent.role ?? 'worker'} `
      + `categories=${managedAgent.policy?.commandCategories?.join(',') || '*'} `
      + `planets=${managedAgent.policy?.planetIds?.join(',') || '*'}`
    )).join('；')}`,
  ];
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
      providerId: string;
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
      providerId: payload.providerId,
      serverUrl: payload.serverUrl,
      playerId: payload.playerId,
      playerKeySecretId,
      status: 'idle',
      goal: payload.goal ?? '',
      activeThreadId: threadId,
      role: payload.role ?? 'worker',
      policy: normalizePolicy(payload.policy),
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

  if (request.method === 'PATCH' && url.pathname.match(/^\/agents\/[^/]+$/)) {
    const id = url.pathname.split('/')[2] ?? '';
    const agent = await context.agentStore.get(id);
    if (!agent) {
      writeJson(response, 404, { error: 'agent_not_found' });
      return;
    }

    const payload = await readJsonBody<{
      name?: string;
      providerId?: string;
      serverUrl?: string;
      playerId?: string;
      playerKey?: string;
      goal?: string;
      role?: 'worker' | 'manager' | 'director';
      policy?: Partial<AgentPolicy>;
      supervisorAgentIds?: string[];
      managedAgentIds?: string[];
      activeConversationIds?: string[];
    }>(request);

    if (typeof payload.playerKey === 'string' && payload.playerKey.trim() !== '') {
      await context.secretStore.save(agent.playerKeySecretId, payload.playerKey);
    }

    const updated: AgentInstance = {
      ...agent,
      name: payload.name ?? agent.name,
      providerId: payload.providerId ?? agent.providerId,
      serverUrl: payload.serverUrl ?? agent.serverUrl,
      playerId: payload.playerId ?? agent.playerId,
      goal: payload.goal ?? agent.goal,
      role: payload.role ?? agent.role,
      policy: payload.policy ? normalizePolicy(payload.policy, agent.policy) : agent.policy,
      supervisorAgentIds: payload.supervisorAgentIds ?? agent.supervisorAgentIds ?? [],
      managedAgentIds: payload.managedAgentIds ?? agent.managedAgentIds ?? [],
      activeConversationIds: payload.activeConversationIds ?? agent.activeConversationIds ?? [],
      updatedAt: new Date().toISOString(),
    };
    await context.agentStore.save(updated);
    writeJson(response, 200, updated);
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

    const provider = await context.providerStore.get(agent.providerId);
    if (!provider) {
      writeJson(response, 404, { error: 'provider_not_found' });
      return;
    }

    const payload = await readJsonBody<{ content: string }>(request);
    const thread = await context.threadStore.get(agent.activeThreadId);
    if (!thread) {
      writeJson(response, 404, { error: 'thread_not_found' });
      return;
    }

    await appendThreadMessage(context.threadStore, thread.id, 'user', payload.content);
    await updateThread(context.threadStore, thread.id, (currentThread) => {
      currentThread.lastTurn = {
        status: 'running',
        executedActionCount: 0,
        repairCount: 0,
      };
    });
    agent.status = 'running';
    agent.goal = payload.content;
    agent.updatedAt = new Date().toISOString();
    await context.agentStore.save(agent);
    context.eventBus.emit({ agentId: agent.id, type: 'status', payload: { status: 'running' } });

    void (async () => {
      let executedActionCount = 0;
      let repairCount = 0;

      try {
        const playerKey = await context.secretStore.readValue(agent.playerKeySecretId);
        const latestThread = await context.threadStore.get(thread.id);
        const history = latestThread?.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })) ?? [{ role: 'user', content: payload.content }];
        const managedAgentContext = await buildManagedAgentContext(context.agentStore, agent);

        const result = await runAgentLoop({
          maxSteps: provider.toolPolicy.maxSteps,
          provider: {
            runTurn: (input) => (context.turnRunner ?? runProviderTurn)({
              dataRoot: context.dataRoot,
              provider,
              secretStore: context.secretStore,
              history: input.history,
              allowedCommands: getAgentAllowedCommands({
                allowedCategories: agent.policy?.commandCategories,
              }),
              contextSections: [
                `当前智能体：${agent.name}`,
                '可用 action: game.command / agent.create / agent.update / conversation.ensure_dm / conversation.send_message / final_answer。',
                '如果你已经创建过成员，后续轮次必须优先复用 thread 历史中的 tool 结果和成员 id，不要假装不知道已创建的成员。',
                ...managedAgentContext,
              ],
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
                  type: 'game.command',
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
          gatewayRuntime: {
            createAgent: async (action) => {
              if (!context.createManagedAgent) {
                throw new Error('agent.create is not supported in this route');
              }
              const output = await context.createManagedAgent(agent, action);
              await appendThreadToolResult(context.threadStore, thread.id, 'agent.create', {
                ...action,
                output,
              }, output);
              return output;
            },
            updateAgent: async (action) => {
              if (!context.updateManagedAgent) {
                throw new Error('agent.update is not supported in this route');
              }
              const output = await context.updateManagedAgent(agent, action);
              await appendThreadToolResult(context.threadStore, thread.id, 'agent.update', {
                ...action,
                output,
              }, output);
              return output;
            },
            ensureDirectConversation: async (action) => {
              if (!context.ensureDirectConversation) {
                throw new Error('conversation.ensure_dm is not supported in this route');
              }
              const output = await context.ensureDirectConversation(agent, String(action.targetAgentId ?? ''));
              await appendThreadToolResult(context.threadStore, thread.id, 'conversation.ensure_dm', {
                ...action,
                output,
              }, output);
              return output;
            },
            sendConversationMessage: async (action) => {
              if (!context.sendConversationMessage) {
                throw new Error('conversation.send_message is not supported in this route');
              }
              const output = await context.sendConversationMessage(agent, action);
              await appendThreadToolResult(context.threadStore, thread.id, 'conversation.send_message', {
                ...action,
                output,
              }, output);
              return output;
            },
          },
          initialContext: { goal: payload.content },
          initialHistory: history,
          onAssistantMessage: async (message) => {
            await appendThreadMessage(context.threadStore, thread.id, 'assistant', message);
            context.eventBus.emit({ agentId: agent.id, type: 'assistant_message', payload: { message } });
          },
          onTurnPrepared: async ({ repairCount: nextRepairCount }) => {
            repairCount = nextRepairCount;
          },
          onActionUpdate: async (update) => {
            if (update.status === 'succeeded' && countsAsExecutedAction(update.action)) {
              executedActionCount += 1;
            }
          },
          onToolCall: async (commandLine, output) => {
            await appendThreadMessage(context.threadStore, thread.id, 'tool', output);
            context.eventBus.emit({ agentId: agent.id, type: 'tool_result', payload: { commandLine, output } });
          },
        });

        agent.status = 'completed';
        agent.updatedAt = new Date().toISOString();
        await context.agentStore.save(agent);
        await updateThread(context.threadStore, thread.id, (currentThread) => {
          currentThread.lastTurn = {
            status: 'completed',
            outcomeKind: result.outcomeKind,
            executedActionCount: result.executedActionCount,
            repairCount: result.repairCount,
            finalMessage: result.finalMessage,
          };
        });
        context.eventBus.emit({
          agentId: agent.id,
          type: 'completed',
          payload: { finalMessage: result.finalMessage },
        });
      } catch (error) {
        const publicError = classifyPublicTurnError(error);
        agent.status = 'error';
        agent.updatedAt = new Date().toISOString();
        await context.agentStore.save(agent);
        await updateThread(context.threadStore, thread.id, (currentThread, now) => {
          currentThread.executionLogs.push({
            level: 'error',
            message: `${publicError.code}: ${publicError.message}`,
            createdAt: now,
          });
          currentThread.lastTurn = {
            status: 'failed',
            outcomeKind: 'blocked',
            executedActionCount,
            repairCount,
            errorCode: publicError.code,
            errorMessage: publicError.message,
            rawErrorMessage: publicError.rawMessage,
          };
        });
        context.eventBus.emit({
          agentId: agent.id,
          type: 'error',
          payload: {
            code: publicError.code,
            message: publicError.message,
            rawErrorMessage: publicError.rawMessage,
          },
        });
      }
    })();

    writeJson(response, 202, { accepted: true });
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'agent_route_not_found', path: url.pathname }));
}
