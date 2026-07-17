/**
 * 星图视图：全屏 Pixi 场景 + DOM HUD（面包屑 / 选中情报卡 / 筛选 / 操作提示）。
 * /galaxy 与 /system/:id 两个路由共用，后者通过 initialSystemId 深链聚焦。
 */

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { PixiStage } from '@/engine/PixiStage';
import { starTypeLabel } from '@/features/starmap/model';
import { StarmapScene } from '@/features/starmap/scene';
import { useStarmapViewStore } from '@/features/starmap/store';
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
  const discoveredOnly = useStarmapViewStore((state) => state.discoveredOnly);

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

  const callbacks = useMemo(() => ({
    onSelectSystem: (systemId: string | null) => {
      useStarmapViewStore.getState().select(systemId ? { kind: 'system', id: systemId } : null);
    },
    onSelectPlanet: (planetId: string | null) => {
      const systemId = focusedRef.current;
      useStarmapViewStore.getState().select(
        planetId && systemId ? { kind: 'planet', id: planetId, systemId } : null,
      );
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
  }), [navigate]);

  // 数据 → 场景
  useEffect(() => {
    sceneRef.current?.setGalaxy(galaxyQuery.data ?? null);
  }, [galaxyQuery.data]);

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

  const focusedSystem = systemQuery.data
    ?? galaxyQuery.data?.systems?.find((system) => system.system_id === focusedSystemId)
    ?? null;
  const selectedSystem = selected?.kind === 'system'
    ? galaxyQuery.data?.systems?.find((system) => system.system_id === selected.id) ?? null
    : null;
  const selectedPlanet = selected?.kind === 'planet'
    ? systemQuery.data?.planets?.find((planet) => planet.planet_id === selected.id) ?? null
    : null;

  return (
    <div className="starmap-view">
      <PixiStage
        className="starmap-stage"
        onReady={(app) => {
          const frozen = new URLSearchParams(window.location.search).has('freeze');
          const scene = new StarmapScene(app, callbacks, { frozen });
          sceneRef.current = scene;
          if (import.meta.env.DEV) {
            // 开发模式暴露给 Playwright/控制台做画布内定位
            (window as unknown as { __starmapScene?: StarmapScene }).__starmapScene = scene;
          }
          if (galaxyQuery.data) {
            scene.setGalaxy(galaxyQuery.data);
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

        <p className="starmap-hint">
          {focusedSystemId
            ? '拖拽平移 · 滚轮缩放 · 双击行星进入 · 双击空白/持续缩小返回银河'
            : '拖拽平移 · 滚轮缩放 · 单击选中 · 双击或持续放大进入恒星系'}
        </p>
      </div>
    </div>
  );
}
