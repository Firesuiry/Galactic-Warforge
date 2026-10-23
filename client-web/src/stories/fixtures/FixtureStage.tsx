import { useEffect, useLayoutEffect } from 'react';

import { PlanetMapThree } from '@/features/planet-map/PlanetMapThree';
import { resetPlanetViewStore } from '@/features/planet-map/store';
import { resetSessionStore, useSessionStore } from '@/stores/session';

/**
 * 视觉夹具故事壳（3D 行星地图）：场景 JSON 由 `scripts/export-scene-fixture.mjs` 导出，
 * 迭代流程见 docs/guide/视觉夹具.md。各夹具故事共用本组件，保证冻结与机位口径一致。
 */
export type Fixture = {
  meta: { tick: number; window: { x: number; y: number; width: number; height: number } };
  planet: Parameters<typeof PlanetMapThree>[0]['planet'];
  catalog: Parameters<typeof PlanetMapThree>[0]['catalog'];
  runtime: Parameters<typeof PlanetMapThree>[0]['runtime'];
  networks: Parameters<typeof PlanetMapThree>[0]['networks'];
};

export type CameraView = {
  /** 镜头聚焦格。 */
  focus: { x: number; y: number };
  /** 3D 俯仰角 0..1.1（0 = 正俯视，1.1 ≈ 贴地）。 */
  tilt: number;
  /** 相对 `focus()` 默认高度的缩放系数（>1 更近）。 */
  zoom: number;
  /** 绝对相机高度（覆盖 zoom；中空 / 远景机位用）。 */
  altitude?: number;
  /**
   * 特效试验场相位（`?vfxPhase=`）：场景就绪后在固定位置注入合成特效并定格。
   * 仅夹具使用；见 `three/vfx/fixture-hooks.ts`。
   */
  vfxPhase?: 'Explosion' | 'TurretFire' | 'Construction' | 'Industry' | 'Selection';
};

type ThreeTestScene = {
  focus(tile: { x: number; y: number }, close?: boolean): void;
  setTilt(value: number): void;
  zoom(factor: number): void;
  setAltitude(altitude: number): void;
  getCenterTile(): { x: number; y: number } | null;
  vfxPhase?(phase: string, seconds?: number): number;
};

/**
 * 夹具故事壳：重置 store / 会话（p1），挂 `?freeze=1` 后渲染 3D 地图，
 * 等场景就绪后按机位聚焦并设置俯仰/缩放。
 *
 * 注意 1：镜头参数走 `window.__planetThree`（dev 构建 / VITE_E2E=1 构建才暴露）。
 * Storybook 的 dev server 与 Playwright 的 `npm run dev` webServer 都是 DEV 构建，
 * 因此两边都能拿到；纯静态 `storybook build` 产物没有这个句柄（见文档的说明）。
 *
 * 注意 2：句柄在场景构造时就挂上，但 `setData` 是之后才调用的——`focus()` 在数据
 * 到位前会直接返回。这里轮询到 `getCenterTile()` 能报出目标格（说明数据已就位、
 * 相机已按机位落位）才结束；中途重复调用是幂等的。
 */
export function FixtureStage({ fixture, view }: { fixture: Fixture; view: CameraView }) {
  // useLayoutEffect：在子组件（PlanetMapThree → PlanetThreeScene 构造）的 effect 之前
  // 把 `?freeze=1` 写进 URL，保证场景读到冻结标志。
  useLayoutEffect(() => {
    resetSessionStore();
    resetPlanetViewStore();
    useSessionStore.getState().setSession({
      serverUrl: 'fixture://scene',
      playerId: 'p1',
      playerKey: 'key_player_1',
    });
    // 冻结动画（带面滚动 / 分拣器摆动 / 水面流光）：与截图测试的 ?freeze=1 同口径。
    // 必须在 3D 场景构造**之前**写进 URL——`PlanetThreeScene` 在构造函数里读一次
    // `location.search`（private frozen 字段），挂载后再改 URL 不会生效。
    // 本组件在首次渲染的 layout effect 里设置，子组件的 effect（建场景）更晚执行。
    const url = new URL(window.location.href);
    if (!url.searchParams.has('freeze')) {
      url.searchParams.set('freeze', '1');
      window.history.replaceState(null, '', url);
    }
    return () => {
      resetPlanetViewStore();
      resetSessionStore();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let attempts = 0;
    let injected = false;
    const apply = () => {
      if (cancelled) return;
      const scene = (window as unknown as { __planetThree?: ThreeTestScene }).__planetThree;
      const center = scene?.getCenterTile();
      if (scene && center) {
        scene.focus(view.focus, true);
        scene.setTilt(view.tilt);
        if (view.altitude != null) scene.setAltitude(view.altitude);
        else if (view.zoom !== 1) scene.zoom(view.zoom);
        const landed = scene.getCenterTile();
        // `focus()` 落位后 getCenterTile() 是取整后的格；机位焦点允许带小数（如 56.5），
        // 按容差比较，否则非整数焦点的故事永远等不到「落位」、vfxPhase 注入不了。
        if (landed && Math.abs(view.focus.x - landed.x) <= 0.75 && Math.abs(view.focus.y - landed.y) <= 0.75) {
          // 机位落位后注入特效试验场相位（只做一次；scene 内部按固定相位定格）。
          if (view.vfxPhase && !injected) {
            injected = true;
            scene.vfxPhase?.(view.vfxPhase);
          }
          return;
        }
      }
      attempts += 1;
      if (attempts < 200) timer = window.setTimeout(apply, 100);
    };
    apply();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [view]);

  return (
    <div className="belt-fixture-stage" style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <PlanetMapThree
        planet={fixture.planet}
        catalog={fixture.catalog}
        runtime={fixture.runtime}
        networks={fixture.networks}
      />
    </div>
  );
}
