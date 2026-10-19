import type { Meta, StoryObj } from '@storybook/react-vite';

import { MechaFleetCard } from '@/features/mecha/MechaFleetCard';
import { MechaStage } from '@/features/mecha/MechaStoriesHarness';
import { allMechas, planetNames } from '@/features/mecha/mecha-stories-fixture';

/**
 * 视觉夹具：总览页「机甲」卡片（契约 §7.3 第 4 条）。
 * 4 台机甲：我的 u-3、agent「builder-a」的 u-4、空闲的 u-5、阵亡待复活的 u-6（覆盖「复活于 tick N」）。
 *
 * 宽度按**真实布局**取：总览三栏 `280px | 1fr | 340px`，页面内宽 1200px 时右栏就是 340px；
 * 卡片本身是 `.panel`（左右各 20px padding），内容宽约 300px——表头必须在这个宽度里放得下。
 */
const RIGHT_COLUMN_WIDTH = 340;
/** MechaStage 外层左右各 24px padding：让卡片本身正好是右栏宽度。 */
const STAGE_WIDTH = RIGHT_COLUMN_WIDTH + 48;

const meta = {
  title: 'Mecha/FleetCard',
  component: MechaFleetCard,
  decorators: [
    (Story) => (
      <MechaStage width={STAGE_WIDTH}>
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
