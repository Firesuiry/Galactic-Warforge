import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  FleetRuntimeView,
  LandingOperationState,
  PlanetBlockadeState,
  PlanetRef,
  SensorContact,
  SystemRuntimeView,
} from '@shared/types';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 440;
const HIT_RADIUS = 16;

type MarkerKind = 'fleet' | 'contact' | 'planet';

interface BattlefieldMarker {
  id: string;
  kind: MarkerKind;
  label: string;
  x: number;
  y: number;
  tone: 'own' | 'enemy' | 'neutral';
  detail?: string;
}

export interface BattlefieldSelection {
  id: string;
  kind: MarkerKind;
  label: string;
  detail?: string;
}

interface BattlefieldMapProps {
  systemName: string;
  planets: PlanetRef[];
  runtime?: SystemRuntimeView;
  fleets: FleetRuntimeView[];
  playerId: string;
  onSelect?: (selection: BattlefieldSelection | null) => void;
}

function planetAnchor(index: number, total: number) {
  const angle = total > 1 ? (index / total) * Math.PI * 2 : 0;
  const radius = 120 + index * 36;
  return {
    x: VIEW_WIDTH / 2 + Math.cos(angle) * radius,
    y: VIEW_HEIGHT / 2 + Math.sin(angle) * radius,
  };
}

/**
 * 星系级战场态势图（Canvas 2D 示意图）。
 *
 * 把恒星、行星轨道、己方/敌方舰队接触、封锁圈、登陆行动收拢到一张图上，
 * 解决 WarPage 过去只有文字列表、玩家「看不懂战局」的问题。
 * 点击标记会选中并回传，供上层联动 FleetActionForm / TaskForceForm。
 */
