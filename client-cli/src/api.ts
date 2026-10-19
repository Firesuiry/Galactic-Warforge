import { createApiClient } from '@gw/shared/api';
import { DEFAULT_GALAXY_ID, DEFAULT_PLANET_ID, DEFAULT_SYSTEM_ID } from '@gw/shared/config';

import { SERVER_URL } from './config.js';
import { issuerFromEnv } from './issuer.js';

export { issuerFromEnv, type IssuerAuth } from './issuer.js';

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
