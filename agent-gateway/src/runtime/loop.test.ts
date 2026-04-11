import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runAgentLoop } from './loop.js';

describe('agent loop', () => {
  it('executes typed game commands until the provider marks the run done', async () => {
    const calls: string[] = [];

    const result = await runAgentLoop({
      maxSteps: 4,
      provider: {
        async runTurn(input) {
          if (input.step === 0) {
            return {
              assistantMessage: '先扫描当前行星。',
              actions: [{ type: 'game.command', command: 'scan_planet', args: { planetId: 'planet-1-1' } }],
              done: false,
            };
          }

          return {
            assistantMessage: '扫描完成，未发现阻塞。',
            actions: [{ type: 'final_answer', message: '扫描完成，未发现阻塞。' }],
            done: true,
          };
        },
      },
      cliRuntime: {
        async run(commandLine) {
          calls.push(commandLine);
          return 'ok';
        },
      },
      initialContext: { goal: '检查 planet-1-1' },
    });

    assert.deepEqual(calls, ['scan_planet planet-1-1']);
    assert.equal(result.finalMessage, '扫描完成，未发现阻塞。');
  });

  it('starts from provided conversation history when available', async () => {
    const seenHistories: Array<Array<{ role: string; content: string }>> = [];

    await runAgentLoop({
      maxSteps: 1,
      provider: {
        async runTurn(input) {
          seenHistories.push(input.history.map((entry) => ({ ...entry })));
          return {
            assistantMessage: '收到。',
            actions: [{ type: 'final_answer', message: '收到。' }],
            done: true,
          };
        },
      },
      cliRuntime: {
        async run() {
          return 'ok';
        },
      },
      initialContext: { goal: '忽略这个 goal' },
      initialHistory: [
        { role: 'user', content: '玩家：收到吗？' },
        { role: 'assistant', content: '建造官：收到。' },
      ],
    });

    assert.deepEqual(seenHistories[0], [
      { role: 'user', content: '玩家：收到吗？' },
      { role: 'assistant', content: '建造官：收到。' },
    ]);
  });

  it('executes gateway agent and conversation actions before final completion', async () => {
    const calls: string[] = [];

    const result = await runAgentLoop({
      maxSteps: 2,
      provider: {
        async runTurn(input) {
          if (input.step === 0) {
            return {
              assistantMessage: '我先创建胡景并委派建矿场。',
              actions: [
                {
                  type: 'agent.create',
                  name: '胡景',
                  role: 'worker',
                  policy: {
                    planetIds: ['planet-1-1'],
                    commandCategories: ['build'],
                    canCreateAgents: false,
                    canCreateChannel: false,
                    canManageMembers: false,
                    canInviteByPlanet: false,
                    canCreateSchedules: false,
                    canDirectMessageAgentIds: [],
                    canDispatchAgentIds: [],
                  },
                },
                { type: 'conversation.ensure_dm', targetAgentId: 'agent-hujing' },
                { type: 'conversation.send_message', conversationId: 'conv-hujing', content: '去新建一个矿场' },
              ],
              done: false,
            };
          }

          return {
            assistantMessage: '已安排完成。',
            actions: [{ type: 'final_answer', message: '已安排完成。' }],
            done: true,
          };
        },
      },
      cliRuntime: {
        async run() {
          return 'ok';
        },
      },
      gatewayRuntime: {
        async createAgent(action) {
          calls.push(`create:${String(action.name ?? '')}`);
          return 'agent-created';
        },
        async ensureDirectConversation(action) {
          calls.push(`ensure_dm:${String(action.targetAgentId ?? '')}`);
          return 'conv-hujing';
        },
        async sendConversationMessage(action) {
          calls.push(`send_message:${String(action.conversationId ?? '')}`);
          return 'message-sent';
        },
        async updateAgent() {
          calls.push('update');
          return 'updated';
        },
      },
      initialContext: { goal: '创建胡景并委派建矿场' },
    });

    assert.deepEqual(calls, [
      'create:胡景',
      'ensure_dm:agent-hujing',
      'send_message:conv-hujing',
    ]);
    assert.equal(result.finalMessage, '已安排完成。');
  });

  it('accepts assistantMessage as the final reply when done is true and no final_answer exists', async () => {
    const result = await runAgentLoop({
      maxSteps: 1,
      provider: {
        async runTurn() {
          return {
            assistantMessage: '已收到你的私聊',
            actions: [],
            done: true,
          };
        },
      },
      cliRuntime: {
        async run() {
          return 'ok';
        },
      },
      initialContext: { goal: '回复私聊' },
    });

    assert.equal(result.finalMessage, '已收到你的私聊');
  });

  it('repairs an observe turn when the first reply only plans but does not execute', async () => {
    const calls: string[] = [];
    let attempts = 0;

    const result = await runAgentLoop({
      maxSteps: 1,
      provider: {
        async runTurn() {
          attempts += 1;
          if (attempts === 1) {
            return {
              assistantMessage: '我准备先去扫描 planet-1-2。',
              actions: [],
              done: true,
            };
          }
          return {
            assistantMessage: '我已扫描 planet-1-2。',
            actions: [{ type: 'game.command', command: 'scan_planet', args: { planetId: 'planet-1-2' } }],
            done: true,
          };
        },
      },
      cliRuntime: {
        async run(commandLine) {
          calls.push(commandLine);
          return 'ok';
        },
      },
      initialContext: { goal: '观察 planet-1-2 的情况' },
    });

    assert.equal(attempts, 2);
    assert.deepEqual(calls, ['scan_planet planet-1-2']);
    assert.equal(result.finalMessage, '我已扫描 planet-1-2。');
  });

  it('fails the turn when an observe request still has no executed action after one repair', async () => {
    await assert.rejects(
      () =>
        runAgentLoop({
          maxSteps: 1,
          provider: {
            async runTurn() {
              return {
                assistantMessage: '我准备先观察，再告诉你结果。',
                actions: [],
                done: true,
              };
            },
          },
          cliRuntime: {
            async run() {
              return 'ok';
            },
          },
          initialContext: { goal: '观察 planet-1-2 的情况' },
        }),
      /没有执行所需动作/i,
    );
  });

  it('still prefers final_answer over assistantMessage when both are present', async () => {
    const result = await runAgentLoop({
      maxSteps: 1,
      provider: {
        async runTurn() {
          return {
            assistantMessage: '这是预览',
            actions: [{ type: 'final_answer', message: '这是正式回复' }],
            done: true,
          };
        },
      },
      cliRuntime: {
        async run() {
          return 'ok';
        },
      },
      initialContext: { goal: '回复私聊' },
    });

    assert.equal(result.finalMessage, '这是正式回复');
  });
});
