import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { runClaudeTurn } from './claude-cli.js';
import { runCodexTurn } from './codex-cli.js';
import { parseProviderResult } from './index.js';
import { runOpenAICompatibleTurn } from './openai-compatible.js';
import { runProviderTurn } from '../runtime/turn.js';

describe('provider result parser', () => {
  it('parses a valid structured agent response', () => {
    const parsed = parseProviderResult(JSON.stringify({
      assistantMessage: '我会先扫描当前行星。',
      actions: [{ type: 'game.command', command: 'scan_planet', args: { planetId: 'planet-1-1' } }],
      done: false,
    }));

    assert.equal(parsed.assistantMessage, '我会先扫描当前行星。');
    assert.equal(parsed.actions[0]?.type, 'game.command');
    assert.equal(parsed.done, false);
  });

  it('falls back to final_answer message when assistantMessage is omitted', () => {
    const parsed = parseProviderResult(JSON.stringify({
      actions: [{ type: 'final_answer', message: '已通知胡景去建造矿场。' }],
      done: true,
    }));

    assert.equal(parsed.assistantMessage, '已通知胡景去建造矿场。');
    assert.equal(parsed.actions[0]?.type, 'final_answer');
    assert.equal(parsed.done, true);
  });

  it('falls back to an empty assistant message when assistantMessage is omitted mid-loop', () => {
    const parsed = parseProviderResult(JSON.stringify({
      actions: [{ type: 'game.command', command: 'scan_planet', args: { planetId: 'planet-1-1' } }],
      done: false,
    }));

    assert.equal(parsed.assistantMessage, '');
    assert.equal(parsed.actions[0]?.type, 'game.command');
    assert.equal(parsed.done, false);
  });

  it('rejects malformed payloads', () => {
    assert.throws(() => parseProviderResult('{"assistantMessage":"收到。","actions":{}}'), /actions/);
    assert.throws(() => parseProviderResult('{"actions":[]}'), /done/);
  });

  it('accepts claude structured_output envelopes', () => {
    const parsed = parseProviderResult(JSON.stringify({
      structured_output: {
        assistantMessage: '收到。',
        actions: [],
        done: true,
      },
    }));

    assert.equal(parsed.assistantMessage, '收到。');
    assert.deepEqual(parsed.actions, []);
    assert.equal(parsed.done, true);
  });

  it('accepts minimax content with leading think tags', () => {
    const parsed = parseProviderResult(`<think>先思考一下</think>

{"assistantMessage":"收到。","actions":[],"done":true}`);

    assert.equal(parsed.assistantMessage, '收到。');
    assert.deepEqual(parsed.actions, []);
    assert.equal(parsed.done, true);
  });

  it('accepts minimax content with trailing non-json text', () => {
    const parsed = parseProviderResult(`{"assistantMessage":"收到。","actions":[],"done":true}

额外说明`);

    assert.equal(parsed.assistantMessage, '收到。');
    assert.deepEqual(parsed.actions, []);
    assert.equal(parsed.done, true);
  });

  it('accepts the first json object when multiple payloads are concatenated', () => {
    const parsed = parseProviderResult(`{"assistantMessage":"收到。","actions":[],"done":true}
{"assistantMessage":"忽略我","actions":[],"done":false}`);

    assert.equal(parsed.assistantMessage, '收到。');
    assert.deepEqual(parsed.actions, []);
    assert.equal(parsed.done, true);
  });

  it('wraps plain text replies into a completed assistant-only turn', () => {
    const parsed = parseProviderResult('已收到你的私聊');

    assert.equal(parsed.assistantMessage, '已收到你的私聊');
    assert.deepEqual(parsed.actions, []);
    assert.equal(parsed.done, true);
  });

  it('fills missing actions and done for assistant-only json replies', () => {
    const parsed = parseProviderResult('{"assistantMessage":"收到，我先观察当前状态。"}');

    assert.equal(parsed.assistantMessage, '收到，我先观察当前状态。');
    assert.deepEqual(parsed.actions, []);
    assert.equal(parsed.done, true);
  });
});

