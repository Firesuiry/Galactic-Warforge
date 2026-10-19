import type { Meta, StoryObj } from '@storybook/react-vite';

import { MechaControls } from '@/features/planet-map/MechaControls';
import { MechaStage } from '@/features/mecha/MechaStoriesHarness';
import {
  agentMecha,
  idleMecha,
  mechaUnit,
  myMecha,
  storyCatalog,
  storyPlayer,
} from '@/features/mecha/mecha-stories-fixture';

/**
 * 视觉夹具（第 21 轮契约 §7.3 第 6 条）：MechaControls 操作者三态。
 * 固定数据见 `mecha-stories-fixture.ts`，不连服务端；截图说明见 `tmp/r21-web/report.md`。
 */
const meta = {
  title: 'Mecha/Controls',
  component: MechaControls,
  decorators: [
    (Story) => (
      <MechaStage>
        <Story />
      </MechaStage>
    ),
  ],
} satisfies Meta<typeof MechaControls>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 我的机甲：全部控件 + 背包读这台机甲档案。 */
export const Mine: Story = {
  args: {
    unit: mechaUnit(myMecha),
    catalog: storyCatalog,
    planetId: 'planet-1-1',
    mecha: myMecha,
    boundMecha: myMecha,
    player: storyPlayer,
  },
};

/** 别人的机甲（agent builder-a）：只读信息 + 接管；我已绑 u-3 → 提示接管后 u-3 变空闲。 */
export const OtherAgent: Story = {
  args: {
    unit: mechaUnit(agentMecha),
    catalog: storyCatalog,
    planetId: 'planet-1-1',
    mecha: agentMecha,
    boundMecha: myMecha,
    player: storyPlayer,
  },
};

/** 空闲机甲：只读 + 接管。 */
export const Idle: Story = {
  args: {
    unit: mechaUnit(idleMecha),
    catalog: storyCatalog,
    planetId: 'planet-1-1',
    mecha: idleMecha,
    boundMecha: myMecha,
    player: storyPlayer,
  },
};
