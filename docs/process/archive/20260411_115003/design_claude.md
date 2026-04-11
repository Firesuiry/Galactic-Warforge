# 未实现功能详细设计方案

本文档覆盖 `docs/process/task/` 下两个待实现任务的完整设计方案：

- **任务 A**：Web 智能体工作台默认 Provider 回复链路修复
- **任务 B**：Web 科研与科技树交互优化

---

## 任务 A：Web 智能体工作台默认 Provider 回复链路修复

### 问题根因

MiniMax 模型返回的 JSON 中，当智能体仅需纯文本回复（无工具调用）时，`actions` 数组可能包含空对象 `{}` 或缺少 `type` 字段的对象。当前 `normalizeAction()` 在 `action-schema.ts:210-211` 对此直接抛出 `action.type is required`，导致整轮 turn 判死。

调用链：`runAgentLoop` → `normalizeProviderTurn()` → `actions.map(normalizeAction)` → 抛异常 → turn 标记为 failed → Web 显示 "执行失败"。

### 设计方案

#### A1. `normalizeProviderTurn()` 容错空动作

**文件**：`agent-gateway/src/runtime/action-schema.ts`

在 `normalizeProviderTurn()` 中过滤掉无效 action，而非让单个无效 action 炸掉整轮 turn：

```typescript
// action-schema.ts — normalizeProviderTurn() 内部，约 line 322
// 当前：
actions: actions.map((action) => normalizeAction(action)),

// 改为：
actions: actions.flatMap((action) => {
  try {
    return [normalizeAction(action)];
  } catch {
    // 空对象、缺 type 等无效 action 静默跳过
    return [];
  }
}),
```

这样当模型返回 `"actions": [{}]` 或 `"actions": [{"text": "..."}]` 时，结果等价于 `actions: []`，turn 正常完成。

#### A2. `parseProviderResult()` 支持无动作纯回复

**文件**：`agent-gateway/src/providers/index.ts`

当前 `parseProviderResult()` 在 line 82-87 强制要求 `actions` 为数组且 `done` 为布尔值。对于纯文本回复场景，模型可能返回不含 `actions` 的 JSON 或纯文本。

```typescript
// providers/index.ts — parseProviderResult()
// 在 normalized 解构之后、校验之前，补充默认值：

if (!Array.isArray(normalized.actions)) {
  normalized.actions = [];
}
if (typeof normalized.done !== 'boolean') {
  normalized.done = true; // 无动作视为单轮完成
}
```

同时处理模型返回纯文本（非 JSON）的情况：在 `JSON.parse` 外层 catch 中，将原始文本包装为合法 turn：

```typescript
export function parseProviderResult(raw: string): ProviderTurnResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(normalizeStructuredJsonText(raw));
  } catch {
    // 模型返回纯文本，包装为无动作的完成 turn
    return {
      assistantMessage: raw.trim(),
      actions: [],
      done: true,
    };
  }
  // ... 后续逻辑不变
}
```

#### A3. `runAgentLoop` 异常兜底

**文件**：`agent-gateway/src/runtime/loop.ts`

在 `normalizeProviderTurn(rawTurn)` 调用处增加 try-catch，防止 normalize 阶段的异常直接终止循环：

```typescript
// loop.ts — for 循环内部，约 line 54
let turn: CanonicalAgentTurn;
try {
  turn = normalizeProviderTurn(rawTurn);
} catch (error) {
  // normalize 失败时，将原始输出作为纯文本回复
  const fallbackMessage = typeof rawTurn === 'string'
    ? rawTurn
    : JSON.stringify(rawTurn);
  turn = { assistantMessage: fallbackMessage, actions: [], done: true };
}
```

#### A4. MiniMax Provider 系统提示优化

**文件**：`agent-gateway/src/bootstrap/minimax.ts`

当前系统提示过于简短，未引导模型输出结构化 JSON。优化为：

