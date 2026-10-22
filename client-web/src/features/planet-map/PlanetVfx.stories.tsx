import type { Meta, StoryObj } from '@storybook/react-vite';

import { PlanetMapThree } from '@/features/planet-map/PlanetMapThree';
import { type CameraView, type Fixture, FixtureStage } from '@/stories/fixtures/FixtureStage';

import armyShowcaseFixture from '@/stories/fixtures/army-showcase-scene.json';

/**
 * 特效试验场（3A 画质 vfx 分支）：复用 `Planet/ShowcaseFixture` 的 cp-army 基地场景，
 * 用测试钩子（`window.__planetThree.vfxPhase`，仅 dev 构建）在**固定位置**注入合成特效，
 * 并按 `?vfxPhase=` 定格到指定相位（冻结截图可复现）。
 *
 * 合成特效只用于夹具迭代，不能当验收图（3A 画质 §2.1 信息诚实）。
 * 坐标来自 plan.md 步骤 9：
 * - Explosion：格 (58,136)，相位 .25
 * - TurretFire：从 (54,144) 打向 (60,132)，相位 .4
 * - Construction：格 (46,132) 3×3 装配台 ghost，进度 .55
 * - Industry：熔炉 (62,140) 附近，看烟/火花
 * - Selection：选中基站 (54,144) + 士兵 2 个
 */
const fixture = armyShowcaseFixture as unknown as Fixture;

const meta = {
  title: 'Planet/VfxFixture',
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

/** 爆炸：火球 + 烟 + 碎片 + 冲击波 + 闪光，定格在相位 .25。 */
export const Explosion: Story = storyWith({ focus: { x: 58, y: 136 }, tilt: 0.8, zoom: 3.4, vfxPhase: 'Explosion' });

/** 枪口焰 + 曳光：(54,144) → (60,132)，定格在相位 .4。 */
export const TurretFire: Story = storyWith({ focus: { x: 56.5, y: 139.5 }, tilt: 0.55, zoom: 0.72, vfxPhase: 'TurretFire' });

/** 施工全息：(46,132) 3×3 装配台，进度 .55。 */
export const Construction: Story = storyWith({ focus: { x: 46, y: 132 }, tilt: 0.85, zoom: 2.2, vfxPhase: 'Construction' });

/** 工业氛围：熔炉 (62,140) 的烟/火花。 */
export const Industry: Story = storyWith({ focus: { x: 62, y: 140 }, tilt: 0.9, zoom: 2.4, vfxPhase: 'Industry' });

/** 选中：基站 (54,144) + 士兵 2 个（括号 / 细环 / 方向三角）。 */
export const Selection: Story = storyWith({ focus: { x: 54, y: 142 }, tilt: 0.6, zoom: 1.1, vfxPhase: 'Selection' });
