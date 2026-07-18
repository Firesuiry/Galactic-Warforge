/**
 * 星图纯数据模型：恒星/行星配色、银河世界范围、恒星系轨道布局。
 * 不依赖 Pixi，可单测。
 */

import type { FleetRuntimeView, GalaxyView, PlanetRef, SensorContact, SystemRef } from '@shared/types';

/** 恒星光谱型 → 主色（O 蓝 → M 红）。 */
export const STAR_COLORS: Record<string, number> = {
  O: 0x9bb0ff,
  B: 0xaabfff,
  A: 0xcad8ff,
  F: 0xf8f7ff,
  G: 0xfff4e8,
  K: 0xffd2a1,
  M: 0xffb56c,
};

export const DEFAULT_STAR_COLOR = 0xfff4e8;

/** 行星种类 → [主色, 条纹色(可选)]。 */
const PLANET_COLORS: Record<string, [number, number?]> = {
  terrestrial: [0x6fb7ff],
  rocky: [0xb08968],
  barren: [0x8d8d99],
  gas_giant: [0xe0a458, 0xc27b3a],
  ice_giant: [0x9be0e8, 0x6fb7c9],
  ice: [0xbfe8f2],
  lava: [0xd0542a, 0x7a2410],
  oceanic: [0x3f8efc],
};

export function starColorOf(starType: string | undefined | null): number {
  if (!starType) {
    return DEFAULT_STAR_COLOR;
  }
  return STAR_COLORS[starType.trim().toUpperCase()] ?? DEFAULT_STAR_COLOR;
}

export function planetColorOf(kind: string | undefined | null): [number, number?] {
  if (!kind) {
    return [0x9aa7bd];
  }
  return PLANET_COLORS[kind] ?? [0x9aa7bd];
}

export function starTypeLabel(starType: string | undefined | null): string {
  const t = starType?.trim().toUpperCase();
  return t ? `${t} 型恒星` : '未知恒星';
}

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 银河世界坐标范围：优先 galaxy.width/height；缺失时按恒星系分布外扩。
 * 返回以 (0,0) 为左上角的世界矩形。
 */
export function galaxyWorldRect(galaxy: GalaxyView | null | undefined): WorldRect {
  const systems = galaxy?.systems ?? [];
  const xs = systems.map((s) => s.position?.x).filter((v): v is number => typeof v === 'number');
  const ys = systems.map((s) => s.position?.y).filter((v): v is number => typeof v === 'number');

  let x0 = 0;
  let y0 = 0;
  let x1 = typeof galaxy?.width === 'number' && galaxy.width > 0 ? galaxy.width : 0;
  let y1 = typeof galaxy?.height === 'number' && galaxy.height > 0 ? galaxy.height : 0;

  if (xs.length && ys.length) {
    x0 = Math.min(Math.min(...xs), x0);
    y0 = Math.min(Math.min(...ys), y0);
    x1 = Math.max(Math.max(...xs), x1);
    y1 = Math.max(Math.max(...ys), y1);
  }
  if (x1 - x0 < 1 || y1 - y0 < 1) {
    // 无任何有效数据时给一个默认世界。
    return { x: 0, y: 0, width: 1200, height: 900 };
  }
  const marginX = (x1 - x0) * 0.12 + 40;
  const marginY = (y1 - y0) * 0.12 + 40;
  return {
    x: x0 - marginX,
    y: y0 - marginY,
    width: x1 - x0 + marginX * 2,
    height: y1 - y0 + marginY * 2,
  };
}

/** 简单稳定 hash：同一 id 永远得到同一角度。 */
export function hashAngle(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 0xffffffff) * Math.PI * 2;
}

export interface PlanetOrbitLayout {
  planet: PlanetRef;
  /** 轨道半径（世界单位，任意但递增）。 */
  orbitRadius: number;
  /** 初始相位角（弧度，确定性的）。 */
  angle: number;
  /** 行星显示半径。 */
  radius: number;
}

const MIN_ORBIT_RADIUS = 90;
const ORBIT_GAP = 56;

/**
 * 恒星系内行星布局：有 orbit.distance_au 时按其相对比例排序映射到递增半径，
 * 没有时按出现顺序。半径递增保证轨道不重叠，相位角由 id 哈希决定（稳定）。
 */
