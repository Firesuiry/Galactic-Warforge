# Client-Web 中英翻译配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为整个 `client-web` 增加统一的中英翻译配置层，把用户可见的英文枚举、状态、指令名、标签统一翻译为中文，同时保持协议值不变。

**Architecture:** 在 `client-web/src/i18n/` 下新增静态翻译词典与统一翻译函数；将 `planet-map` 的显示名与摘要逻辑、总览页、星图页、系统页、Agent 协作页都接到同一翻译入口；测试同时验证“页面显示中文”和“请求 payload 仍为英文协议值”。

**Tech Stack:** React、TypeScript、Vite、Vitest、Testing Library

---

## File Map

- `client-web/src/i18n/translation-config.ts`
  统一翻译词典。
- `client-web/src/i18n/translate.ts`
  翻译辅助函数与回退逻辑。
- `client-web/src/features/planet-map/model.ts`
  行星页显示名、事件摘要、告警摘要统一接入翻译层。
- `client-web/src/features/planet-map/PlanetPanels.tsx`
  建筑详情、单位详情、事件面板、告警面板、物流配置摘要显示中文。
- `client-web/src/features/planet-map/PlanetCommandPanel.tsx`
  命令表单标签、选项显示中文，命令 payload 保持英文协议值。
- `client-web/src/pages/PlanetPage.tsx`
  行星页摘要中的 `planet.kind` 等显示改中文。
- `client-web/src/pages/OverviewPage.tsx`
  事件、告警、研究显示接入翻译层。
- `client-web/src/pages/SystemPage.tsx`
  行星类型接入翻译层。
- `client-web/src/pages/GalaxyPage.tsx`
  页眉辅助英文 UI 改中文。
- `client-web/src/features/agents/AgentWorkspace.tsx`
  Agent 状态、消息类型、权限类别显示中文。
- `client-web/src/fixtures/index.ts`
  浏览器内可见标题改为翻译显示名。
- `client-web/src/features/planet-map/model.test.ts`
  翻译和摘要单测。
- `client-web/src/features/planet-map/PlanetCommandPanel.test.tsx`
  命令面板中文标签与 payload 不变。
- `client-web/src/pages/OverviewPage.test.tsx`
  总览页事件/告警中文显示。
- `client-web/src/pages/PlanetPage.test.tsx`
  行星页关键英文枚举中文化。
- `client-web/src/pages/AgentsPage.test.tsx`
  Agent 页面状态与权限中文显示。
- `docs/dev/client-web.md`
  记录翻译配置入口和维护方式。

### Task 1: 建立统一翻译词典与翻译函数

**Files:**
- Create: `client-web/src/i18n/translation-config.ts`
- Create: `client-web/src/i18n/translate.ts`
- Test: `client-web/src/features/planet-map/model.test.ts`

- [ ] **Step 1: 写一个失败测试，锁定翻译回退和核心枚举翻译**

在 `client-web/src/features/planet-map/model.test.ts` 增加断言：

```ts
it('优先使用 catalog 中文名并回退到词典或原值', () => {
  expect(getBuildingDisplayName({
    buildings: [{ id: 'mining_machine', name: '采矿机', category: 'production', subcategory: 'mining', buildable: true }],
    items: [],
    recipes: [],
    techs: [],
  }, 'mining_machine')).toBe('采矿机');

  expect(summarizeEvent({
    event_id: 'evt-1',
    tick: 12,
    player_id: 'p1',
    event_type: 'building_state_changed',
    payload: {
      building_id: 'b-1',
      prev_state: 'idle',
      next_state: 'running',
    },
  })).toContain('空闲');

  expect(translatePlanetKind('terrestrial')).toBe('类地行星');
  expect(translateDirection('north')).toBe('北');
  expect(translateEventType('unknown_event')).toBe('unknown_event');
});
```

- [ ] **Step 2: 运行测试，确认它先失败**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- src/features/planet-map/model.test.ts
```

Expected: FAIL，因为翻译函数和摘要还没有输出中文状态。

- [ ] **Step 3: 实现统一词典与翻译函数**

在 `client-web/src/i18n/translation-config.ts` 建立领域词典，在 `client-web/src/i18n/translate.ts` 提供统一入口。核心代码结构：

```ts
export const TRANSLATIONS = {
  planetKind: {
    terrestrial: '类地行星',
    barren: '荒芜行星',
  },
  direction: {
    auto: '自动',
    north: '北',
    east: '东',
    south: '南',
    west: '西',
  },
  buildingState: {
    idle: '空闲',
    running: '运行中',
    paused: '已暂停',
    no_power: '缺电',
    error: '异常',
  },
} as const;

