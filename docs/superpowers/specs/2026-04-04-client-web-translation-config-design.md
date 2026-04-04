# Client-Web 中英翻译配置设计

## 1. 背景

当前 `client-web` 已经对部分目录数据使用中文显示名，但整站仍存在大量直接展示英文原始值的情况，包括但不限于：

- 行星、恒星系页面中的 `kind`
- 行星事件时间线中的 `event_type`
- 告警列表中的 `alert_type`、`severity`
- 建筑运行状态、方向、物流模式、物流范围
- 单位类型、Agent 状态、消息类型、权限类别
- 多处表单字段标签和调试信息中的英文键名

这些英文值来自服务端协议枚举、共享类型、前端局部硬编码三种来源。继续在各页面零散改文案只会不断漏项，且无法形成可维护配置。

## 2. 目标与非目标

### 2.1 目标

- 为整个 `client-web` 增加一个统一、可配置的中英翻译配置层。
- 让所有用户可见的英文枚举、类型、命令名、状态名和关键字段标签都通过统一翻译入口显示。
- 翻译缺失时安全回退到原始英文值，保证页面不因漏配而异常。
- 保持服务端 API、前端请求 payload、路由参数、查询参数和测试 fixture 协议值不变，只改显示层。
- 为后续继续补词条或扩展中英切换保留清晰边界。

### 2.2 非目标

- 不修改 `server/` 或 `shared-client/` 的接口协议。
- 不把所有自由文本都做成国际化系统，本轮只覆盖枚举、类型、指令、标签等结构化英文文本。
- 不引入第三方 i18n 框架，不增加运行时语言切换 UI。
- 不为了兼容旧写法额外保留散落的页面内翻译分支；完成后统一走翻译入口。

## 3. 总体方案

### 3.1 统一翻译配置

在 `client-web/src/i18n/` 下新增两类文件：

- `translation-config.ts`
  - 维护所有词典配置
  - 按领域拆分，避免单个超长对象失控
- `translate.ts`
  - 提供稳定翻译函数
  - 对缺失配置执行统一回退

词典至少包含以下领域：

- `planetKind`
- `buildingType`
- `itemId`
- `techId`
- `unitType`
- `eventType`
- `alertType`
- `severity`
- `buildingState`
- `powerCoverageReason`
- `direction`
- `logisticsScope`
- `logisticsMode`
- `commandType`
- `agentStatus`
- `agentMessageKind`
- `agentCommandCategory`
- `ui`

### 3.2 翻译入口

前端页面禁止直接渲染需要翻译的协议值。统一改成调用翻译函数，例如：

- `translatePlanetKind(kind)`
- `translateBuildingType(catalog, building.type)`
- `translateItemId(catalog, item.id)`
- `translateTechId(catalog, tech.id)`
- `translateEventType(event.event_type)`
- `translateAlertType(alert.alert_type)`
- `translateBuildingState(building.runtime.state)`
- `translateDirection(buildDirection)`
- `translateLogisticsMode(setting.mode)`
- `translateUi('field.drone_capacity')`

其中建筑、物品、科技优先使用 `catalog` 中已有中文名；没有中文名时再回退到配置词典，再回退到原始 ID。这样既能复用服务端目录，又能保证缺目录时仍能翻译常见值。

### 3.3 回退策略

所有翻译函数必须满足以下顺序：

1. 若有显式中文显示名，优先使用显式中文。
2. 若词典有对应配置，返回配置中文。
3. 若值为空，返回约定默认值，如“未知”“无”“-”。
4. 最后回退原始值，避免页面出现空白。

### 3.4 接入范围

本轮覆盖整个 `client-web` 的用户可见英文文本，重点包括：

- `PlanetPage`
  - 行星类型摘要
  - 事件、告警、实体详情、命令面板、物流配置
- `OverviewPage`
  - 关键事件、关键告警、研究显示
- `SystemPage`
  - 行星类型