export function layoutSystemOrbits(planets: PlanetRef[]): PlanetOrbitLayout[] {
  const indexed = planets.map((planet, index) => ({ planet, index }));
  indexed.sort((a, b) => {
    const da = a.planet.orbit?.distance_au;
    const db = b.planet.orbit?.distance_au;
    if (typeof da === 'number' && typeof db === 'number' && da !== db) {
      return da - db;
    }
    if (typeof da === 'number') {
      return -1;
    }
    if (typeof db === 'number') {
      return 1;
    }
    return a.index - b.index;
  });

  return indexed.map(({ planet }, order) => ({
    planet,
    orbitRadius: MIN_ORBIT_RADIUS + order * ORBIT_GAP,
    angle: hashAngle(planet.planet_id),
    radius: planet.kind === 'gas_giant' || planet.kind === 'ice_giant' ? 16 : 11,
  }));
}

/** 银河层缩放 → 恒星精灵显示尺寸（随 discovered 与谱型微调）。 */
export function systemGlyphScale(system: SystemRef): number {
  return system.discovered ? 1 : 0.7;
}

export interface SystemLane {
  fromId: string;
  toId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/**
 * 星座连线：每个恒星系向最近的 k 个邻居连线，去重。
 * 端点携带恒星系 id：既是战火航线的定向依据，也是 fleet_move 跃迁合法性
 * 的本地判定图（server 端 mapmodel.SystemsLinkedByLane 用同一 k 近邻规则）。
 */
export function computeSystemLanes(systems: SystemRef[], neighborCount = 2): SystemLane[] {
  const points = systems
    .filter((s) => s.position)
    .map((s) => ({ id: s.system_id, x: s.position!.x, y: s.position!.y }));
  const seen = new Set<string>();
  const lanes: SystemLane[] = [];

  points.forEach((a, i) => {
    const distances = points
      .map((b, j) => ({ j, d: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }))
      .filter(({ j }) => j !== i)
      .sort((m, n) => m.d - n.d);
    distances.slice(0, neighborCount).forEach(({ j }) => {
      const b = points[j]!;
      const key = [a.id, b.id].sort().join('~');
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      lanes.push({ fromId: a.id, toId: b.id, from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y } });
    });
  });
  return lanes;
}

/** 一个恒星系的舰队驻留概况（徽标聚合结果）。 */
export interface FleetSystemPresence {
  systemId: string;
  /** 驻留舰队总数（同系多艘聚合成一个徽标 + 数量角标）。 */
  total: number;
  /** 其中 attacking 状态的舰队数（>0 时徽标红色脉冲、相连航线做战火动画）。 */
  attacking: number;
}

/**
 * 舰队按 system_id 分组计数（含 attacking 计数），按 systemId 排序保证确定性。
 * 跃迁中（transit 非空）的舰队不计入任何星系徽标——它们渲染为航线上的移动光点。
 */
export function summarizeFleetsBySystem(
  fleets: Array<Pick<FleetRuntimeView, 'system_id' | 'state' | 'transit'>>,
): FleetSystemPresence[] {
  const bySystem = new Map<string, FleetSystemPresence>();
  fleets.forEach((fleet) => {
    if (!fleet.system_id || fleet.transit) {
      return;
    }
    let presence = bySystem.get(fleet.system_id);
    if (!presence) {
      presence = { systemId: fleet.system_id, total: 0, attacking: 0 };
      bySystem.set(fleet.system_id, presence);
    }
    presence.total += 1;
    if (fleet.state === 'attacking') {
      presence.attacking += 1;
    }
  });
  return [...bySystem.values()].sort((a, b) => a.systemId.localeCompare(b.systemId));
}

/** 跃迁舰队在星图上的渲染描述（沿起止星系直线插值）。 */
export interface TransitFleetRender {
  fleetId: string;
  fromSystemId: string;
  toSystemId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** 0..1：1 - remaining/total；frozen 截图下静止于该进度。 */
  progress: number;
}

/**
 * 跃迁舰队 → 航线上移动光点的纯数据计算：
 * 位置 = lerp(from.position, to.position, 1 - remaining/total)。
 * 端点星系无坐标 / total_ticks 非法时跳过；按 fleetId 排序保证确定性。
 */
export function transitFleetRenders(
  fleets: Array<Pick<FleetRuntimeView, 'fleet_id' | 'transit'>>,
  systems: SystemRef[],
): TransitFleetRender[] {
  const positionById = new Map<string, { x: number; y: number }>();
  systems.forEach((system) => {
    if (system.position) {
      positionById.set(system.system_id, { x: system.position.x, y: system.position.y });
    }
  });
  const renders: TransitFleetRender[] = [];
  fleets.forEach((fleet) => {
    const transit = fleet.transit;
    if (!transit || transit.total_ticks <= 0) {
      return;
    }
    const from = positionById.get(transit.from_system_id);
    const to = positionById.get(transit.target_system_id);
    if (!from || !to) {
      return;
    }
    const progress = Math.min(1, Math.max(0, 1 - transit.remaining_ticks / transit.total_ticks));
    renders.push({
      fleetId: fleet.fleet_id,
      fromSystemId: transit.from_system_id,
      toSystemId: transit.target_system_id,
      from,
      to,
      progress,
    });
  });
  return renders.sort((a, b) => a.fleetId.localeCompare(b.fleetId));
}

