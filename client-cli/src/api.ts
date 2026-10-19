import { createApiClient } from '@gw/shared/api';
import { DEFAULT_GALAXY_ID, DEFAULT_PLANET_ID, DEFAULT_SYSTEM_ID } from '@gw/shared/config';

import { SERVER_URL } from './config.js';

export type IssuerAuth = { issuerType: 'agent'; issuerId: string };

/**
 * 发令者：`SW_ISSUER=<名>` 时以 agent 身份发令（issuer_type=agent），
 * 不设时由玩家本人发令。REPL 的 `as <名>` / `as` 也改这里。
 *
 * 非法值不抛异常（模块初始化时抛会变成裸栈退出）：返回 `{ error }`，
 * 由 main 打印中文原因后退出。
 */
export function issuerFromEnv(): IssuerAuth | { error: string } | undefined {
  const name = process.env.SW_ISSUER?.trim();
  if (!name) {
    return undefined;
  }
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(name)) {
    return { error: `SW_ISSUER 非法（${name}）：只允许字母、数字、_ . : -，最长 64 字符` };
  }
  return { issuerType: 'agent', issuerId: name };
}

const envIssuer = issuerFromEnv();
if (envIssuer && 'error' in envIssuer) {
  // 模块初始化阶段拿不到 main 的日志通道：先写 stderr，main 在 banner 后再打印一次并退出。
  console.error(envIssuer.error);
}

/** CLI 进程内的 API 客户端：REPL 把它放进命令上下文，switch 命令切换它的鉴权。 */
export const api = createApiClient({
  serverUrl: SERVER_URL,
  defaultGalaxyId: DEFAULT_GALAXY_ID,
  defaultPlanetId: DEFAULT_PLANET_ID,
  defaultSystemId: DEFAULT_SYSTEM_ID,
  auth: envIssuer && !('error' in envIssuer) ? envIssuer : undefined,
});