```typescript
systemPrompt: [
  '你是智能体成员。',
  '回复必须是合法 JSON：{"assistantMessage":"你的回复","actions":[],"done":true}',
  '如果需要执行游戏命令，在 actions 中添加 {"type":"game.cli","commandLine":"..."}。',
  '如果只需回复文字，actions 留空数组，done 设为 true。',
].join('\n'),
```

### 涉及文件清单

| 文件 | 改动类型 |
|------|---------|
| `agent-gateway/src/runtime/action-schema.ts` | 修改 `normalizeProviderTurn()` |
| `agent-gateway/src/providers/index.ts` | 修改 `parseProviderResult()` |
| `agent-gateway/src/runtime/loop.ts` | 增加 normalize 异常兜底 |
| `agent-gateway/src/bootstrap/minimax.ts` | 优化系统提示 |

### 验证步骤

1. 启动 agent-gateway + game server
2. 在 `/agents` 新建成员，绑定 `builtin-minimax-api`
3. 发起私聊，发送纯观察任务
4. 确认页面显示正式回复而非 system failure
5. 测试委派链：创建下级 → 分配权限 → 下级执行建造/科研 → authoritative 成功

---

## 任务 B：Web 科研与科技树交互优化

### 问题分析

当前科研 UI 存在两个核心问题：

1. **科技入口是扁平下拉**：`PlanetCommandPanel.tsx:253-264` 中 `techOptions` 仅按 level 排序后全量展示，无状态区分
2. **装料反馈文案过时**：`store.ts:218-224` 中 `resolveNextHint()` 对所有 `transfer_item` 成功统一返回 `"物料已装入，下一步可继续启动 ${entry.focus.techId}。"`，不区分装料目标

### 设计方案

#### B1. 科技分组数据模型

在 `PlanetCommandPanel.tsx` 中新增科技分组逻辑，利用已有的 `catalog.techs`（含 `prerequisites`）和 `summary.players[playerId].tech`（含 `completed_techs`）：

```typescript
// PlanetCommandPanel.tsx — 新增 useMemo

interface TechGroup {
  label: string;
  techs: Array<TechCatalogEntry & { status: 'completed' | 'available' | 'locked' }>;
}

const techGroups = useMemo(() => {
  const allTechs = (catalog?.techs ?? []).filter((t) => !t.hidden);
  const completed = new Set(Object.keys(playerTech?.completedtechs ?? {}));
  const currentId = playerTech?.current_research?.tech_id;
  const queuedIds = new Set(
    (playerTech?.research_queue ?? []).map((q) => q.tech_id),
  );

  const tagged = allTechs.map((tech) => {
    if (completed.has(tech.id)) {
      return { ...tech, status: 'completed' as const };
    }
    const prereqsMet = (tech.prerequisites ?? []).every((p) => completed.has(p));
    return { ...tech, status: prereqsMet ? 'available' as const : 'locked' as const };
  });

  const groups: TechGroup[] = [
    {
      label: '当前可研究',
      techs: tagged
        .filter((t) => t.status === 'available')
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'zh-CN')),
    },
    {
      label: '已完成',
      techs: tagged
        .filter((t) => t.status === 'completed')
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'zh-CN')),
    },
    {
      label: '尚未满足前置',
      techs: tagged
        .filter((t) => t.status === 'locked')
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'zh-CN')),
    },
  ];

  return groups.filter((g) => g.techs.length > 0);
}, [catalog?.techs, playerTech]);
```

#### B2. 阶段化科技视图替换扁平下拉

将当前的 `<select>` 替换为分组列表，每个科技节点展示关键信息：

