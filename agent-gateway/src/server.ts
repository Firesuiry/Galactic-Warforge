import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';

import { getAgentAllowedCommands, runCommandLine } from '../../client-cli/src/runtime.js';
import { ensureBuiltinMiniMaxProvider } from './bootstrap/minimax.js';
import { exportBundle } from './export/bundle.js';
import { handleAgentRoutes } from './routes/agents.js';
import { handleConversationRoutes } from './routes/conversations.js';
import { handleProviderRoutes } from './routes/providers.js';
import { handleScheduleRoutes } from './routes/schedules.js';
import type { CanonicalAgentAction } from './runtime/action-schema.js';
import { createEventBus } from './runtime/events.js';
import { summarizeGameCommandAction } from './runtime/game-command-executor.js';
import { runAgentLoop } from './runtime/loop.js';
import {
  createMailboxController,
  type MailboxEntry,
  resolveAutoWakeTargets,
  resolveMentionTargetsFromContent,
} from './runtime/router.js';
import { runDueSchedules } from './runtime/scheduler.js';
import { classifyPublicTurnError } from './runtime/provider-error.js';
import { runProviderTurn, type AgentTurnRunner } from './runtime/turn.js';
import { createAgentStore } from './store/agent-store.js';
import { createConversationStore } from './store/conversation-store.js';
import { createMessageStore } from './store/message-store.js';
import { createProviderStore } from './store/provider-store.js';
import { createScheduleStore } from './store/schedule-store.js';
import { createSecretStore } from './store/secret-store.js';
import { createThreadStore } from './store/thread-store.js';
import { createTurnStore } from './store/turn-store.js';
import type {
  AgentInstance,
  AgentPolicy,
  AgentThread,
  Conversation,
  ConversationMessage,
  ConversationTurn,
  ConversationTurnActionSummary,
  GatewayCapabilities,
  ScheduleJob,
} from './types.js';

export interface GatewayServerHandle {
  url: string;
  close: () => Promise<void>;
}

export interface GatewayServerOptions {
  dataRoot: string;
  port: number;
  agentTurnRunner?: AgentTurnRunner;
  schedulerIntervalMs?: number;
  bootstrapEnvFile?: string;
}

