import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runAgentLoop } from './loop.js';

describe('agent loop', () => {
  it('executes cli actions until the provider marks the run done', async () => {
    const calls: string[] = [];

    const result = await runAgentLoop({
      maxSteps: 4,
      provider: {
        async runTurn(input) {
          if (input.step === 0) {
            return {
              assistantMessage: '先扫描当前行星。',
              actions: [{ type: 'game.cli', commandLine: 'scan_planet planet-1-1' }],
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
        { role: 'user', content: '玩家：检查星球A' },
        { role: 'assistant', content: '建造官：收到。' },
      ],
    });

    assert.deepEqual(seenHistories[0], [
      { role: 'user', content: '玩家：检查星球A' },
      { role: 'assistant', content: '建造官：收到。' },
    ]);
  });
});
