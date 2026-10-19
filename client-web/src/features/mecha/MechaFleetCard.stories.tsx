import type { Meta, StoryObj } from '@storybook/react-vite';

import { MechaFleetCard } from '@/features/mecha/MechaFleetCard';
import { MechaStage } from '@/features/mecha/MechaStoriesHarness';
import { allMechas, planetNames } from '@/features/mecha/mecha-stories-fixture';

/**
 * 视觉夹具：总览页「机甲」卡片（契约 §7.3 第 4 条）。
 * 3 台机甲：我的 u-3、agent「builder-a」的 u-4、空闲的 u-5；另加 u-6 覆盖「复活于 tick N」。
 */
const meta = {
  title: 'Mecha/FleetCard',
  component: MechaFleetCard,
  decorators: [
    (Story) => (
      <MechaStage width={900}>
        <Story />
      </MechaStage>
    ),
  ],
} satisfies Meta<typeof MechaFleetCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const OverviewCard: Story = {
  args: { mechas: allMechas, planetNames, playerId: 'p1' },
};
