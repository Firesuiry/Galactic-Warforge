import type { Meta, StoryObj } from '@storybook/react-vite';

import { PlanetMapThree } from '@/features/planet-map/PlanetMapThree';
import { type CameraView, type Fixture, FixtureStage } from '@/stories/fixtures/FixtureStage';

import armyShowcaseFixture from '@/stories/fixtures/army-showcase-scene.json';

/**
 * 画质展示夹具（第 23 轮 3A 画质）：cp-army 基地，窗口 x 28..84、y 122..166。
 *
 * 场景要素：战场分析基站 (54,144)、电弧熔炉 (62,140)/(45,140)、装配台 (62,151)/(59,144)、
 * 矩阵研究站 (62,146)、采矿机 (57,140)/(50,140)、兵营 (53,139)、补给站 (48,143)/(41,142)、
 * 风机 ×4、电塔 ×2、传送带与分拣器若干；士兵 ×9 (50..55,135..139)、机甲 (49,134)；
 * 煤/原油/硫酸/石矿/硅矿露头与西侧岩浆。
 *
 * 机位与 `scripts/playtest-shots/cp-army.mjs` 同名同参，夹具迭代满意后再上真机同机位验一次。
 */
const fixture = armyShowcaseFixture as unknown as Fixture;

const meta = {
  title: 'Planet/ShowcaseFixture',
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

/** 厂区全景：基站、熔炉、装配台、兵营、补给站、士兵同框。 */
export const IndustryOverview: Story = storyWith({ focus: { x: 56, y: 144 }, tilt: 0.55, zoom: 0.62 });

/** 装配台特写（3×3）+ 传送带 + 分拣器。 */
export const AssemblingMachine: Story = storyWith({ focus: { x: 63, y: 150 }, tilt: 0.85, zoom: 1.7 });

/** 兵营 + 士兵队列 + 风机。 */
export const BarracksSquad: Story = storyWith({ focus: { x: 53, y: 138 }, tilt: 0.85, zoom: 1.6 });

/** 熔炉 + 采矿机 + 矿脉特写。 */
export const SmelterMiner: Story = storyWith({ focus: { x: 60, y: 140 }, tilt: 0.9, zoom: 1.8 });

/** 机甲特写（英雄单位）。 */
export const Mecha: Story = storyWith({ focus: { x: 49, y: 134 }, tilt: 0.95, zoom: 3.2 });

/** 地平线：贴地俯仰看基地、远景与天空（光照、大气、远景雾）。 */
export const Horizon: Story = storyWith({ focus: { x: 56, y: 144 }, tilt: 1.1, zoom: 0.8 });

/** 中空：高度 60，地表远景与未探索区过渡。 */
export const MidOrbit: Story = storyWith({ focus: { x: 56, y: 144 }, tilt: 1.1, zoom: 1, altitude: 60 });