```tsx
{activeWorkflow === "research" ? (
  <section aria-labelledby="planet-workflow-tab-research" ...>
    <div className="section-title">研究</div>

    {/* 当前正在研究 */}
    {playerTech?.current_research && (
      <div className="tech-current">
        <span className="tech-current-label">正在研究：</span>
        <span>{getTechDisplayName(catalog, playerTech.current_research.tech_id)}</span>
        <span className="tech-progress">
          {Math.round((playerTech.current_research.progress / playerTech.current_research.total_cost) * 100)}%
        </span>
      </div>
    )}

    {/* 分组科技列表 */}
    {techGroups.map((group) => (
      <details key={group.label} open={group.label === '当前可研究'}>
        <summary className="tech-group-header">{group.label}（{group.techs.length}）</summary>
        <ul className="tech-list">
          {group.techs.map((tech) => (
            <li
              key={tech.id}
              className={`tech-item tech-item--${tech.status}`}
              aria-selected={researchId === tech.id}
              onClick={() => tech.status === 'available' && setResearchId(tech.id)}
            >
              <div className="tech-item-header">
                <span className="tech-name">
                  {getTechDisplayName(catalog, tech.id)} · Lv.{tech.level}
                </span>
                {tech.status === 'completed' && <span className="tech-badge">✓</span>}
                {tech.status === 'locked' && <span className="tech-badge">🔒</span>}
              </div>
              <div className="tech-item-meta">
                {tech.prerequisites?.length ? (
                  <span className="tech-prereq">
                    前置：{tech.prerequisites.map((p) => getTechDisplayName(catalog, p)).join('、')}
                  </span>
                ) : null}
                {tech.cost?.length ? (
                  <span className="tech-cost">
                    需要：{tech.cost.map((c) => `${c.amount} ${c.item_id}`).join('、')}
                  </span>
                ) : null}
                {tech.unlocks?.length ? (
                  <span className="tech-unlocks">
                    解锁：{tech.unlocks.map((u) => u.target_id).join('、')}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </details>
    ))}

    {/* 开始研究按钮 */}
    <button
      disabled={!researchId || techGroups.flatMap((g) => g.techs).find((t) => t.id === researchId)?.status !== 'available'}
      onClick={() => {
        void runCommand("start_research", () => client.cmdStartResearch(researchId), ...);
      }}
    >
      开始研究
    </button>
  </section>
) : null}
```

#### B3. 新局首屏推荐路径提示

在科技面板顶部，当玩家仅完成 `dyson_sphere_program` 时，显示推荐路径：

```typescript
// PlanetCommandPanel.tsx — 在科技分组列表之前

const completedCount = Object.keys(playerTech?.completedtechs ?? {}).length;
const showGuide = completedCount <= 1; // 仅完成初始科技

// JSX:
{showGuide && (
  <div className="tech-guide">
    推荐路径：建造风力发电机 → 建造空研究站 → 装入 10 电磁矩阵 → 研究 electromagnetism
  </div>
)}
```

#### B4. 上下文相关的装料成功文案

**文件**：`client-web/src/features/planet-commands/store.ts`

替换 `resolveNextHint()` 中 `transfer_item` 成功的通用文案，根据目标建筑类型区分：

```typescript
// store.ts — resolveNextHint() 中 transfer_item 分支

if (
  entry.commandType === "transfer_item"
  && entry.status === "succeeded"
) {
  const targetType = entry.focus?.buildingType;

  if (targetType === "matrix_lab") {
    return `物料已装入研究站，下一步可启动研究 ${entry.focus?.techId ?? "对应科技"}。`;
  }
  if (targetType === "em_rail_ejector") {
    return "太阳帆已装入弹射器，下一步可发射太阳帆扩展戴森云。";
  }
  if (targetType === "vertical_launching_silo") {
    return "火箭已装入发射井，下一步可发射火箭构建戴森球结构。";
  }
  if (targetType === "ray_receiver") {
    return "射线接收站已配置，可切换模式为光子生成或直接发电。";
  }

  // 通用兜底
  return `物料已装入 ${entry.focus?.entityId ?? "目标建筑"}。`;
}
```

需要确认 `PlanetCommandJournalEntry.focus` 中是否已携带 `buildingType`。如果当前 focus 结构不含 `buildingType`，需要在创建 journal entry 时从 `transfer_item` 命令的目标建筑中提取并写入 focus。

**补充**：检查 `focus` 类型定义，如需扩展：