function buildCapabilities(): GatewayCapabilities {
  return {
    status: 'ok',
    providers: {
      http_api: { available: true },
      codex_cli: { available: false, reason: 'not_probed' },
      claude_code_cli: { available: false, reason: 'not_probed' },
    },
  };
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

function dedupe(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function roleRank(role?: AgentInstance['role']) {
  if (role === 'director') {
    return 3;
  }
  if (role === 'manager') {
    return 2;
  }
  return 1;
}

function isSubsetWithin(requested: string[] | undefined, allowed: string[] | undefined) {
  if (!requested || requested.length === 0) {
    return true;
  }
  if (!allowed || allowed.length === 0) {
    return true;
  }
  const allowedSet = new Set(allowed);
  return requested.every((value) => allowedSet.has(value));
}

function buildTurnErrorHint(code: string | undefined, rawMessage: string) {
  const normalized = rawMessage.toLowerCase();

  if (code === 'provider_schema_invalid') {
    if (normalized.includes('transfer_item requires buildingid')) {
      return '缺少目标建筑 ID，请明确研究站或装料建筑，例如 b-9。';
    }
    if (normalized.includes('transfer_item requires itemid')) {
      return '缺少装料物品 ID，请明确具体物品，例如 electromagnetic_matrix。';
    }
    if (normalized.includes('start_research requires techid')) {
      return '缺少科技 ID，请明确要启动的科技，例如 basic_logistics_system。';
    }
    if (normalized.includes('build requires buildingtype')) {
      return '缺少建筑类型，请明确 buildingType，例如 matrix_lab。';
    }
  }

  if (code === 'provider_incomplete_execution' && normalized.includes('最终结果')) {
    return '动作已经执行，但模型没有把最终结果交付出来；请重试，或要求它只回复一句话最终结论。';
  }

  if (code === 'loop_exhausted' || normalized.includes('maxsteps')) {
    return '智能体循环已耗尽最大步数，通常意味着它在重复观察或缺少关键参数；请缩小目标，或明确给出星球、建筑和科技 ID。';
  }

  return undefined;
}

export async function createGatewayServer(options: GatewayServerOptions): Promise<GatewayServerHandle> {
  const providerStore = createProviderStore(path.join(options.dataRoot, 'providers'));
  const agentStore = createAgentStore(path.join(options.dataRoot, 'agents'));
  const threadStore = createThreadStore(path.join(options.dataRoot, 'threads'));
  const conversationStore = createConversationStore(path.join(options.dataRoot, 'conversations'));
  const messageStore = createMessageStore(path.join(options.dataRoot, 'messages'));
  const turnStore = createTurnStore(path.join(options.dataRoot, 'turns'));
  const scheduleStore = createScheduleStore(path.join(options.dataRoot, 'schedules'));
  const secretStore = createSecretStore(path.join(options.dataRoot, 'secrets'));
  const eventBus = createEventBus();
  const agentTurnRunner = options.agentTurnRunner ?? runProviderTurn;

  if (options.bootstrapEnvFile) {
    await ensureBuiltinMiniMaxProvider({
      envFilePath: options.bootstrapEnvFile,
      providerStore,
      secretStore,
    });
  }

  function emitConversationEvent(conversationId: string, type: string, payload: unknown) {
    eventBus.emit({
      agentId: `conversation:${conversationId}`,
      type,
      payload,
    });
  }

  function emitTurnEvent(turn: ConversationTurn) {
    const eventType = turn.status === 'failed'
      ? 'turn.failed'
      : turn.status === 'succeeded'
        ? 'turn.completed'
        : 'turn.updated';
    emitConversationEvent(turn.conversationId, eventType, turn);
  }

  function summarizeAgentAction(action: CanonicalAgentAction) {
    switch (action.type) {
      case 'game.command':
        return summarizeGameCommandAction(action);
      case 'memory.note':
        return action.note;
      case 'final_answer':
        return action.message;
      case 'agent.create':
        return `创建智能体 ${action.name}`;
      case 'agent.update':
        return `更新智能体 ${action.agentId}`;
      case 'conversation.ensure_dm':
        return `确保与 ${action.targetAgentId} 的私聊`;
      case 'conversation.send_message':
        return action.content;
      default:
        return action satisfies never;
    }
  }

  async function saveTurn(turn: ConversationTurn) {
    await turnStore.save(turn);
    emitTurnEvent(turn);
    return turn;
  }

  async function updateTurn(
    turnId: string,
    updater: (turn: ConversationTurn) => ConversationTurn,
  ) {
    const turn = await turnStore.get(turnId);
    if (!turn) {
      throw new Error(`turn not found: ${turnId}`);
    }
    return saveTurn(updater(turn));
  }

  async function createTurnsForMessage(conversation: Conversation, message: ConversationMessage) {
    const targets = resolveAutoWakeTargets({ conversation, message });
    const turns: ConversationTurn[] = [];
    for (const targetAgentId of targets) {
      const now = new Date().toISOString();
      const turn: ConversationTurn = {
        id: randomUUID(),
        conversationId: conversation.id,
        requestMessageId: message.id,
        actorType:
          message.senderType === 'schedule'
            ? 'schedule'
            : message.senderType === 'agent'
              ? 'agent'
              : 'player',
        actorId: message.senderId,
        targetAgentId,
        status: 'accepted',
        actionSummaries: [],
        createdAt: now,
        updatedAt: now,
      };
      turns.push(await saveTurn(turn));
    }
    return turns;
  }

  async function queueTurnsForMessage(
    conversation: Conversation,
    message: ConversationMessage,
  ) {
    const turns = await createTurnsForMessage(conversation, message);
    if (turns.length === 0) {
      return [];
    }

    const queuedTurns: ConversationTurn[] = [];
    const mailboxEntries: MailboxEntry[] = [];
    for (const turn of turns) {
      const queuedTurn = await updateTurn(turn.id, (current) => ({
        ...current,
        status: 'queued',
        updatedAt: new Date().toISOString(),
      }));
      queuedTurns.push(queuedTurn);
      mailboxEntries.push({
        agentId: queuedTurn.targetAgentId,
        turnId: queuedTurn.id,
        conversation,
        message,
      });
    }
    void mailboxController.accept(mailboxEntries);
    return queuedTurns;
  }

  async function acceptConversationMessage(
    conversation: Conversation,
    message: ConversationMessage,
  ) {
    emitConversationEvent(conversation.id, 'message', message);
    return queueTurnsForMessage(conversation, message);
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

  async function appendAgentConversationMessage(
    conversation: Conversation,
    agent: AgentInstance,
    content: string,
    trigger: ConversationMessage['trigger'] = 'agent_message',
    options: {
      replyToMessageId?: string;
      turnId?: string;
      dispatchToMailbox?: boolean;
    } = {},
  ) {
    const memberAgents = (await agentStore.list()).filter((entry) => conversation.memberIds.includes(`agent:${entry.id}`));
    const responseMessage: ConversationMessage = {
      id: randomUUID(),
      conversationId: conversation.id,
      senderType: 'agent',
      senderId: agent.id,
      kind: 'chat',
      content,
      mentions: resolveMentionTargetsFromContent(content, memberAgents),
      trigger,
      replyToMessageId: options.replyToMessageId,
      turnId: options.turnId,
      createdAt: new Date().toISOString(),
    };
    await messageStore.append(responseMessage);
    if (options.dispatchToMailbox) {
      await acceptConversationMessage(conversation, responseMessage);
    } else {
      emitConversationEvent(conversation.id, 'message', responseMessage);
    }
    return responseMessage;
  }

  function canDispatchToTarget(actor: AgentInstance, targetAgentId: string) {
    return Boolean(
      actor.managedAgentIds?.includes(targetAgentId)
      || actor.policy?.canDispatchAgentIds.includes(targetAgentId)
      || actor.policy?.canDirectMessageAgentIds.includes(targetAgentId),
    );
  }

  async function ensureAgentDm(actor: AgentInstance, targetAgentId: string) {
    if (!canDispatchToTarget(actor, targetAgentId)) {
      throw new Error(`agent dispatch not allowed: ${targetAgentId}`);
    }
    const target = await agentStore.get(targetAgentId);
    if (!target) {
      throw new Error(`agent not found: ${targetAgentId}`);
    }

    const actorMemberId = `agent:${actor.id}`;
    const targetMemberId = `agent:${targetAgentId}`;
    const existing = (await conversationStore.list()).find((conversation) => (
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
      id: `dm-${actor.id}-${targetAgentId}`,
      workspaceId: 'workspace-default',
      type: 'dm',
      name: `${actor.name} / ${target.name}`,
      topic: '',
      memberIds: [actorMemberId, targetMemberId],
      createdByType: 'agent',
      createdById: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await conversationStore.save(created);
    return created;
  }

  async function createManagedAgent(actor: AgentInstance, action: Record<string, unknown>) {
    if (!actor.policy?.canCreateAgents) {
      throw new Error('agent create not allowed');
    }

    const name = String(action.name ?? '').trim();
    if (!name) {
      throw new Error('agent.create requires name');
    }

    const agentID = typeof action.id === 'string' && action.id.trim() !== ''
      ? action.id.trim()
      : `agent-${randomUUID()}`;
    if (await agentStore.get(agentID)) {
      throw new Error(`agent already exists: ${agentID}`);
    }

    const role = typeof action.role === 'string' ? action.role as AgentInstance['role'] : 'worker';
    if (roleRank(role) > roleRank(actor.role)) {
      throw new Error(`cannot create higher role agent: ${role}`);
    }

    const policy = normalizePolicy(
      typeof action.policy === 'object' && action.policy ? action.policy as Partial<AgentPolicy> : undefined,
    );
    if (!isSubsetWithin(policy.commandCategories, actor.policy?.commandCategories)) {
      throw new Error('child command categories exceed creator policy');
    }
    if (!isSubsetWithin(policy.planetIds, actor.policy?.planetIds)) {
      throw new Error('child planet scope exceeds creator policy');
    }

    const providerId = typeof action.providerId === 'string' && action.providerId.trim() !== ''
      ? action.providerId.trim()
      : actor.providerId;
    if (!await providerStore.get(providerId)) {
      throw new Error(`provider not found: ${providerId}`);
    }

    const now = new Date().toISOString();
    const threadId = `thread-${agentID}`;
    const child: AgentInstance = {
      id: agentID,
      name,
      providerId,
      serverUrl: actor.serverUrl,
      playerId: actor.playerId,
      playerKeySecretId: actor.playerKeySecretId,
      status: 'idle',
      goal: typeof action.goal === 'string' ? action.goal : '',
      activeThreadId: threadId,
      role,
      policy,
      supervisorAgentIds: dedupe([
        ...(Array.isArray(action.supervisorAgentIds)
          ? action.supervisorAgentIds.filter((value): value is string => typeof value === 'string')
          : []),
        actor.id,
      ]),
      managedAgentIds: Array.isArray(action.managedAgentIds)
        ? dedupe(action.managedAgentIds.filter((value): value is string => typeof value === 'string'))
        : [],
      activeConversationIds: [],
      createdAt: now,
      updatedAt: now,
    };
    const thread: AgentThread = {
      id: threadId,
      agentId: agentID,
      title: name,
      messages: [],
      toolCalls: [],
      executionLogs: [],
      createdAt: now,
      updatedAt: now,
    };

    actor.managedAgentIds = dedupe([...(actor.managedAgentIds ?? []), child.id]);
    actor.updatedAt = now;

    await threadStore.save(thread);
    await agentStore.save(child);
    await agentStore.save(actor);
    return JSON.stringify({
      id: child.id,
      name: child.name,
      providerId: child.providerId,
      policy: child.policy,
    });
  }

  async function updateManagedAgent(actor: AgentInstance, action: Record<string, unknown>) {
    const targetAgentId = String(action.agentId ?? '').trim();
    if (!targetAgentId) {
      throw new Error('agent.update requires agentId');
    }
    if (targetAgentId !== actor.id && !actor.managedAgentIds?.includes(targetAgentId)) {
      throw new Error(`agent update not allowed: ${targetAgentId}`);
    }

    const target = await agentStore.get(targetAgentId);
    if (!target) {
      throw new Error(`agent not found: ${targetAgentId}`);
    }

    const policy = action.policy && typeof action.policy === 'object'
      ? normalizePolicy(action.policy as Partial<AgentPolicy>, target.policy ?? createDefaultPolicy())
      : target.policy ?? createDefaultPolicy();
    if (!isSubsetWithin(policy.commandCategories, actor.policy?.commandCategories)) {
      throw new Error('updated command categories exceed actor policy');
    }
    if (!isSubsetWithin(policy.planetIds, actor.policy?.planetIds)) {
      throw new Error('updated planet scope exceeds actor policy');
    }

    const role = typeof action.role === 'string' ? action.role as AgentInstance['role'] : target.role;
    if (roleRank(role) > roleRank(actor.role)) {
      throw new Error(`cannot assign higher role: ${role}`);
    }

    const updated: AgentInstance = {
      ...target,
      name: typeof action.name === 'string' && action.name.trim() !== '' ? action.name.trim() : target.name,
      goal: typeof action.goal === 'string' ? action.goal : target.goal,
      role,
      policy,
      updatedAt: new Date().toISOString(),
    };
    await agentStore.save(updated);
    return JSON.stringify({
      id: updated.id,
      name: updated.name,
      role: updated.role,
      policy: updated.policy,
    });
  }

  async function sendAgentConversationMessage(
    actor: AgentInstance,
    action: Record<string, unknown>,
    turnContext?: { turnId: string; requestMessageId: string },
  ) {
    const targetAgentId = typeof action.targetAgentId === 'string' ? action.targetAgentId : '';
    const conversationId = typeof action.conversationId === 'string' ? action.conversationId : '';
    const ensuredConversation = conversationId
      ? await conversationStore.get(conversationId)
      : targetAgentId
        ? await ensureAgentDm(actor, targetAgentId)
        : null;
    if (!ensuredConversation) {
      throw new Error(`conversation not found: ${String(action.conversationId ?? '')}`);
    }
    if (!ensuredConversation.memberIds.includes(`agent:${actor.id}`)) {
      throw new Error(`agent not in conversation: ${ensuredConversation.id}`);
    }
    const otherAgentIds = ensuredConversation.memberIds
      .filter((memberId) => memberId.startsWith('agent:'))
      .map((memberId) => memberId.slice('agent:'.length))
      .filter((memberId) => memberId !== actor.id);
    if (ensuredConversation.type === 'dm' && otherAgentIds[0] && !canDispatchToTarget(actor, otherAgentIds[0])) {
      throw new Error(`agent dispatch not allowed: ${otherAgentIds[0]}`);
    }
    const content = String(action.content ?? '').trim();
    if (!content) {
      throw new Error('conversation.send_message requires content');
    }
    const message = await appendAgentConversationMessage(
      ensuredConversation,
      actor,
      content,
      'agent_dispatch',
      {
        turnId: turnContext?.turnId,
        dispatchToMailbox: true,
      },
    );
    return JSON.stringify({
      messageId: message.id,
      conversationId: ensuredConversation.id,
      targetAgentId: otherAgentIds[0] ?? action.targetAgentId,
    });
  }

  const mailboxController = createMailboxController({
    runAgent: async ({ agentId, conversation, turnId }) => {
      const agent = await agentStore.get(agentId);
      if (!agent) {
        return;
      }

      const initialTurn = await turnStore.get(turnId);
      if (!initialTurn) {
        return;
      }
      let currentTurn: ConversationTurn = initialTurn;

      const persistTurn = async (
        updater: (turn: ConversationTurn) => ConversationTurn,
      ) => {
        currentTurn = await updateTurn(turnId, updater);
        return currentTurn;
      };

      try {
        const provider = await providerStore.get(agent.providerId);
        if (!provider) {
          throw new Error('provider_not_found');
        }

        const history = buildHistoryForAgent(
          agent.id,
          await messageStore.listByConversation(conversation.id),
        );

        agent.status = 'running';
        agent.updatedAt = new Date().toISOString();
        await agentStore.save(agent);
        eventBus.emit({ agentId: agent.id, type: 'status', payload: { status: 'running' } });

        await persistTurn((turn) => ({
          ...turn,
          status: 'planning',
          updatedAt: new Date().toISOString(),
        }));

        const playerKey = await secretStore.readValue(agent.playerKeySecretId);
        const result = await runAgentLoop({
          maxSteps: provider.toolPolicy.maxSteps,
          provider: {
            runTurn: (input) => agentTurnRunner({
              dataRoot: options.dataRoot,
              provider,
              secretStore,
              history: input.history,
              allowedCommands: getAgentAllowedCommands({
                allowedCategories: agent.policy?.commandCategories,
              }),
              contextSections: [
                `当前会话：${conversation.name}`,
                `当前智能体：${agent.name}`,
                '可用 action: game.command / agent.create / agent.update / conversation.ensure_dm / conversation.send_message / final_answer。',
                '如果本轮无需动作且已经完成，可直接返回 assistantMessage + [] + true。',
                '如果同时返回 assistantMessage 与 final_answer，则以 final_answer 作为正式回复。',
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
          gatewayRuntime: {
            createAgent: async (action) => createManagedAgent(agent, action),
            updateAgent: async (action) => updateManagedAgent(agent, action),
            ensureDirectConversation: async (action) => {
              const ensuredConversation = await ensureAgentDm(agent, String(action.targetAgentId));
              return JSON.stringify({
                conversationId: ensuredConversation.id,
                name: ensuredConversation.name,
                targetAgentId: action.targetAgentId,
              });
            },
            sendConversationMessage: async (action) => sendAgentConversationMessage(agent, action, {
              turnId: currentTurn.id,
              requestMessageId: currentTurn.requestMessageId,
            }),
          },
          initialContext: { goal: history.at(-1)?.content ?? '' },
          initialHistory: history,
          onTurnPrepared: async ({ assistantMessage, actions, repairCount }) => {
            await persistTurn((turn) => ({
              ...turn,
              status: 'planning',
              assistantPreview: assistantMessage,
              repairCount,
              actionSummaries: actions.length > 0
                ? actions.map((action) => ({
                    type: action.type,
                    status: 'pending',
                    detail: summarizeAgentAction(action),
                  }))
                : turn.actionSummaries,
              updatedAt: new Date().toISOString(),
            }));
          },
          onActionUpdate: async ({ actionIndex, action, status, detail }) => {
            const safeDetail = status === 'failed'
              ? classifyPublicTurnError(new Error(detail)).message
              : detail;
            await persistTurn((turn) => ({
              ...turn,
              status: status === 'pending' ? 'executing' : turn.status,
              actionSummaries: turn.actionSummaries.map((summary, index) => (
                index === actionIndex
                  ? {
                      type: action.type,
                      status,
                      detail: status === 'pending' ? summarizeAgentAction(action) : safeDetail,
                    }
                  : summary
              )),
              updatedAt: new Date().toISOString(),
            }));
          },
        });

        let finalMessageId = currentTurn.finalMessageId;
        if (result.finalMessage) {
          const finalMessage = await appendAgentConversationMessage(
            conversation,
            agent,
            result.finalMessage,
            'agent_message',
            {
              replyToMessageId: currentTurn.requestMessageId,
              turnId: currentTurn.id,
            },
          );
          finalMessageId = finalMessage.id;
        }

        await persistTurn((turn) => ({
          ...turn,
          status: 'succeeded',
          outcomeKind: result.outcomeKind,
          executedActionCount: result.executedActionCount,
          repairCount: result.repairCount,
          ...(finalMessageId ? { finalMessageId } : {}),
          updatedAt: new Date().toISOString(),
        }));

        agent.status = 'idle';
        agent.updatedAt = new Date().toISOString();
        await agentStore.save(agent);
        eventBus.emit({ agentId: agent.id, type: 'status', payload: { status: 'idle' } });
      } catch (error) {
        agent.status = 'error';
        agent.updatedAt = new Date().toISOString();
        await agentStore.save(agent);
        const publicError = classifyPublicTurnError(error);
        const rawErrorMessage = publicError.rawMessage;
        const errorHint = buildTurnErrorHint(publicError.code, rawErrorMessage);
        console.error('agent turn failed', {
          agentId: agent.id,
          turnId: currentTurn.id,
          code: publicError.code,
          rawError: rawErrorMessage,
        });
        const systemMessage: ConversationMessage = {
          id: randomUUID(),
          conversationId: conversation.id,
          senderType: 'system',
          senderId: agent.id,
          kind: 'system',
          content: `${agent.name} 回复失败：${publicError.message}`,
          mentions: [],
          trigger: 'system_message',
          replyToMessageId: currentTurn.requestMessageId,
          turnId: currentTurn.id,
          createdAt: new Date().toISOString(),
        };
        await messageStore.append(systemMessage);
        emitConversationEvent(conversation.id, 'message', systemMessage);
        await persistTurn((turn) => ({
          ...turn,
          status: 'failed',
          outcomeKind: 'blocked',
          errorCode: publicError.code,
          errorMessage: publicError.message,
          rawErrorMessage,
          ...(errorHint ? { errorHint } : {}),
          updatedAt: new Date().toISOString(),
        }));
        eventBus.emit({
          agentId: agent.id,
          type: 'error',
          payload: { code: publicError.code, message: publicError.message },
        });
      }
    },
  });

  async function handleAcceptedConversationMessage(conversation: Conversation, message: ConversationMessage) {
    return acceptConversationMessage(conversation, message);
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
          await acceptConversationMessage(conversation, message);
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

    if (request.url?.startsWith('/providers')) {
      await handleProviderRoutes(request, response, {
        providerStore,
        secretStore,
      });
      return;
    }

    if (request.url?.startsWith('/agents')) {
      await handleAgentRoutes(request, response, {
        dataRoot: options.dataRoot,
        agentStore,
        providerStore,
        threadStore,
        secretStore,
        eventBus,
        turnRunner: agentTurnRunner,
        createManagedAgent,
        updateManagedAgent,
        ensureDirectConversation: async (actor, targetAgentId) => {
          const conversation = await ensureAgentDm(actor, targetAgentId);
          return conversation.id;
        },
        sendConversationMessage: sendAgentConversationMessage,
      });
      return;
    }

    if (request.url?.startsWith('/conversations')) {
      await handleConversationRoutes(request, response, {
        agentStore,
        conversationStore,
        messageStore,
        turnStore,
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
      const providers = await providerStore.list();
      const agents = await agentStore.list();
      const threads = await threadStore.list();
      const conversations = await conversationStore.list();
      const messages = await messageStore.list();
      const turns = await turnStore.list();
      const schedules = await scheduleStore.list();

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        ...exportBundle({
          providers,
          includeSecrets: Boolean(payload.includeSecrets),
          encryptedSecrets: [],
        }),
        agents,
        threads,
        conversations,
        messages,
        turns,
        schedules,
      }));
      return;
    }

    if (request.method === 'POST' && request.url === '/import') {
      const payload = await readJsonBody<{
        providers?: Array<Awaited<ReturnType<typeof providerStore.list>>[number]>;
        agents?: Array<Awaited<ReturnType<typeof agentStore.list>>[number]>;
        threads?: Array<Awaited<ReturnType<typeof threadStore.list>>[number]>;
        conversations?: Array<Awaited<ReturnType<typeof conversationStore.list>>[number]>;
        messages?: Array<Awaited<ReturnType<typeof messageStore.list>>[number]>;
        turns?: Array<Awaited<ReturnType<typeof turnStore.list>>[number]>;
        schedules?: Array<Awaited<ReturnType<typeof scheduleStore.list>>[number]>;
      }>(request);

      await Promise.all((payload.providers ?? []).map((provider) => providerStore.save(provider)));
      await Promise.all((payload.agents ?? []).map((agent) => agentStore.save(agent)));
      await Promise.all((payload.threads ?? []).map((thread) => threadStore.save(thread)));
      await Promise.all((payload.conversations ?? []).map((conversation) => conversationStore.save(conversation)));
      await Promise.all((payload.messages ?? []).map((message) => messageStore.append(message)));
      await Promise.all((payload.turns ?? []).map((turn) => turnStore.save(turn)));
      await Promise.all((payload.schedules ?? []).map((schedule) => scheduleStore.save(schedule)));

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        imported: {
          providers: payload.providers?.length ?? 0,
          agents: payload.agents?.length ?? 0,
          threads: payload.threads?.length ?? 0,
          conversations: payload.conversations?.length ?? 0,
          messages: payload.messages?.length ?? 0,
          turns: payload.turns?.length ?? 0,
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
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
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