describe('http api provider', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses claude style api responses', async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(input), 'https://api.example.com/messages');
      assert.equal(init?.method, 'POST');
      assert.equal((init?.headers as Record<string, string>)['x-api-key'], 'sk-demo-key');
      assert.equal((init?.headers as Record<string, string>)['anthropic-version'], '2023-06-01');

      const body = JSON.parse(String(init?.body)) as {
        model: string;
        max_tokens: number;
        system: string;
        messages: Array<{ role: string; content: string }>;
      };
      assert.equal(body.model, 'claude-sonnet-4-5');
      assert.equal(body.system, '你是测试助手。');
      assert.equal(body.max_tokens, 1024);
      assert.equal(body.messages[0]?.role, 'user');

      return new Response(JSON.stringify({
        content: [
          {
            type: 'text',
            text: '{"assistantMessage":"收到","actions":[],"done":true}',
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const parsed = await runOpenAICompatibleTurn({
      apiUrl: 'https://api.example.com',
      apiStyle: 'claude',
      apiKey: 'sk-demo-key',
      model: 'claude-sonnet-4-5',
      systemPrompt: '你是测试助手。',
      userPrompt: '请回复收到',
    } as never);

    assert.equal(parsed.assistantMessage, '收到');
    assert.deepEqual(parsed.actions, []);
    assert.equal(parsed.done, true);
  });

  it('retries once with a repair prompt when the first payload is schema-invalid', async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;
      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: callCount === 1
                ? '{"assistantMessage":"第一次失败","actions":{}}'
                : '{"assistantMessage":"修复成功","actions":[],"done":true}',
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const parsed = await runOpenAICompatibleTurn({
      apiUrl: 'https://api.example.com',
      apiStyle: 'openai',
      apiKey: 'sk-demo-key',
      model: 'gpt-5',
      systemPrompt: '你是测试助手。',
      userPrompt: '请回复收到',
    } as never);

    assert.equal(callCount, 2);
    assert.equal(parsed.assistantMessage, '修复成功');
    assert.deepEqual(parsed.actions, []);
    assert.equal(parsed.done, true);
  });

  it('supports http_api provider config with apiStyle', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'sw-agent-provider-http-api-'));

    globalThis.fetch = (async () => new Response(JSON.stringify({
      content: [
        {
          type: 'text',
          text: '{"assistantMessage":"已连接 Claude API","actions":[],"done":true}',
        },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const result = await runProviderTurn({
      dataRoot,
      provider: {
        id: 'provider-claude-http',
        name: 'Claude HTTP',
        providerKind: 'http_api',
        description: 'test',
        defaultModel: 'claude-sonnet-4-5',
        systemPrompt: '你是测试助手。',
        toolPolicy: {
          cliEnabled: true,
          maxSteps: 4,
          maxToolCallsPerTurn: 2,
          commandWhitelist: [],
        },
        providerConfig: {
          apiUrl: 'https://api.example.com',
          apiStyle: 'claude',
          apiKeySecretId: 'sec-demo-key',
          model: 'claude-sonnet-4-5',
        },
        createdAt: '2026-04-06T00:00:00.000Z',
        updatedAt: '2026-04-06T00:00:00.000Z',
      } as never,
      secretStore: {
        readValue: async (id: string) => {
          assert.equal(id, 'sec-demo-key');
          return 'sk-demo-key';
        },
      },
      history: [{ role: 'user', content: '请回复收到' }],
    });

    assert.equal(result.assistantMessage, '已连接 Claude API');
    assert.deepEqual(result.actions, []);
    assert.equal(result.done, true);
  });
});

describe('claude cli provider', () => {
  it('passes prompt and startup args without the legacy empty tools flag', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'sw-agent-provider-test-'));
    const capturePath = path.join(tempDir, 'claude-capture.json');
    const fakeClaudePath = path.join(tempDir, 'fake-claude.js');
    await writeFile(fakeClaudePath, `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const toolsIndex = args.indexOf('--tools');
if (toolsIndex !== -1 && args[toolsIndex + 1] === '') {
  console.error('legacy empty tools flag is not allowed');
  process.exit(1);
}
const prompt = args.at(-1);
if (!prompt || prompt.startsWith('--')) {
  console.error('missing prompt');
  process.exit(1);
}
writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({
  args,
  cwd: process.cwd(),
  testFlag: process.env.TEST_FLAG ?? '',
}));
process.stdout.write(JSON.stringify({
  structured_output: {
    assistantMessage: '收到 claude',
    actions: [],
    done: true,
  },
}));
`);
    await chmod(fakeClaudePath, 0o755);

    const parsed = await runClaudeTurn({
      command: fakeClaudePath,
      model: 'sonnet',
      prompt: '请回复收到',
      schemaJson: JSON.stringify({
        type: 'object',
        required: ['assistantMessage', 'actions', 'done'],
        properties: {
          assistantMessage: { type: 'string' },
          actions: { type: 'array' },
          done: { type: 'boolean' },
        },
      }),
      workdir: tempDir,
      argsTemplate: ['--append-system-prompt', '保持简洁'],
      envOverrides: {
        CAPTURE_PATH: capturePath,
        TEST_FLAG: 'enabled',
      },
    });

    assert.equal(parsed.assistantMessage, '收到 claude');
    assert.deepEqual(parsed.actions, []);
    assert.equal(parsed.done, true);

    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as {
      args: string[];
      cwd: string;
      testFlag: string;
    };
    assert.equal(capture.cwd, tempDir);
    assert.equal(capture.testFlag, 'enabled');
    assert.ok(capture.args.includes('-p'));
    assert.ok(capture.args.includes('--permission-mode'));
    assert.ok(capture.args.includes('dontAsk'));
    assert.ok(capture.args.includes('--append-system-prompt'));
    assert.ok(!capture.args.includes('--tools'));
    assert.equal(capture.args.at(-1), '请回复收到');
  });
});

