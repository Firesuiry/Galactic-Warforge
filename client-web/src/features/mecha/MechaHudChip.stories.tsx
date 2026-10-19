import type { Meta, StoryObj } from '@storybook/react-vite';

import { MechaStage } from '@/features/mecha/MechaStoriesHarness';
import { myMecha, storyCatalog } from '@/features/mecha/mecha-stories-fixture';
import { TopNavInventoryChips } from '@/widgets/TopNav';

/**
 * 视觉夹具：顶栏 / 行星页 HUD 背包 chip（契约 §7.3 第 1 条）。
 * 已绑定 →「背包 4/40 格 · u-3」；未绑定 → 灰色「未绑定机甲」。
 */
const meta = {
  title: 'Mecha/HudChip',
  component: TopNavInventoryChips,
  decorators: [
    (Story) => (
      <MechaStage width={900}>
        <div className="top-nav__status" style={{ display: 'flex', gap: 8 }}>
          <Story />
        </div>
      </MechaStage>
    ),
  ],
} satisfies Meta<typeof TopNavInventoryChips>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 已绑定：背包 4/40 格 · u-3。 */
export const Bound: Story = {
  args: {
    catalog: storyCatalog,
    inventory: myMecha.inventory,
    mechaId: myMecha.unit_id,
    slots: { used: myMecha.inventory_slots_used, total: myMecha.inventory_slots_total },
  },
};

/** 未绑定：灰色 chip + 悬浮「在行星上选中一台机甲 → 接管」。 */
export const Unbound: Story = {
  args: { catalog: storyCatalog },
};
