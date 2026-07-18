/**
 * 星图视图：全屏 Pixi 场景 + DOM HUD（面包屑 / 选中情报卡 / 筛选 / 操作提示）。
 * /galaxy 与 /system/:id 两个路由共用，后者通过 initialSystemId 深链聚焦。
 */

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { PixiStage } from '@/engine/PixiStage';
import { FleetSelectionBar } from '@/features/starmap/FleetSelectionBar';
import {
  computeSystemLanes,
  pickFleetInSystem,
  resolveFleetAttackTarget,
  resolveFleetMoveTarget,
  starTypeLabel,
} from '@/features/starmap/model';
import { StarmapScene } from '@/features/starmap/scene';
import { useStarmapViewStore } from '@/features/starmap/store';
import { useStarmapNotify } from '@/features/starmap/use-starmap-notify';
import { useWarCommand } from '@/features/war/use-war-command';
import { useApiClient } from '@/hooks/use-api-client';
import { useSessionSnapshot } from '@/hooks/use-session';
import { translatePlanetKind } from '@/i18n/translate';

interface StarmapViewProps {
  /** 深链：挂载后立即聚焦的恒星系。 */
  initialSystemId?: string;
}

export function StarmapView({ initialSystemId }: StarmapViewProps) {
  const client = useApiClient();
  const session = useSessionSnapshot();
  const navigate = useNavigate();

  const focusedSystemId = useStarmapViewStore((state) => state.focusedSystemId);
  const selected = useStarmapViewStore((state) => state.selected);
  const selectedFleetId = useStarmapViewStore((state) => state.selectedFleetId);
  const interactionMode = useStarmapViewStore((state) => state.interactionMode);
  const discoveredOnly = useStarmapViewStore((state) => state.discoveredOnly);

  const scope = useMemo(
    () => ({ serverUrl: session.serverUrl, playerId: session.playerId }),
    [session.serverUrl, session.playerId],
  );
  const { runCommand, notify, feedbacks, isPending } = useWarCommand();

  // 星图路由的 SSE 通知桥（跃迁开始/到达等 toast 在星图上也能弹出）
  useStarmapNotify(session.serverUrl, session.playerKey);

  const sceneRef = useRef<StarmapScene | null>(null);
  const focusedRef = useRef(focusedSystemId);
  focusedRef.current = focusedSystemId;

  // 深链：/system/:id 直接进入该系
  useEffect(() => {
    if (initialSystemId) {
      useStarmapViewStore.getState().focusSystem(initialSystemId);
    }
    return () => {
      useStarmapViewStore.getState().exitToGalaxy();
      useStarmapViewStore.getState().selectFleet(null);
    };
  }, [initialSystemId]);

  const galaxyQuery = useQuery({
    queryKey: ['galaxy', session.serverUrl, session.playerId],
    queryFn: () => client.fetchGalaxy(),
  });

  const systemQuery = useQuery({
    queryKey: ['system', session.serverUrl, session.playerId, focusedSystemId],
    queryFn: () => client.fetchSystem(focusedSystemId!),
    enabled: Boolean(focusedSystemId),
  });

  // 舰队数据 → 星图徽标/战火航线/跃迁光点：与 WarPage 同一 query key/函数（共享缓存，不发新请求）；
  // 路由均在 RequireSession 之下，enabled 条件与 war 页一致（始终启用）。
  // 星图路由下没有 war SSE 实时层，加 2s 轮询让跃迁进度（remaining_ticks）持续推进。
  const fleetsQuery = useQuery({
    queryKey: ['war-fleets', session.serverUrl, session.playerId],
    queryFn: () => client.fetchFleets(),
    refetchInterval: 2000,
  });

  // attack 模式需要目标行星上的传感器接触（system-runtime 查询与 war 页共享缓存）
  const systemRuntimeQuery = useQuery({
    queryKey: ['system-runtime', session.serverUrl, session.playerId, focusedSystemId],
    queryFn: () => client.fetchSystemRuntime(focusedSystemId!),
    enabled: Boolean(focusedSystemId) && interactionMode.kind === 'attack',
  });

  // move 模式的本地航线校验图：与场景渲染同一套 k 近邻航线（含仅看已发现过滤）
  const galaxyLanes = useMemo(
    () => computeSystemLanes(
      (galaxyQuery.data?.systems ?? []).filter((system) => (
        system.position && (!discoveredOnly || system.discovered)
      )),
    ),
    [galaxyQuery.data, discoveredOnly],
  );

  // 回调用 ref 取最新数据（callbacks useMemo 保持稳定，避免重建 scene）
  const fleetsRef = useRef(fleetsQuery.data);
  fleetsRef.current = fleetsQuery.data;
  const systemRuntimeRef = useRef(systemRuntimeQuery.data);
  systemRuntimeRef.current = systemRuntimeQuery.data;
  const lanesRef = useRef(galaxyLanes);
  lanesRef.current = galaxyLanes;
  const commandRef = useRef({ runCommand, notify });
  commandRef.current = { runCommand, notify };

  const callbacks = useMemo(() => ({
    onSelectSystem: (systemId: string | null) => {
      const state = useStarmapViewStore.getState();
      const mode = state.interactionMode;
      // move 模式：点星系 → 本地校验航线后下达 fleet_move
      if (systemId && mode.kind === 'move') {
        const fleet = (fleetsRef.current ?? []).find((item) => item.fleet_id === mode.fleetId);
        const resolution = resolveFleetMoveTarget(lanesRef.current, fleet, systemId);
        if (!resolution.ok) {
          commandRef.current.notify('reports', { tone: 'warning', title: resolution.reason });
          return;
        }
        commandRef.current.runCommand({
          section: 'reports',
          invalidateKeys: [['war-fleets', scope.serverUrl, scope.playerId]],
          execute: () => client.cmdFleetMove(mode.fleetId, systemId),
        });
        state.exitInteractionMode();
        return;
      }
      state.select(systemId ? { kind: 'system', id: systemId } : null);
    },
    onSelectPlanet: (planetId: string | null) => {
      const state = useStarmapViewStore.getState();
      const mode = state.interactionMode;
      const systemId = focusedRef.current;
      // attack 模式：点行星 → 组装 fleet_attack（server 仅支持同星系目标）
      if (planetId && mode.kind === 'attack' && systemId) {
        const fleet = (fleetsRef.current ?? []).find((item) => item.fleet_id === mode.fleetId);
        if (!fleet || fleet.system_id !== systemId) {
          commandRef.current.notify('reports', {
            tone: 'warning',
            title: '舰队不在当前星系，无法下达攻击',
          });
          state.exitInteractionMode();
          return;
        }
        const resolution = resolveFleetAttackTarget(systemRuntimeRef.current?.contacts, planetId);
        if (!resolution.ok) {
          commandRef.current.notify('reports', { tone: 'warning', title: resolution.reason });
          return;
        }
        commandRef.current.runCommand({
          section: 'reports',
          invalidateKeys: [
            ['war-fleets', scope.serverUrl, scope.playerId],
            ['system-runtime', scope.serverUrl, scope.playerId, systemId],
          ],
          execute: () => client.cmdFleetAttack(fleet.fleet_id, planetId, resolution.targetId),
        });
        state.exitInteractionMode();
        return;
      }
      state.select(planetId && systemId ? { kind: 'planet', id: planetId, systemId } : null);
    },
    onSelectFleet: (systemId: string | null) => {
      const state = useStarmapViewStore.getState();
      if (!systemId) {
        state.selectFleet(null);
        return;
      }
      state.selectFleet(pickFleetInSystem(fleetsRef.current ?? [], systemId, state.selectedFleetId));
    },
    onEnterSystem: (systemId: string) => {
      useStarmapViewStore.getState().focusSystem(systemId);
    },
    onExitToGalaxy: () => {
      useStarmapViewStore.getState().exitToGalaxy();
    },
    onOpenPlanet: (planetId: string) => {
      navigate(`/planet/${planetId}`);
    },
  }), [client, navigate, scope]);

  // 数据 → 场景
  useEffect(() => {
    sceneRef.current?.setGalaxy(galaxyQuery.data ?? null);
  }, [galaxyQuery.data]);

  useEffect(() => {
    sceneRef.current?.setFleets(fleetsQuery.data ?? null);
  }, [fleetsQuery.data]);

  useEffect(() => {
    sceneRef.current?.setDiscoveredOnly(discoveredOnly);
  }, [discoveredOnly]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }
    if (focusedSystemId) {
      scene.showSystem(focusedSystemId, systemQuery.data ?? null);
    } else {
      scene.showGalaxy();
    }
    // 仅响应焦点切换；system 数据到达走下面的 updateSystem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedSystemId]);

  useEffect(() => {
    if (systemQuery.data) {
      sceneRef.current?.updateSystem(systemQuery.data);
    }
  }, [systemQuery.data]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }
    scene.setSelectedSystem(selected?.kind === 'system' ? selected.id : null);
    scene.setSelectedPlanet(selected?.kind === 'planet' ? selected.id : null);
  }, [selected]);

  // 直选舰队 → 徽标高亮环（徽标按星系聚合，传所在星系 id）
  const selectedFleet = useMemo(
    () => (fleetsQuery.data ?? []).find((fleet) => fleet.fleet_id === selectedFleetId) ?? null,
    [fleetsQuery.data, selectedFleetId],
  );

  useEffect(() => {
    sceneRef.current?.setSelectedFleet(selectedFleet?.system_id ?? null);
  }, [selectedFleet]);

  // 舰队数据刷新后选中舰队已不存在（解散/战损）→ 自动取消选中
  useEffect(() => {
    if (selectedFleetId && fleetsQuery.data && !selectedFleet) {
      useStarmapViewStore.getState().selectFleet(null);
    }
  }, [selectedFleetId, fleetsQuery.data, selectedFleet]);

  // Esc：先退交互模式，再取消舰队选中（对齐行星页范式）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      const state = useStarmapViewStore.getState();
      if (state.interactionMode.kind !== 'inspect') {
        state.exitInteractionMode();
      } else if (state.selectedFleetId) {
        state.selectFleet(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const focusedSystem = systemQuery.data
    ?? galaxyQuery.data?.systems?.find((system) => system.system_id === focusedSystemId)
    ?? null;
  const selectedSystem = selected?.kind === 'system'
    ? galaxyQuery.data?.systems?.find((system) => system.system_id === selected.id) ?? null
    : null;
  const selectedPlanet = selected?.kind === 'planet'
    ? systemQuery.data?.planets?.find((planet) => planet.planet_id === selected.id) ?? null
    : null;
  const selectedFleetSystemName = selectedFleet
    ? galaxyQuery.data?.systems?.find((system) => system.system_id === selectedFleet.system_id)?.name
      || selectedFleet.system_id
    : '';

  return (
    <div
      className="starmap-view"
      onContextMenu={(event) => {
        // 右键：退交互模式/取消舰队选中（仅在有状态可取消时拦截系统菜单）
        const state = useStarmapViewStore.getState();
        if (state.interactionMode.kind === 'inspect' && !state.selectedFleetId) {
          return;
        }
        event.preventDefault();
        if (state.interactionMode.kind !== 'inspect') {
          state.exitInteractionMode();
        } else {
          state.selectFleet(null);
        }
      }}
    >
      <PixiStage
        className="starmap-stage"
        onReady={(app) => {
          const frozen = new URLSearchParams(window.location.search).has('freeze');
          const scene = new StarmapScene(app, callbacks, { frozen });
          sceneRef.current = scene;
          if (import.meta.env.DEV) {
            // 开发模式暴露给 Playwright/控制台做画布内定位与交互状态检查
            (window as unknown as { __starmapScene?: StarmapScene }).__starmapScene = scene;
            (window as unknown as { __starmapViewStore?: typeof useStarmapViewStore }).__starmapViewStore
              = useStarmapViewStore;
          }
          if (galaxyQuery.data) {
            scene.setGalaxy(galaxyQuery.data);
          }
          if (fleetsQuery.data) {
            scene.setFleets(fleetsQuery.data);
          }
          const focus = useStarmapViewStore.getState().focusedSystemId;
          if (focus) {
            scene.showSystem(focus, null);
          }
          return () => {
            sceneRef.current = null;
            scene.destroy();
          };
        }}
      />

      <div className="starmap-hud">
        <div className="starmap-hud__top">
          <nav className="starmap-breadcrumb" aria-label="星图层级">
            <button
              className="starmap-breadcrumb__link"
              type="button"
              onClick={() => useStarmapViewStore.getState().exitToGalaxy()}
            >
              {galaxyQuery.data?.name || '银河'}
            </button>
            {focusedSystem ? (
              <>
                <span className="starmap-breadcrumb__sep">/</span>
                <span className="starmap-breadcrumb__current">
                  {focusedSystem.name || focusedSystem.system_id}
                </span>
              </>
            ) : null}
          </nav>

          <label className="starmap-filter">
            <input
              type="checkbox"
              checked={discoveredOnly}
              onChange={(event) => {
                useStarmapViewStore.getState().setDiscoveredOnly(event.target.checked);
              }}
            />
            仅看已发现
          </label>
        </div>

        {selectedSystem ? (
          <section className="starmap-card" data-testid="starmap-system-card">
            <header>
              <h2>{selectedSystem.discovered ? (selectedSystem.name || selectedSystem.system_id) : '未探明星系'}</h2>
              <span className="starmap-card__tag">
                {starTypeLabel(typeof selectedSystem.star?.type === 'string' ? selectedSystem.star.type : undefined)}
              </span>
            </header>
            <dl>
              <div>
                <dt>状态</dt>
                <dd>{selectedSystem.discovered ? '已发现' : '未发现'}</dd>
              </div>
              <div>
                <dt>坐标</dt>
                <dd>
                  {selectedSystem.position
                    ? `${Math.round(selectedSystem.position.x)}, ${Math.round(selectedSystem.position.y)}`
                    : '未知'}
                </dd>
              </div>
            </dl>
            {selectedSystem.discovered ? (
              <div className="starmap-card__actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => useStarmapViewStore.getState().focusSystem(selectedSystem.system_id)}
                >
                  进入星系
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {selectedPlanet && focusedSystemId ? (
          <section className="starmap-card" data-testid="starmap-planet-card">
            <header>
              <h2>{selectedPlanet.discovered ? (selectedPlanet.name || selectedPlanet.planet_id) : '未探明行星'}</h2>
              <span className="starmap-card__tag">{translatePlanetKind(selectedPlanet.kind)}</span>
            </header>
            <dl>
              <div>
                <dt>卫星</dt>
                <dd>{selectedPlanet.moon_count ?? 0}</dd>
              </div>
              <div>
                <dt>轨道</dt>
                <dd>
                  {selectedPlanet.orbit
                    ? `${selectedPlanet.orbit.distance_au.toFixed(2)} AU`
                    : '未知'}
                </dd>
              </div>
            </dl>
            {selectedPlanet.discovered ? (
              <div className="starmap-card__actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => navigate(`/planet/${selectedPlanet.planet_id}`)}
                >
                  进入行星
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {selectedFleet ? (
          <FleetSelectionBar
            fleet={selectedFleet}
            systemName={selectedFleetSystemName}
            resolveSystemName={(systemId) => (
              galaxyQuery.data?.systems?.find((system) => system.system_id === systemId)?.name || systemId
            )}
            scope={scope}
            runCommand={runCommand}
            feedbacks={feedbacks}
            isPending={isPending}
          />
        ) : null}

        <p className="starmap-hint">
          {interactionMode.kind === 'attack'
            ? '攻击模式：点击行星下达攻击指令 · Esc/右键取消'
            : interactionMode.kind === 'move'
              ? '跃迁模式：点击目标星系下达跃迁指令（需航线连接） · Esc/右键取消'
              : selectedFleetId
                ? '已选中舰队：底部情境条下达指令 · Esc/右键/点空地取消'
                : focusedSystemId
                  ? '拖拽平移 · 滚轮缩放 · 双击行星进入 · 双击空白/持续缩小返回银河'
                  : '拖拽平移 · 滚轮缩放 · 单击选中 · 双击或持续放大进入恒星系'}
        </p>
      </div>
    </div>
  );
}
