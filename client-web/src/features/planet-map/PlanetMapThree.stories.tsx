import type { Meta, StoryObj } from '@storybook/react-vite';

import { PlanetMapThree } from '@/features/planet-map/PlanetMapThree';
import { type CameraView, type Fixture, FixtureStage } from '@/stories/fixtures/FixtureStage';

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
const fixture = beltDspFixture as unknown as Fixture;

/** 立交中心（铜主线 y=153 与高架铁线 x=53 的交叉格）。 */
const INTERSECTION = { x: 53, y: 153 };
/** 跨格分拣器所在格（背面扫 2 格取 (53,155) 的带尾）。 */
const SORTER = { x: 53, y: 156 };
/** 真死端带 (45,156..158)：带尾堆货、前方 (45,159) 空、无分拣器（cp-belt-dsp 补丁）。 */
const DEAD_END = { x: 45, y: 157 };

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
    render: () => <FixtureStage fixture={fixture} view={view} />,
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
