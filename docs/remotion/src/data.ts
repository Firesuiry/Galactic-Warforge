export const snapshotDate = '2026-03-22';

export const heroTags = [
  '服务端权威',
  'Tick 驱动',
  '戴森球式工业与战斗',
];

export const architectureLayers = [
  '玩家 / CLI / 外部 AI',
  'HTTP 命令网关',
  '鉴权 / 去重 / 审计',
  'Tick 主循环',
  '地图 / 建造 / 物流 / 战斗 / 戴森',
];

export const worldLayers = ['星系', '恒星系', '行星网格'];

export const systemCards = [
  {
    title: '工业',
    accent: '#77f2ff',
    body: '采集、传送带、分拣、仓储和配方生产在统一 Tick 内推进。',
  },
  {
    title: '物流',
    accent: '#8ef7a5',
    body: '行星站、星际站、无人机与货船把供需关系串成网络。',
  },
  {
    title: '能源',
    accent: '#ffd56a',
    body: '发电、输配、电网连通域与储能决定全局吞吐上限。',
  },
  {
    title: '科技',
    accent: '#ff94b6',
    body: '研究、前置条件与解锁关系决定扩张节奏和能力边界。',
  },
  {
    title: '戴森',
    accent: '#ff8c6a',
    body: '太阳帆、节点、框架、壳层与射线接收构成终局能源链。',
  },
  {
    title: '战斗',
    accent: '#a794ff',
    body: '黑雾威胁、炮塔、防御设施、探测和轨道冲突接入同一结算链。',
  },
];

export const loopSteps = [
  '建造',
  '供电',
  '采集',
  '运输',
  '生产',
  '科研',
  '解锁',
  '扩产',
];

export const metrics = [
  {label: '已完成任务', value: 87, suffix: '项'},
  {label: '可建造建筑', value: 53, suffix: '座'},
  {label: '科技条目', value: 105, suffix: '项'},
  {label: '物品 / 配方', value: 55, suffix: ' / 34'},
];

export const statusHighlights = [
  'Go 服务端测试已通过',
  '研究 -> 解锁 -> 建造 -> 生产主循环已打通',
  'SSE 事件、快照、回放、回滚链路已具备',
];

export const futureFocus = [
  '物流站配置 API',
  '战斗科技深度接线',
  '轨道与舰队编队',
];
