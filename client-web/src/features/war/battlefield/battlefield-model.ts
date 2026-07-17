/**
 * 战场态势图布局纯函数：从 SystemRuntimeView 等数据推导视口坐标与命中判定。
 *
 * 数据没有真实坐标，这里保留旧 Canvas 版的"示意图布局"语义：
 * - 行星按 planetAnchor 圆周排布（半径 120 + index*36）
 * - 舰队锚定到本星系第一个行星旁（+28, -22）
 * - contact 用 position×6 钳位到视口内，缺 position 时回落到行星锚点附近
 *
 * 全部不依赖 Pixi，供 battlefield-scene 渲染与 vitest 单测共用。
 */

import type {
  FleetRuntimeView,
  PlanetRef,
  SensorContact,
  SystemRuntimeView,
} from '@shared/types';

export const BATTLEFIELD_VIEW_WIDTH = 640;
export const BATTLEFIELD_VIEW_HEIGHT = 440;
export const BATTLEFIELD_HIT_RADIUS = 16;

export type BattlefieldMarkerKind = 'fleet' | 'contact' | 'planet';
export type BattlefieldMarkerTone = 'own' | 'enemy' | 'neutral';

export interface BattlefieldMarkerLayout {
  id: string;
  kind: BattlefieldMarkerKind;
  label: string;
  x: number;
  y: number;
  tone: BattlefieldMarkerTone;
  detail?: string;
  /** 行星被封锁时画虚线环。 */
  blockaded?: boolean;
  /** 行星 kind（terrestrial/lava 等），供场景按星图同款配色取色。 */
  planetKind?: string;
  /** contact.entity_id：战斗事件 payload 里的 target_id 指向它，供特效定位。 */
  entityId?: string;
}

export interface BattlefieldLayoutInput {
  planets: PlanetRef[];
  runtime?: SystemRuntimeView;
  fleets: FleetRuntimeView[];
  playerId: string;
}

export interface BattlefieldPoint {
  x: number;
  y: number;
}

/** 点击命中/回显用的选中项（DOM「已选中」回显与场景高亮环共用）。 */
export interface BattlefieldSelection {
  id: string;
  kind: BattlefieldMarkerKind;
  label: string;
  detail?: string;
}

export function planetAnchor(index: number, total: number): BattlefieldPoint {
  const angle = total > 1 ? (index / total) * Math.PI * 2 : 0;
  const radius = 120 + index * 36;
  return {
    x: BATTLEFIELD_VIEW_WIDTH / 2 + Math.cos(angle) * radius,
    y: BATTLEFIELD_VIEW_HEIGHT / 2 + Math.sin(angle) * radius,
  };
}

function clampToView(value: number, center: number, half: number): number {
  return center + Math.max(-half + 24, Math.min(half - 24, value));
}

/** contact 视口坐标：position×6 钳位；无 position 时回落行星锚点/圆周补位。 */
export function contactAnchor(
  contact: SensorContact,
  index: number,
  planets: PlanetRef[],
  planetPositions: Map<string, BattlefieldPoint>,
): BattlefieldPoint {
  if (contact.position) {
    return {
      x: clampToView(contact.position.x * 6, BATTLEFIELD_VIEW_WIDTH / 2, BATTLEFIELD_VIEW_WIDTH / 2),
      y: clampToView(contact.position.y * 6, BATTLEFIELD_VIEW_HEIGHT / 2, BATTLEFIELD_VIEW_HEIGHT / 2),
    };
  }
  const fallback = planetPositions.get(contact.planet_id ?? '')
    ?? planetAnchor(index + 0.5, planets.length + 1);
  return { x: fallback.x + 24, y: fallback.y + 18 };
}

