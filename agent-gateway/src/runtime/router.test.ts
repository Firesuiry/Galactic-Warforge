import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, it } from 'node:test';

import { createMailboxController, resolveAutoWakeTargets } from './router.js';

describe('conversation router', () => {
  it('resolves mentioned agents in channels and only dispatch-style agent dms', () => {
    const channelTargets = resolveAutoWakeTargets({
      conversation: {
        id: 'conv-channel',
        workspaceId: 'workspace-default',
        type: 'channel',
        name: '星球A协作',
        topic: '',
        memberIds: ['player:p1', 'agent:agent-builder'],
        createdByType: 'player',
        createdById: 'p1',
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
      },
      message: {
        id: 'msg-channel',
        conversationId: 'conv-channel',
        senderType: 'player',
        senderId: 'p1',
        kind: 'chat',
        content: '@建造官 检查产线',
        mentions: [{ type: 'agent', id: 'agent-builder' }],
        trigger: 'player_message',
        createdAt: '2026-04-03T00:00:00.000Z',
      },
    });

    const dmTargets = resolveAutoWakeTargets({
      conversation: {
        id: 'conv-dm',
        workspaceId: 'workspace-default',
        type: 'dm',
        name: '总管 / 建造官',
        topic: '',
        memberIds: ['agent:agent-director', 'agent:agent-builder'],
        createdByType: 'player',
        createdById: 'p1',
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
      },
      message: {
        id: 'msg-dm',
        conversationId: 'conv-dm',
        senderType: 'agent',
        senderId: 'agent-director',
        kind: 'chat',
        content: '去查一下星球A电力',
        mentions: [],
        trigger: 'agent_dispatch',
        createdAt: '2026-04-03T00:00:00.000Z',
      },
    });

    assert.deepEqual(channelTargets, ['agent-builder']);
    assert.deepEqual(dmTargets, ['agent-builder']);
  });

  it('does not auto wake the opposite agent for ordinary agent replies in dms', () => {
    const dmTargets = resolveAutoWakeTargets({
      conversation: {
        id: 'conv-dm',
        workspaceId: 'workspace-default',
        type: 'dm',
        name: '总管 / 建造官',
        topic: '',
        memberIds: ['agent:agent-director', 'agent:agent-builder'],
        createdByType: 'player',
        createdById: 'p1',
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
      },
      message: {
        id: 'msg-dm',
        conversationId: 'conv-dm',
        senderType: 'agent',
        senderId: 'agent-director',
        kind: 'chat',
        content: '收到。',
        mentions: [],
        trigger: 'agent_message',
        createdAt: '2026-04-03T00:00:00.000Z',
      },
    });

    assert.deepEqual(dmTargets, []);
  });

  it('queues messages and runs a single agent serially', async () => {
    const order: string[] = [];
    let releaseFirst = false;

    const controller = createMailboxController({
      runAgent: async ({ agentId, message }) => {
        order.push(`start:${agentId}:${message.id}`);
        if (message.id === 'msg-1') {
          while (!releaseFirst) {
            await delay(5);
          }
        }
        order.push(`done:${agentId}:${message.id}`);
      },
    });

    const conversation = {
      id: 'conv-channel',
      workspaceId: 'workspace-default',
      type: 'channel' as const,
      name: '星球A协作',
      topic: '',
      memberIds: ['player:p1', 'agent:agent-builder'],
      createdByType: 'player' as const,
      createdById: 'p1',
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
    };

    const firstRun = controller.accept([{
      agentId: 'agent-builder',
      turnId: 'turn-1',
      conversation,
      message: {
        id: 'msg-1',
        conversationId: 'conv-channel',
        senderType: 'player',
        senderId: 'p1',
        kind: 'chat',
        content: '@建造官 先查电力',
        mentions: [{ type: 'agent', id: 'agent-builder' }],
        trigger: 'player_message',
        createdAt: '2026-04-03T00:00:00.000Z',
      },
    }]);
    await delay(10);
    const secondRun = controller.accept([{
      agentId: 'agent-builder',
      turnId: 'turn-2',
      conversation,
      message: {
        id: 'msg-2',
        conversationId: 'conv-channel',
        senderType: 'player',
        senderId: 'p1',
        kind: 'chat',
        content: '@建造官 再查产线',
        mentions: [{ type: 'agent', id: 'agent-builder' }],
        trigger: 'player_message',
        createdAt: '2026-04-03T00:00:01.000Z',
      },
    }]);

    assert.deepEqual(controller.mailboxFor('agent-builder'), ['msg-1', 'msg-2']);
    assert.equal(controller.statusOf('agent-builder'), 'running');

    releaseFirst = true;
    await Promise.all([firstRun, secondRun]);

    assert.deepEqual(order, [
      'start:agent-builder:msg-1',
      'done:agent-builder:msg-1',
      'start:agent-builder:msg-2',
      'done:agent-builder:msg-2',
    ]);
    assert.deepEqual(controller.mailboxFor('agent-builder'), []);
    assert.equal(controller.statusOf('agent-builder'), 'idle');
  });
});