/**
 * 战火航线筛选：只挑端点为 attacking 星系的航线，并把方向定向为
 * 从 attacking 星系向外（from=attacking 端，to=另一端）；两端都 attacking 时保持原向。
 * 返回新数组/新对象，不改传入 lanes。
 */
export function selectWarLanes(
  lanes: SystemLane[],
  attackingSystemIds: ReadonlySet<string>,
): SystemLane[] {
  const warLanes: SystemLane[] = [];
  lanes.forEach((lane) => {
    const fromHot = attackingSystemIds.has(lane.fromId);
    const toHot = attackingSystemIds.has(lane.toId);
    if (!fromHot && !toHot) {
      return;
    }
    if (fromHot || !toHot) {
      warLanes.push({ ...lane });
    } else {
      warLanes.push({ fromId: lane.toId, toId: lane.fromId, from: lane.to, to: lane.from });
    }
  });
  return warLanes;
}

// ---------- 舰队直操作（期7b） ----------

/**
 * 徽标循环点选：同一星系的舰队聚合在一个徽标后面，重复点击在该星系的
 * 舰队列表里循环（按 API 返回顺序，稳定）。列表为空返回 null。
 * 跃迁中的舰队不挂徽标（渲染为航线光点），不参与点选循环。
 */
export function pickFleetInSystem(
  fleets: Array<Pick<FleetRuntimeView, 'fleet_id' | 'system_id' | 'transit'>>,
  systemId: string,
  currentFleetId: string | null,
): string | null {
  const inSystem = fleets.filter((fleet) => fleet.system_id === systemId && !fleet.transit);
  if (inSystem.length === 0) {
    return null;
  }
  const currentIndex = inSystem.findIndex((fleet) => fleet.fleet_id === currentFleetId);
  const next = inSystem[(currentIndex + 1) % inSystem.length];
  return next?.fleet_id ?? null;
}

export type FleetAttackTargetResolution =
  | { ok: true; targetId: string }
  | { ok: false; reason: string };

/**
 * fleet_attack 目标解析：server 仅支持同星系目标，target_id 取目标行星上
 * 首个可锁定的敌方传感器接触（contact_kind=enemy_force 且带 entity_id）。
 * 没有匹配接触时本地拦截，不提交指令。
 */
export function resolveFleetAttackTarget(
  contacts: SensorContact[] | undefined,
  planetId: string,
): FleetAttackTargetResolution {
  const contact = (contacts ?? []).find(
    (item) => item.contact_kind === 'enemy_force' && item.entity_id && item.planet_id === planetId,
  );
  if (!contact?.entity_id) {
    return { ok: false, reason: '该行星没有可锁定的敌方目标' };
  }
  return { ok: true, targetId: contact.entity_id };
}

/** 舰队状态中文标签：transit 非空即跃迁中（state 保持 idle，见 server 期7c）。 */
export function fleetStateLabel(fleet: Pick<FleetRuntimeView, 'state' | 'transit'> | undefined): string {
  if (!fleet) {
    return '待命';
  }
  if (fleet.transit) {
    return '跃迁中';
  }
  return fleet.state === 'attacking' ? '交战中' : '待命';
}

export type FleetMoveTargetResolution =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * fleet_move 目标解析（本地拦截，对齐 server 校验规则）：
 * 舰队须待命且未在跃迁；目标不能是当前星系；目标与当前星系间须有航线
 * （与星图渲染同源，经 computeSystemLanes 传入）。
 */
export function resolveFleetMoveTarget(
  lanes: SystemLane[],
  fleet: Pick<FleetRuntimeView, 'system_id' | 'state' | 'transit'> | undefined,
  targetSystemId: string,
): FleetMoveTargetResolution {
  if (!fleet) {
    return { ok: false, reason: '舰队不存在或已离开' };
  }
  if (fleet.transit) {
    return { ok: false, reason: '舰队已在跃迁中' };
  }
  if (fleet.state !== 'idle') {
    return { ok: false, reason: '交战中舰队无法跃迁' };
  }
  if (targetSystemId === fleet.system_id) {
    return { ok: false, reason: '舰队已在该星系' };
  }
  const linked = lanes.some((lane) => (
    (lane.fromId === fleet.system_id && lane.toId === targetSystemId)
    || (lane.toId === fleet.system_id && lane.fromId === targetSystemId)
  ));
  if (!linked) {
    return { ok: false, reason: '目标星系与当前星系无航线连接' };
  }
  return { ok: true };
}