export function layoutBattlefieldMarkers(input: BattlefieldLayoutInput): BattlefieldMarkerLayout[] {
  const { planets, runtime, fleets, playerId } = input;
  const planetPositions = new Map<string, BattlefieldPoint>();
  planets.forEach((planet, index) => {
    planetPositions.set(planet.planet_id, planetAnchor(index, planets.length));
  });

  const blockadeByPlanet = new Map(
    (runtime?.planet_blockades ?? []).map((blockade) => [blockade.planet_id, blockade]),
  );
  const landingByPlanet = new Map(
    (runtime?.landing_operations ?? []).map((landing) => [landing.planet_id, landing]),
  );

  const markers: BattlefieldMarkerLayout[] = [];

  planets.forEach((planet, index) => {
    const position = planetPositions.get(planet.planet_id) ?? planetAnchor(index, planets.length);
    const blockade = blockadeByPlanet.get(planet.planet_id);
    const landing = landingByPlanet.get(planet.planet_id);
    const segments: string[] = [];
    if (blockade) {
      segments.push(`封锁 ${blockade.status}`);
    }
    if (landing) {
      segments.push(`登陆 ${landing.stage}`);
    }
    markers.push({
      id: planet.planet_id,
      kind: 'planet',
      label: planet.name || planet.planet_id,
      x: position.x,
      y: position.y,
      tone: blockade ? 'enemy' : 'neutral',
      detail: segments.length > 0 ? segments.join(' · ') : undefined,
      blockaded: Boolean(blockade),
      planetKind: planet.kind,
    });
  });

  fleets.forEach((fleet) => {
    const sameSystem = runtime?.system_id === fleet.system_id;
    const anchor = planetPositions.get(sameSystem ? planets[0]?.planet_id ?? '' : '');
    markers.push({
      id: fleet.fleet_id,
      kind: 'fleet',
      label: fleet.fleet_id,
      x: (anchor?.x ?? BATTLEFIELD_VIEW_WIDTH / 2) + 28,
      y: (anchor?.y ?? BATTLEFIELD_VIEW_HEIGHT / 2) - 22,
      tone: fleet.owner_id === playerId ? 'own' : 'enemy',
      detail: `编队 ${fleet.formation} · ${fleet.state}`,
    });
  });

  (runtime?.contacts ?? []).forEach((contact, index) => {
    const position = contactAnchor(contact, index, planets, planetPositions);
    markers.push({
      id: contact.id,
      kind: 'contact',
      label: contact.classification || contact.entity_id || contact.id,
      x: position.x,
      y: position.y,
      tone: contact.contact_kind === 'fleet' ? 'neutral' : 'enemy',
      detail: `威胁 ${contact.threat_level ?? '-'} · 信号 ${Math.round((contact.signal_strength ?? 0) * 100)}%`,
      entityId: contact.entity_id,
    });
  });

  return markers;
}

/** 最近距离命中：返回半径内离 (x, y) 最近的标记。 */
export function hitTestBattlefieldMarker(
  markers: readonly BattlefieldMarkerLayout[],
  x: number,
  y: number,
  radius = BATTLEFIELD_HIT_RADIUS,
): BattlefieldMarkerLayout | null {
  let best: { marker: BattlefieldMarkerLayout; distance: number } | null = null;
  for (const marker of markers) {
    const distance = Math.hypot(marker.x - x, marker.y - y);
    if (distance <= radius && (!best || distance < best.distance)) {
      best = { marker, distance };
    }
  }
  return best?.marker ?? null;
}

/**
 * 把战斗事件 payload 里的实体 id（fleet_id / target_id / planet_id / contact.entity_id）
 * 解析到标记视口坐标；匹配不到返回 null（特效直接跳过，不做猜测性演出）。
 */
export function resolveBattlefieldEntityPosition(
  markers: readonly BattlefieldMarkerLayout[],
  entityId: string | undefined | null,
): BattlefieldPoint | null {
  if (!entityId) {
    return null;
  }
  const marker = markers.find((entry) => entry.id === entityId || entry.entityId === entityId);
  return marker ? { x: marker.x, y: marker.y } : null;
}

/** 离 (x, y) 最近的敌对阵营标记（敌方导弹齐射的发射方不在事件 payload 里，用它近似弹道起点）。 */
export function nearestHostileMarkerPosition(
  markers: readonly BattlefieldMarkerLayout[],
  x: number,
  y: number,
): BattlefieldPoint | null {
  let best: { marker: BattlefieldMarkerLayout; distance: number } | null = null;
  for (const marker of markers) {
    if (marker.tone !== 'enemy') {
      continue;
    }
    const distance = Math.hypot(marker.x - x, marker.y - y);
    if (!best || distance < best.distance) {
      best = { marker, distance };
    }
  }
  return best ? { x: best.marker.x, y: best.marker.y } : null;
}