export function translateByDictionary(
  dictionary: Record<string, string>,
  value: string | undefined | null,
  fallback = '-',
) {
  if (!value) {
    return fallback;
  }
  return dictionary[value] ?? value;
}
```

- [ ] **Step 4: 再跑测试，确认通过**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- src/features/planet-map/model.test.ts
```

Expected: PASS

### Task 2: 接入行星模型与命令面板

**Files:**
- Modify: `client-web/src/features/planet-map/model.ts`
- Modify: `client-web/src/features/planet-map/PlanetPanels.tsx`
- Modify: `client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- Test: `client-web/src/features/planet-map/PlanetCommandPanel.test.tsx`
- Test: `client-web/src/pages/PlanetPage.test.tsx`

- [ ] **Step 1: 先写失败测试，锁定中文标签和中文展示**

在 `client-web/src/features/planet-map/PlanetCommandPanel.test.tsx` 和 `client-web/src/pages/PlanetPage.test.tsx` 增加断言，例如：

```ts
expect(screen.getByLabelText('无人机容量')).toBeInTheDocument();
expect(screen.getByRole('option', { name: /需求/ })).toBeInTheDocument();
expect(screen.getByText(/类地行星/)).toBeInTheDocument();
expect(screen.getByText(/建筑状态变更|空闲 -> 运行中/)).toBeInTheDocument();
```

- [ ] **Step 2: 运行目标测试，确认失败**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- src/features/planet-map/PlanetCommandPanel.test.tsx src/pages/PlanetPage.test.tsx
```

Expected: FAIL，因为当前标签和展示仍有英文。

- [ ] **Step 3: 用最小实现接入翻译层**

修改点：

- `model.ts`
  - `getBuildingDisplayName/getItemDisplayName/getTechDisplayName` 统一接到翻译层
  - `summarizeEvent/summarizeAlert` 用中文事件名、状态名、告警名
- `PlanetPanels.tsx`
  - 建筑状态、停机原因、物流模式、范围、事件类型、告警类型显示中文
- `PlanetCommandPanel.tsx`
  - `aria-label`、字段文案、方向/模式/范围选项文案改中文
  - `value` 保持英文协议值

- [ ] **Step 4: 再跑目标测试，确认通过**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- src/features/planet-map/PlanetCommandPanel.test.tsx src/pages/PlanetPage.test.tsx
```

Expected: PASS

### Task 3: 接入总览、系统、银河和 Agent 页面

**Files:**
- Modify: `client-web/src/pages/OverviewPage.tsx`
- Modify: `client-web/src/pages/SystemPage.tsx`
- Modify: `client-web/src/pages/GalaxyPage.tsx`
- Modify: `client-web/src/features/agents/AgentWorkspace.tsx`
- Modify: `client-web/src/fixtures/index.ts`
- Test: `client-web/src/pages/OverviewPage.test.tsx`
- Test: `client-web/src/pages/AgentsPage.test.tsx`

- [ ] **Step 1: 先写失败测试，锁定剩余页面的中文展示**

增加断言示例：

```ts
expect(screen.getByText(/实体已创建/)).toBeInTheDocument();
expect(screen.getByText(/电力不足/)).toBeInTheDocument();
expect(screen.getByText(/运行中/)).toBeInTheDocument();
expect(screen.getByText(/建造/)).toBeInTheDocument();
```

- [ ] **Step 2: 运行目标测试，确认失败**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- src/pages/OverviewPage.test.tsx src/pages/AgentsPage.test.tsx
```

Expected: FAIL，因为这些页面仍直接渲染英文状态和值。

- [ ] **Step 3: 接入翻译层**

修改点：

- `OverviewPage.tsx`
  - 事件类型、告警类型、研究名翻译
- `SystemPage.tsx`
  - 行星类型翻译
- `GalaxyPage.tsx`
  - 辅助英文 UI 文案改中文
- `AgentWorkspace.tsx`
  - Agent 状态、消息类型、权限类别翻译
- `fixtures/index.ts`
  - 面板标题用翻译显示名

- [ ] **Step 4: 再跑目标测试，确认通过**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test -- src/pages/OverviewPage.test.tsx src/pages/AgentsPage.test.tsx
```

Expected: PASS

### Task 4: 文档和整体验证

**Files:**
- Modify: `docs/dev/client-web.md`

- [ ] **Step 1: 更新文档**

在 `docs/dev/client-web.md` 增加：

- 翻译配置文件位置
- 新增词条时应修改的文件
- “显示层翻译不改变协议值”的约束

- [ ] **Step 2: 跑完整测试**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test
```

Expected: PASS

- [ ] **Step 3: 跑构建校验**

Run:

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm run build
```

Expected: PASS
