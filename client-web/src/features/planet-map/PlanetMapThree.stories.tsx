import { useEffect, useLayoutEffect } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { PlanetMapThree } from '@/features/planet-map/PlanetMapThree';
import { resetPlanetViewStore } from '@/features/planet-map/store';
import { resetSessionStore, useSessionStore } from '@/stores/session';

import beltDspFixture from '@/stories/fixtures/belt-dsp-scene.json';

/**
 * 视觉夹具（第 19 轮）：不起服务端、不读档，直接用从试玩环境导出的场景 JSON
 * 渲染 3D 行星地图。数据由 `scripts/export-scene-fixture.mjs` 产出，
 * 迭代流程见 docs/guide/视觉夹具.md。
 *
 * 夹具内容：cp-belt-dsp 的立体交叉物流场景（铜主线 / 侧汇支带 / 1 层高架铁线 /
 * 跨格分拣器 / 补给站 / 风机 / 电塔），窗口 x 40..63、y 140..163。
 *
 * 机位（`?freeze=1` 冻结动画相位，截图确定）：
 * - `BeltDspTop`：俯视全景，看整条立体交叉的布局；
 * - `BeltDspOblique`：立交斜视（tilt≈1.0，拉近），看高架跨过地面带；
 * - `BeltDspSorter`：跨格分拣器特写（(53,157) 隔一格取货）。
 */
type Fixture = {
  meta: { tick: number; window: { x: number; y: number; width: number; height: number } };
  planet: Parameters<typeof PlanetMapThree>[0]['planet'];
  catalog: Parameters<typeof PlanetMapThree>[0]['catalog'];
  runtime: Parameters<typeof PlanetMapThree>[0]['runtime'];
  networks: Parameters<typeof PlanetMapThree>[0]['networks'];
};

const fixture = beltDspFixture as unknown as Fixture;

/** 立交中心（铜主线 y=153 与高架铁线 x=53 的交叉格）。 */
const INTERSECTION = { x: 53, y: 153 };
/** 跨格分拣器所在格（背面扫 2 格取 (53,155) 的带尾）。 */
const SORTER = { x: 53, y: 156 };
/** 真死端带 (45,156..158)：带尾堆货、前方 (45,159) 空、无分拣器（cp-belt-dsp 补丁）。 */
const DEAD_END = { x: 45, y: 157 };

type CameraView = {
  /** 镜头聚焦格。 */
  focus: { x: number; y: number };
  /** 3D 俯仰角 0..1.1（0 = 正俯视，1.1 ≈ 贴地）。 */
  tilt: number;
  /** 相对 `focus()` 默认高度的缩放系数（>1 更近）。 */
  zoom: number;
};

type ThreeTestScene = {
  focus(tile: { x: number; y: number }, close?: boolean): void;
  setTilt(value: number): void;
  zoom(factor: number): void;
  getCenterTile(): { x: number; y: number } | null;
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
function BeltDspStage({ view }: { view: CameraView }) {
  // useLayoutEffect：在子组件（PlanetMapThree → PlanetThreeScene 构造）的 effect 之前
  // 把 `?freeze=1` 写进 URL，保证场景读到冻结标志。
  useLayoutEffect(() => {
    resetSessionStore();
    resetPlanetViewStore();
    useSessionStore.getState().setSession({
      serverUrl: 'fixture://belt-dsp',
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
    const apply = () => {
      if (cancelled) return;
      const scene = (window as unknown as { __planetThree?: ThreeTestScene }).__planetThree;
      const center = scene?.getCenterTile();
      if (scene && center) {
        scene.focus(view.focus, true);
        scene.setTilt(view.tilt);
        if (view.zoom !== 1) scene.zoom(view.zoom);
        const landed = scene.getCenterTile();
        if (landed && landed.x === view.focus.x && landed.y === view.focus.y) {
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

const meta = {
  title: 'Planet/BeltDspFixture',
  component: PlanetMapThree,
  args: {
    planet: fixture.planet,
    catalog: fixture.catalog,
    runtime: fixture.runtime,
    networks: fixture.networks,
  },
  parameters: {
    layout: 'fullscreen',
    // 视觉夹具是固定机位截图：背景与页面同色，避免裁切边缘出现色差。
    backgrounds: { default: 'deep-space' },
  },
} satisfies Meta<typeof PlanetMapThree>;

export default meta;

type Story = StoryObj<typeof meta>;

function storyWith(view: CameraView): Story {
  return {
    render: () => <BeltDspStage view={view} />,
  };
}

/** 俯视全景：整条立体交叉（铜主线 / 侧汇 / 高架铁线 / 补给站）都在画面里。 */
export const BeltDspTop: Story = storyWith({ focus: INTERSECTION, tilt: 0.15, zoom: 1 });

/** 立交斜视：贴近地面看高架铁线跨过铜主线，落坡与跨格分拣器同框。 */
export const BeltDspOblique: Story = storyWith({ focus: INTERSECTION, tilt: 1.0, zoom: 2 });

/** 跨格分拣器特写：(53,157) 背面扫 2 格取 (53,155) 带尾、正面放进 (52,158)。 */
export const BeltDspSorter: Story = storyWith({ focus: SORTER, tilt: 0.8, zoom: 1.8 });

/** 真死端带特写：(45,156..158) 向南，带尾堆铜锭、前方 (45,159) 空，无分拣器消化。 */
export const BeltDspDeadEnd: Story = storyWith({ focus: DEAD_END, tilt: 0.9, zoom: 2 });