export function BattlefieldMap({
  systemName,
  planets,
  runtime,
  fleets,
  playerId,
  onSelect,
}: BattlefieldMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const markersRef = useRef<BattlefieldMarker[]>([]);
  const [selection, setSelection] = useState<BattlefieldSelection | null>(null);

  const planetPositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    planets.forEach((planet, index) => {
      map.set(planet.planet_id, planetAnchor(index, planets.length));
    });
    return map;
  }, [planets]);

  const markers = useMemo<BattlefieldMarker[]>(() => {
    const result: BattlefieldMarker[] = [];
    const blockadeByPlanet = new Map(
      (runtime?.planet_blockades ?? []).map((blockade) => [blockade.planet_id, blockade]),
    );
    const landingByPlanet = new Map(
      (runtime?.landing_operations ?? []).map((landing) => [landing.planet_id, landing]),
    );

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
      result.push({
        id: planet.planet_id,
        kind: 'planet',
        label: planet.name || planet.planet_id,
        x: position.x,
        y: position.y,
        tone: blockade ? 'enemy' : 'neutral',
        detail: segments.length > 0 ? segments.join(' · ') : undefined,
      });
    });

    fleets.forEach((fleet) => {
      const anchor = planetPositions.get(runtime?.system_id === fleet.system_id ? planets[0]?.planet_id ?? '' : '');
      result.push({
        id: fleet.fleet_id,
        kind: 'fleet',
        label: fleet.fleet_id,
        x: (anchor?.x ?? VIEW_WIDTH / 2) + 28,
        y: (anchor?.y ?? VIEW_HEIGHT / 2) - 22,
        tone: fleet.owner_id === playerId ? 'own' : 'enemy',
        detail: `编队 ${fleet.formation} · ${fleet.state}`,
      });
    });

    (runtime?.contacts ?? []).forEach((contact, index) => {
      const fallback = planetPositions.get(contact.planet_id ?? '') ?? planetAnchor(index + 0.5, planets.length + 1);
      const position = contact.position
        ? {
            x: VIEW_WIDTH / 2 + Math.max(-VIEW_WIDTH / 2 + 24, Math.min(VIEW_WIDTH / 2 - 24, contact.position.x * 6)),
            y: VIEW_HEIGHT / 2 + Math.max(-VIEW_HEIGHT / 2 + 24, Math.min(VIEW_HEIGHT / 2 - 24, contact.position.y * 6)),
          }
        : { x: fallback.x + 24, y: fallback.y + 18 };
      result.push({
        id: contact.id,
        kind: 'contact',
        label: contact.classification || contact.entity_id || contact.id,
        x: position.x,
        y: position.y,
        tone: contact.contact_kind === 'fleet' ? 'neutral' : 'enemy',
        detail: `威胁 ${contact.threat_level ?? '-'} · 信号 ${Math.round((contact.signal_strength ?? 0) * 100)}%`,
      });
    });

    return result;
  }, [planets, runtime, fleets, playerId, planetPositions]);

  markersRef.current = markers;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== VIEW_WIDTH * dpr || canvas.height !== VIEW_HEIGHT * dpr) {
      canvas.width = VIEW_WIDTH * dpr;
      canvas.height = VIEW_HEIGHT * dpr;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

    context.fillStyle = '#0b1220';
    context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

    // 轨道圈
    context.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    context.lineWidth = 1;
    planets.forEach((_, index) => {
      const radius = 120 + index * 36;
      context.beginPath();
      context.arc(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, radius, 0, Math.PI * 2);
      context.stroke();
    });

    // 恒星
    context.fillStyle = '#fde68a';
    context.beginPath();
    context.arc(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, 14, 0, Math.PI * 2);
    context.fill();

    const toneColor: Record<BattlefieldMarker['tone'], string> = {
      own: '#38bdf8',
      enemy: '#f87171',
      neutral: '#cbd5e1',
    };

    markers.forEach((marker) => {
      const selected = selection?.id === marker.id;
      if (marker.kind === 'planet') {
        const blockade = marker.tone === 'enemy';
        // 封锁圈
        if (blockade) {
          context.strokeStyle = 'rgba(248, 113, 113, 0.6)';
          context.lineWidth = 2;
          context.setLineDash([6, 4]);
          context.beginPath();
          context.arc(marker.x, marker.y, 22, 0, Math.PI * 2);
          context.stroke();
          context.setLineDash([]);
        }
        context.fillStyle = blockade ? '#fca5a5' : '#94a3b8';
        context.beginPath();
        context.arc(marker.x, marker.y, 9, 0, Math.PI * 2);
        context.fill();
      } else {
        context.fillStyle = toneColor[marker.tone];
        context.beginPath();
        if (marker.kind === 'fleet') {
          // 己方/敌方舰队：方块
          context.fillRect(marker.x - 6, marker.y - 6, 12, 12);
        } else {
          // 接触：三角
          context.moveTo(marker.x, marker.y - 7);
          context.lineTo(marker.x + 7, marker.y + 5);
          context.lineTo(marker.x - 7, marker.y + 5);
          context.closePath();
          context.fill();
        }
      }
      if (selected) {
        context.strokeStyle = '#facc15';
        context.lineWidth = 2;
        context.beginPath();
        context.arc(marker.x, marker.y, HIT_RADIUS, 0, Math.PI * 2);
        context.stroke();
      }
      context.fillStyle = '#e2e8f0';
      context.font = '11px sans-serif';
      context.fillText(marker.label, marker.x + 10, marker.y - 8);
    });
  }, [markers, planets.length, selection]);

  useEffect(() => {
    draw();
  }, [draw]);

  function handle_click(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = VIEW_WIDTH / rect.width;
    const scaleY = VIEW_HEIGHT / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    const nearest = markersRef.current
      .map((marker) => ({ marker, distance: Math.hypot(marker.x - x, marker.y - y) }))
      .filter((entry) => entry.distance <= HIT_RADIUS)
      .sort((left, right) => left.distance - right.distance)[0]?.marker ?? null;

    const next: BattlefieldSelection | null = nearest
      ? { id: nearest.id, kind: nearest.kind, label: nearest.label, detail: nearest.detail }
      : null;
    setSelection(next);
    onSelect?.(next);
  }

  const superiority = runtime?.orbital_superiority;

  return (
    <article className="war-card battlefield-card">
      <h3>战场态势 · {systemName}</h3>
      <p className="subtle-text">
        {superiority
          ? `制空权：${superiority.advantage_player_id ?? '争夺中'} · ${(superiority as { contest_intensity?: number }).contest_intensity ?? 0}`
          : '尚未形成制空权'}
        {' · '}
        接触 {(runtime?.contacts ?? []).length} · 舰队 {fleets.length} · 封锁 {(runtime?.planet_blockades ?? []).length} · 登陆 {(runtime?.landing_operations ?? []).length}
      </p>
      <canvas
        ref={canvasRef}
        className="battlefield-canvas"
        style={{ width: '100%', maxWidth: VIEW_WIDTH, aspectRatio: `${VIEW_WIDTH} / ${VIEW_HEIGHT}` }}
        onClick={handle_click}
      />
      <ul className="war-list">
        <li><span style={{ color: '#38bdf8' }}>■</span> 己方舰队</li>
        <li><span style={{ color: '#f87171' }}>▲</span> 敌方接触</li>
        <li><span style={{ color: '#94a3b8' }}>●</span> 行星（红圈虚线=被封锁）</li>
      </ul>
      {selection ? (
        <p className="subtle-text">
          已选中：{selection.label}{selection.detail ? `（${selection.detail}）` : ''}
        </p>
      ) : null}
    </article>
  );
}

export type { PlanetBlockadeState, LandingOperationState, SensorContact };
