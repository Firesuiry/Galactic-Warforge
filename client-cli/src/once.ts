import chalk from 'chalk';
import { createApiClient, type AwaitExecutionOptions, type ApiClient } from '@gw/shared/api';
import { DEFAULT_GALAXY_ID, DEFAULT_PLANET_ID, DEFAULT_SYSTEM_ID } from '@gw/shared/config';
import { splitCommandLine } from '@gw/shared/commands/game-commands';
import { fmtError, fmtExecutionOutcomes } from '@gw/shared/commands/format';
import type { CommandResponse } from '@gw/shared/types';

import { COMMANDS, dispatch } from './commands/index.js';import type { ReplContext } from './repl.js';
import { issuerFromEnv } from './issuer.js';

/** 非交互模式的连接与等待配置；全部来自环境变量，见 docs/dev/客户端CLI.md「非交互模式」。 */
export interface OnceConfig {
  serverUrl: string;
  playerId: string;
  playerKey: string;
  issuerId?: string;
  /** SW_WAIT=0 时只发不等执行结果。 */
  wait: boolean;
  waitTimeoutMs: number;
}

export function onceConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OnceConfig {
  const issuer = issuerFromEnv(env);
  if (issuer && 'error' in issuer) {
    throw new Error(issuer.error);
  }
  const timeoutSeconds = Number(env.SW_WAIT_TIMEOUT ?? '8');
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0) {
    throw new Error(`SW_WAIT_TIMEOUT 非法（${env.SW_WAIT_TIMEOUT}）：应为非负秒数`);
  }
  return {
    serverUrl: env.SW_SERVER ?? 'http://127.0.0.1:18080',
    playerId: env.SW_PLAYER ?? 'p1',
    playerKey: env.SW_KEY ?? 'key_player_1',
    issuerId: issuer?.issuerId,
    wait: env.SW_WAIT !== '0',
    waitTimeoutMs: timeoutSeconds * 1000,
  };
}

export interface OnceOptions {
  config: OnceConfig;
  /** 测试注入的 API 客户端；缺省按 config 新建。 */
  api?: ApiClient;
  /** 测试注入的等待参数（sleep/now/timeout）。 */
  awaitOptions?: AwaitExecutionOptions;
  stdout?: (text: string) => void;
}

export interface OnceResult {
  output: string;
  /** 这一行是否成功：结构拒绝、执行失败、超时、未知命令、本地校验错误都算失败。 */
  ok: boolean;
}

/** 终端会话命令在非交互模式没有终端可操作，直接拒绝（避免 `quit` 提前结束批量）。 */
const NON_INTERACTIVE_EXCLUDED = new Set(['quit', 'exit', 'clear']);

export function createOnceRunner(options: OnceOptions) {
  const { config } = options;
  const out = options.stdout ?? ((text: string) => process.stdout.write(`${text}\n`));

  // dispatch 的返回值是格式化文本；命令响应由 API 回调旁路拿到（不靠正则从文本抠 request_id）。
  const pending: { response?: CommandResponse } = {};
  const api = options.api ?? createApiClient({
    serverUrl: config.serverUrl,
    defaultGalaxyId: DEFAULT_GALAXY_ID,
    defaultPlanetId: DEFAULT_PLANET_ID,
    defaultSystemId: DEFAULT_SYSTEM_ID,
    auth: {
      playerId: config.playerId,
      playerKey: config.playerKey,
      ...(config.issuerId ? { issuerType: 'agent' as const, issuerId: config.issuerId } : {}),
    },
  });
  api.setCommandResponseHandler((response) => { pending.response = response; });
  function takePending(): CommandResponse | undefined {
    const response = pending.response;
    pending.response = undefined;
    return response;
  }

  // 游戏命令走与 REPL 完全相同的 dispatch / 命令表，不复制解析逻辑。
  const ctx: ReplContext = {
    api,
    currentPlayer: config.playerId,
    issuerId: config.issuerId ?? config.playerId,
    rl: {} as never,
  };

  async function waitForExecution(response: CommandResponse): Promise<OnceResult> {
    // 结构校验失败（未入队）没有 execute 记录可等；入队的那部分逐条等。
    const expected = response.results
      .filter((result) => result.status !== 'rejected')
      .map((result) => result.command_index);
    if (expected.length === 0) {
      return { output: '', ok: response.accepted };
    }
    const timeoutMs = options.awaitOptions?.timeoutMs ?? config.waitTimeoutMs;
    const { outcomes } = await api.awaitExecution(response.request_id, expected.length, {
      ...options.awaitOptions,
      timeoutMs,
    });
    const executed = new Set(
      outcomes.filter((outcome) => outcome.status === 'executed').map((outcome) => outcome.command_index),
    );
    return {
      output: fmtExecutionOutcomes(outcomes, expected, timeoutMs / 1000).join('\n'),
      ok: expected.every((index) => executed.has(index)),
    };
  }

  /** 本地校验失败（fmtError）在 `Error: ` 前缀里；命令 handler 抛异常也按失败算。 */
  function isLocalError(text: string): boolean {
    return text.startsWith(fmtError('').replace(/\s+$/, ''));
  }

  async function runLine(line: string): Promise<OnceResult> {
    const { name } = splitCommandLine(line);
    if (NON_INTERACTIVE_EXCLUDED.has(name)) {
      return { output: fmtError(`非交互模式不支持 ${name}`), ok: false };
    }
    if (!COMMANDS[name]) {
      return { output: chalk.red(`Unknown command: "${name}". Type "help" for commands.`), ok: false };
    }

    pending.response = undefined;
    let text: string;
    try {
      text = await dispatch(line, ctx);
    } catch (error) {
      return { output: chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`), ok: false };
    }

    const response = takePending();
    if (!response) {
      // 查询 / 帮助命令：照常输出。本地校验错误（fmtError）仍算失败。
      return { output: text, ok: !isLocalError(text) };
    }
    if (!config.wait) {
      return { output: text, ok: response.accepted };
    }
    const wait = await waitForExecution(response);
    return {
      output: wait.output ? `${text}\n${wait.output}` : text,
      ok: response.accepted && wait.ok,
    };
  }

  /** 单行（`scripts/sw <命令>`）。 */
  async function run(line: string): Promise<boolean> {
    const result = await runLine(line);
    if (result.output) {
      out(result.output);
    }
    return result.ok;
  }

  /** 批量（`scripts/sw -`）：空行与 `#` 注释跳过；失败不中止，最后打印汇总。 */
  async function runLines(lines: string[]): Promise<boolean> {
    const commands = lines.map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
    let succeeded = 0;
    for (const line of commands) {
      out(chalk.bold(`> ${line}`));
      const result = await runLine(line);
      if (result.output) {
        out(result.output);
      }
      if (result.ok) {
        succeeded += 1;
      }
    }
    const failed = commands.length - succeeded;
    out(failed === 0
      ? chalk.green(`${commands.length} 条：成功 ${succeeded}，失败 0`)
      : chalk.red(`${commands.length} 条：成功 ${succeeded}，失败 ${failed}`));
    return failed === 0;
  }

  return { run, runLines, api };
}