- `GalaxyPage`
  - 页眉和辅助英文标语
- `AgentWorkspace` / `AgentsPage`
  - 智能体状态、消息类型、权限命令类别
- `fixtures`
  - 浏览器内可见标题和详情使用翻译后的显示名，而不是英文原值

不要求把测试断言里所有英文协议值改掉；测试仍然可以对 payload 和 API 协议保持英文断言。

## 4. 文件边界

- `client-web/src/i18n/translation-config.ts`
  - 只存静态词典和默认值
- `client-web/src/i18n/translate.ts`
  - 只存查词典和回退逻辑
- `client-web/src/features/planet-map/model.ts`
  - 原有显示名函数迁移为调用统一翻译层
  - 负责事件摘要、告警摘要等领域内文案生成
- 页面和组件
  - 不再自己拼英文枚举名，只负责渲染翻译结果

这能把“词典维护”和“页面展示”分开，降低耦合。

## 5. 数据流

### 5.1 建筑 / 物品 / 科技

1. 页面拿到 `catalog` 与协议 ID。
2. 显示层调用统一翻译函数。
3. 翻译函数优先读 `catalog` 中文名。
4. 若目录缺失则回退到本地配置词典。
5. 若仍缺失则显示原始 ID。

### 5.2 纯枚举值

1. 页面拿到协议枚举，如 `event_type=building_state_changed`。
2. 页面调用对应翻译函数。
3. 函数直接查领域词典。
4. 未命中时回退原值。

### 5.3 表单标签

1. 页面不再直接写 `drone_capacity`、`mode`、`scope` 之类英文标签。
2. 统一调用 `translateUi()` 渲染可读中文。
3. `aria-label` 也同步改为中文，测试断言改成中文可读标签。

## 6. 错误处理与可维护性

- 不抛出“未找到翻译”异常，漏翻译只回退原值。
- 新增一个通用 `translateByDictionary()`，避免页面自己处理默认值和空字符串。
- 词典键名保持与协议值一一对应，不做中间别名层，避免维护两套映射。
- 同类词典值保持短句风格，例如“供给”“需求”“双向”，避免一处写短词、一处写长句。

## 7. 测试策略

本轮按 TDD 实施，至少覆盖三层测试：

### 7.1 翻译层单测

- 缺失词条时回退原值
- 目录中文名优先于本地词典
- 事件、状态、方向、模式等核心枚举可正确翻译

### 7.2 页面/组件测试

- `PlanetCommandPanel.test.tsx`
  - 表单标签从英文改为中文
  - 下拉项展示中文而 payload 仍发英文
- `OverviewPage.test.tsx`
  - 事件类型、告警类型显示中文
- `PlanetPage.test.tsx`
  - 事件时间线、告警面板、行星类型、实体详情中的英文枚举显示中文
- `AgentsPage.test.tsx`
  - Agent 状态、权限类别、消息类型展示中文

### 7.3 构建与回归

- `npm test`
- `npm run build`

如时间允许，可再补浏览器手动检查，但本轮最低保证是单测和构建通过。

## 8. 风险与取舍

- 风险：词典覆盖不全，仍会漏英文。
  - 处理：先把当前直接渲染英文的入口全部收口到统一翻译函数，漏词条时至少集中补，不再散落。
- 风险：现有测试大量依赖英文 `aria-label`。
  - 处理：同步更新测试到中文标签，但保留对请求 payload 的英文协议断言。
- 风险：部分目录条目已是中文，若硬套词典可能产生重复维护。
  - 处理：建筑/物品/科技优先走目录显示名，只把目录缺失场景交给本地词典。

## 9. 验收标准

- `client-web` 各主要页面不再直接向用户暴露结构化英文枚举和指令名。
- 所有翻译集中定义在 `client-web/src/i18n/translation-config.ts` 一类文件中，可继续扩展。
- 协议请求与服务端交互保持原英文值，不受显示层翻译影响。
- 测试和构建通过。