describe('codex cli provider', () => {
  it('places exec-only flags after the exec subcommand', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'sw-agent-provider-test-'));
    const capturePath = path.join(tempDir, 'codex-capture.json');
    const fakeCodexPath = path.join(tempDir, 'fake-codex.js');
    await writeFile(fakeCodexPath, `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const execIndex = args.indexOf('exec');
if (execIndex === -1) {
  console.error('missing exec subcommand');
  process.exit(2);
}
const skipIndex = args.indexOf('--skip-git-repo-check');
if (skipIndex === -1 || skipIndex < execIndex) {
  console.error('--skip-git-repo-check must be passed after exec');
  process.exit(2);
}
if (!(args.includes('-a') && args[args.indexOf('-a') + 1] === 'never')) {
  console.error('missing root approval policy');
  process.exit(2);
}
writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({
  args,
  cwd: process.cwd(),
  testFlag: process.env.TEST_FLAG ?? '',
}));
process.stdout.write(JSON.stringify({
  assistantMessage: '收到 codex',
  actions: [],
  done: true,
}));
`);
    await chmod(fakeCodexPath, 0o755);

    const parsed = await runCodexTurn({
      command: fakeCodexPath,
      model: 'gpt-5-codex',
      prompt: '请回复收到',
      schemaFile: path.join(process.cwd(), 'data/schemas/agent-turn.schema.json'),
      workdir: tempDir,
      argsTemplate: ['--profile', 'test-profile'],
      envOverrides: {
        CAPTURE_PATH: capturePath,
        TEST_FLAG: 'enabled',
      },
    });

    assert.equal(parsed.assistantMessage, '收到 codex');
    assert.deepEqual(parsed.actions, []);
    assert.equal(parsed.done, true);

    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as {
      args: string[];
      cwd: string;
      testFlag: string;
    };
    assert.equal(capture.cwd, tempDir);
    assert.equal(capture.testFlag, 'enabled');
    const execIndex = capture.args.indexOf('exec');
    const skipIndex = capture.args.indexOf('--skip-git-repo-check');
    assert.ok(execIndex >= 0);
    assert.ok(skipIndex > execIndex);
    assert.equal(capture.args.at(-1), '请回复收到');
  });

  it('retries transient codex cli failures before surfacing an error', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'sw-agent-provider-test-'));
    const counterPath = path.join(tempDir, 'codex-counter.txt');
    const fakeCodexPath = path.join(tempDir, 'fake-codex-retry.js');
    await writeFile(counterPath, '0');
    await writeFile(fakeCodexPath, `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs');
const counterPath = process.env.COUNTER_PATH;
const count = Number(readFileSync(counterPath, 'utf8'));
writeFileSync(counterPath, String(count + 1));
if (count === 0) {
  console.error('502 Bad Gateway');
  process.exit(1);
}
process.stdout.write(JSON.stringify({
  assistantMessage: '重试成功',
  actions: [],
  done: true,
}));
`);
    await chmod(fakeCodexPath, 0o755);

    const parsed = await runCodexTurn({
      command: fakeCodexPath,
      model: 'gpt-5-codex',
      prompt: '请回复收到',
      schemaFile: path.join(process.cwd(), 'data/schemas/agent-turn.schema.json'),
      workdir: tempDir,
      envOverrides: {
        COUNTER_PATH: counterPath,
      },
    });

    assert.equal(parsed.assistantMessage, '重试成功');
    assert.equal(await readFile(counterPath, 'utf8'), '2');
  });
});
