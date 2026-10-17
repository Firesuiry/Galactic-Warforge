/**
 * 场景端口与入口：每个场景一组（web + backend），由主进程向内核申请空闲端口（listen :0）。
 *
 * Playwright 的配置会在主进程和每个 worker 进程各加载一次；worker 里再申请会拿到**另一组**
 * 端口，和主进程起的 webServer 对不上。所以主进程申请后把端口/入口写回环境
 * （`SW_PORT_<场景>_WEB` / `SW_PORT_<场景>_BACKEND`、`SW_WEB_ENTRY_<场景>` /
 * `SW_BACKEND_ENTRY_<场景>`），worker 重新加载时直接复用（fork 继承）。
 */
import { createServer } from 'node:net';

import type { ScenarioKind } from './scenario-env';

const HOST = '127.0.0.1';

/** 申请一个空闲端口（close 之后有小概率被抢占，可接受）。 */
function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('failed to allocate a free port'))));
    });
  });
}

export interface PlaywrightPorts {
  webPort: number;
  backendPort: number;
  webEntry: string;
  backendEntry: string;
}

/** 显式单场景模式的通用覆盖（SW_WEB_PORT / SW_BACKEND_PORT）优先于场景专属键。 */
export function scenarioPorts(kind: ScenarioKind): PlaywrightPorts {
  const key = kind.toUpperCase();
  const webPort = Number(process.env.SW_WEB_PORT) || Number(process.env[`SW_PORT_${key}_WEB`]) || 0;
  const backendPort = Number(process.env.SW_BACKEND_PORT) || Number(process.env[`SW_PORT_${key}_BACKEND`]) || 0;
  return {
    webPort,
    backendPort,
    webEntry: process.env[`SW_WEB_ENTRY_${key}`] ?? process.env.SW_WEB_ENTRY ?? `http://${HOST}:${webPort}`,
    backendEntry: process.env[`SW_BACKEND_ENTRY_${key}`] ?? process.env.SW_BACKEND_ENTRY ?? `http://${HOST}:${backendPort}`,
  };
}

/** 申请（或复用）两个场景的端口与入口并写回环境；返回每个场景的端口组。 */
export async function resolveScenarioPorts(kinds: readonly ScenarioKind[]): Promise<Record<ScenarioKind, PlaywrightPorts>> {
  const result = {} as Record<ScenarioKind, PlaywrightPorts>;
  for (const kind of kinds) {
    const key = kind.toUpperCase();
    const current = scenarioPorts(kind);
    const webPort = current.webPort || await allocatePort();
    const backendPort = current.backendPort || await allocatePort();
    const resolved: PlaywrightPorts = {
      webPort,
      backendPort,
      webEntry: process.env.SW_WEB_ENTRY ?? `http://${HOST}:${webPort}`,
      backendEntry: process.env.SW_BACKEND_ENTRY ?? `http://${HOST}:${backendPort}`,
    };
    process.env[`SW_PORT_${key}_WEB`] = String(webPort);
    process.env[`SW_PORT_${key}_BACKEND`] = String(backendPort);
    process.env[`SW_WEB_ENTRY_${key}`] = resolved.webEntry;
    process.env[`SW_BACKEND_ENTRY_${key}`] = resolved.backendEntry;
    result[kind] = resolved;
  }
  return result;
}
