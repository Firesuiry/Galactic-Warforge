/**
 * Playwright 默认场景：与 `scripts/playtest-up.sh` 同口径（遭遇战预设 + 同一张图 + 同一 tick 速率）。
 *
 * 以前 webServer 起的是 `start_official_war_test_server.sh`（config-war + map-war，
 * 官方战争场景），而试玩/手工验收用的是 config-skirmish + map-skirmish：两边的预置建筑、
 * 资源与出生点都不一样，spec 在「默认 Playwright」和「试玩环境」下表现不一致。
 * 现在两边共用 server/config-skirmish.yaml + server/map-skirmish.yaml + tick_rate_override=4。
 *
 * 端口不写死：先向内核申请空闲端口（listen :0）。Playwright 的配置会在主进程和每个
 * worker 进程各加载一次，所以申请到的端口立刻写回 `process.env`：worker 是主进程 fork
 * 出来的，直接继承，不会二次申请（否则 worker 会拿到另一组端口，spec 连不上 webServer）。
 * 想连已经起好的环境时显式给 `SW_WEB_ENTRY` / `SW_BACKEND_ENTRY`（或 `SW_SKIP_WEBSERVER=1`）。
 */
import { createServer } from 'node:net';

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
}

export const PORTS: PlaywrightPorts = {
  webPort: Number(process.env.SW_WEB_PORT) || await allocatePort(),
  backendPort: Number(process.env.SW_BACKEND_PORT) || await allocatePort(),
};
// 写回环境：worker 进程继承，spec 里的 `process.env.SW_*` 与这里取到的是同一组值。
process.env.SW_WEB_PORT = String(PORTS.webPort);
process.env.SW_BACKEND_PORT = String(PORTS.backendPort);
process.env.SW_WEB_ENTRY ??= `http://${HOST}:${PORTS.webPort}`;
process.env.SW_BACKEND_ENTRY ??= `http://${HOST}:${PORTS.backendPort}`;

export const WEB_ENTRY = process.env.SW_WEB_ENTRY;
export const BACKEND_ENTRY = process.env.SW_BACKEND_ENTRY;

/**
 * Playwright 的 webServer 起服务端时透传的场景参数（配置与 start-scenario-server.mjs 共用）。
 * 配置文件在主进程加载、worker 进程 fork 后重新加载：两边各算一次没问题，因为算出来的
 * 是同一组环境变量（端口已写回 process.env），配置/地图/tick 速率也只读环境变量。
 */
export const SERVER_ENV = {
  SW_SERVER_CONFIG: process.env.SW_SERVER_CONFIG ?? 'server/config-skirmish.yaml',
  SW_SERVER_MAP_CONFIG: process.env.SW_SERVER_MAP_CONFIG ?? 'server/map-skirmish.yaml',
  SW_TICK_RATE: process.env.SW_TICK_RATE ?? '4',
};

/** 场景预设：与 scripts/playtest-up.sh 的默认值一致。 */
export const SCENARIO = {
  config: SERVER_ENV.SW_SERVER_CONFIG,
  mapConfig: SERVER_ENV.SW_SERVER_MAP_CONFIG,
  tickRate: SERVER_ENV.SW_TICK_RATE,
} as const;
