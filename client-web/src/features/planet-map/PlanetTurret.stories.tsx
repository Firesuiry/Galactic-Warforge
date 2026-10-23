import type { Meta, StoryObj } from '@storybook/react-vite';

import { PlanetMapThree } from '@/features/planet-map/PlanetMapThree';
import { type CameraView, type Fixture, FixtureStage } from '@/stories/fixtures/FixtureStage';

import turretFixture from '@/stories/fixtures/turret-showcase-scene.json';

/**
 * 炮塔夹具（第 23 轮 3A models）：army-showcase 场景 + 5 种炮塔各一座。
 *
 * 炮塔位置：gauss (59,147)、laser (60,142)、missile (52,147)、plasma (56,149)、anti_air (56,138)。
 * 用途：核对 Sketchfab 炮塔模型的轮廓、`turret-barrel` 朝向（场景按最近敌人写 rotation.y）
 * 与同屏色调；真机验收用 `cp-army` 与 `cp-post-attack` 的固定机位。
 */
const fixture = turretFixture as unknown as Fixture;

const meta = {
  title: 'Planet/TurretFixture',
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

/** 五种炮塔 + 基地同框（中景）。 */
export const TurretsOverview: Story = storyWith({ focus: { x: 56, y: 144 }, tilt: 0.7, zoom: 1.1 });

/** 高斯炮特写。 */
export const Gauss: Story = storyWith({ focus: { x: 59, y: 147 }, tilt: 0.9, zoom: 2.6 });

/** 激光炮特写。 */
export const Laser: Story = storyWith({ focus: { x: 60, y: 142 }, tilt: 0.9, zoom: 2.6 });

/** 导弹塔特写。 */
export const Missile: Story = storyWith({ focus: { x: 52, y: 147 }, tilt: 0.9, zoom: 2.6 });

/** 等离子炮特写。 */
export const Plasma: Story = storyWith({ focus: { x: 56, y: 149 }, tilt: 0.9, zoom: 2.6 });

/** 防空炮特写。 */
export const AntiAir: Story = storyWith({ focus: { x: 56, y: 138 }, tilt: 0.9, zoom: 2.6 });