```typescript
// store.ts — CommandFocus 类型
interface CommandFocus {
  techId?: string;
  entityId?: string;
  buildingType?: string;  // 新增：目标建筑类型
}
```

在 `transfer_item` 命令提交时，从选中的建筑信息中填充 `buildingType`。

#### B5. CSS 样式

在 `PlanetCommandPanel` 对应的样式文件中新增：

```css
.tech-group-header {
  font-weight: 600;
  padding: 4px 0;
  cursor: pointer;
  user-select: none;
}

.tech-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.tech-item {
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  margin-bottom: 2px;
}

.tech-item--available {
  background: var(--color-surface-alt, #1a2a1a);
}

.tech-item--available:hover {
  background: var(--color-surface-hover, #2a3a2a);
}

.tech-item--available[aria-selected="true"] {
  outline: 1px solid var(--color-accent, #4a9);
}

.tech-item--completed {
  opacity: 0.6;
  cursor: default;
}

.tech-item--locked {
  opacity: 0.4;
  cursor: not-allowed;
}

.tech-item-meta {
  font-size: 0.85em;
  opacity: 0.8;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
}

.tech-badge {
  margin-left: 4px;
}

.tech-current {
  padding: 6px 8px;
  background: var(--color-surface-alt, #1a2a1a);
  border-left: 3px solid var(--color-accent, #4a9);
  margin-bottom: 8px;
}

.tech-progress {
  margin-left: 8px;
  opacity: 0.8;
}

.tech-guide {
  padding: 8px;
  background: var(--color-info-bg, #1a1a2a);
  border-radius: 4px;
  margin-bottom: 8px;
  font-size: 0.9em;
}
```

### 涉及文件清单

| 文件 | 改动类型 |
|------|---------|
| `client-web/src/features/planet-map/PlanetCommandPanel.tsx` | 重写科技面板（分组视图替换扁平下拉） |
| `client-web/src/features/planet-commands/store.ts` | 修改 `resolveNextHint()` 装料文案 |
| `client-web/src/features/planet-map/PlanetCommandPanel.css`（或对应样式文件） | 新增科技分组样式 |

### 验证步骤

1. 启动 game server + client-web dev server
2. 默认新局：确认科技面板显示分组视图，首屏有推荐路径提示
3. 确认 `electromagnetism` 在"当前可研究"分组，终局科技在"尚未满足前置"分组
4. 完成 `electromagnetism` 研究后，确认其移入"已完成"，新解锁科技出现在"当前可研究"
5. 给 `em_rail_ejector` 装入 `solar_sail`，确认提示为"太阳帆已装入弹射器..."
6. 给 `vertical_launching_silo` 装入 `small_carrier_rocket`，确认提示为"火箭已装入发射井..."
7. 给 `matrix_lab` 装入矩阵，确认提示为"物料已装入研究站..."

---

## 实施优先级

| 优先级 | 任务 | 理由 |
|--------|------|------|
| P0 | A1-A4 Agent 回复链路修复 | 当前 Web 端智能体完全不可用，是功能 blocker |
| P1 | B4 装料文案修复 | 改动小、影响直接，消除误导性提示 |
| P1 | B1-B3 科技分组视图 | 改善核心游玩体验，数据已就绪只需前端改造 |
| P2 | B5 样式打磨 | 跟随 B1-B3 一起完成 |

## 风险与注意事项

1. **A1 容错策略**：静默跳过无效 action 可能掩盖模型输出问题。建议在跳过时记录 warn 级别日志，便于后续排查。
2. **A2 纯文本兜底**：将非 JSON 输出包装为完成 turn 是合理的降级策略，但需确保 `assistantMessage` 不会包含 `<think>` 等标签残留（`normalizeStructuredJsonText` 已处理）。
3. **B1 数据依赖**：`playerTech` 来自 `summary.players[playerId].tech`，需确认 polling 频率足够（当前 500ms）使科技完成后分组能及时更新。
4. **B4 focus.buildingType**：需确认 `transfer_item` 命令提交时 focus 中是否已有建筑类型信息，如果没有需要在命令提交处补充。
