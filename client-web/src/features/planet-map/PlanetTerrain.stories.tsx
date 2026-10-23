import type { Meta, StoryObj } from '@storybook/react-vite';

import { PlanetMapThree } from '@/features/planet-map/PlanetMapThree';
import { type CameraView, type Fixture, FixtureStage } from '@/stories/fixtures/FixtureStage';

import terrainFixture from '@/stories/fixtures/terrain-showcase-scene.json';

/**
 * 地表夹具（第 23 轮 3A 画质地表分支，feat/3a-terrain）：**只用于迭代，不能当验收图**。
 *
 * 数据由 `army-showcase-scene.json` 派生：只改 terrain / explored / visible / resources，
 * 叠加合成地形（坐标见 tmp/plan.md 第 2 步）——
 * - 湖（water）：(x-75)²+(y-143)² ≤ 5.5² ∪ (x-71)²+(y-147)² ≤ 2.5²；
 * - 岩浆（lava）：(x-38)²+(y-132)² ≤ 3.2²；
 * - 岩脊（blocked）：到线段 (60,124)–(72,130) 距离 ≤ 1.6 的格；
 * 改动格一律 explored/visible = true，落在地形上的资源点已删除；建筑与单位未改动。
 *
 * 验收图必须用 `Planet/ShowcaseFixture`（真实服务端数据）与真机 cp-army 固定机位。
 */
const fixture = terrainFixture as unknown as Fixture;

const meta = {
  title: 'Planet/TerrainFixture',
  component: PlanetMapThree,
  args: {
    planet: fixture.planet,
    catalog: fixture.catalog,
    runtime: fixture.runtime,
    networks: fixture.networks,
  },
  parameters: {
    layout: 'fullscreen',
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

/** 湖岸：水面深浅、菲涅尔反射、岸边泡沫与沙泥过渡。 */
export const TerrainCoast: Story = storyWith({ focus: { x: 74, y: 143 }, tilt: 0.95, zoom: 1.3 });

/** 岩浆池：自发光、冷却硬壳裂纹、周边焦土与受热地面。 */
export const TerrainLava: Story = storyWith({ focus: { x: 38, y: 132 }, tilt: 0.9, zoom: 1.7 });

/** 岩脊：blocked 玄武岩露头 + 扫描岩石实例，与可建造地的交界。 */
export const TerrainRocks: Story = storyWith({ focus: { x: 66, y: 127 }, tilt: 1.0, zoom: 1.4 });

/** 草地：苔草 / 火山土 / 碎石混合的贴地特写与草丛密度。 */
export const TerrainMeadow: Story = storyWith({ focus: { x: 44, y: 128 }, tilt: 1.05, zoom: 2.0 });

/** 矿点：铁/铜/煤/石矿的露头造型（扫描岩石网格 + 金属闪点）。 */
export const TerrainOre: Story = storyWith({ focus: { x: 55, y: 139 }, tilt: 1.0, zoom: 1.6 });
