# T008 科技树与研究

## 需求细节
- 科技树完整覆盖：主线科技、分支科技、加成科技。
- 矩阵系统：电磁、能量、结构、信息、引力、宇宙矩阵。
- 研究队列与加速：科研速度与并行研究限制。
- 解锁内容：建筑、配方、升级、舰船与战斗模块。
- 详细科技列表对齐 `docs/戴森球计划科技树.md`。

## 前提任务
- T003 资源、物品与配方系统
- T007 生产与加工链

## 实现细节

### 新增文件
- `server/internal/model/tech.go` - 科技树数据结构和定义
- `server/internal/gamecore/research.go` - 研究系统核心逻辑

### 修改文件
- `server/internal/model/command.go` - 新增 start_research 和 cancel_research 命令
- `server/internal/model/event.go` - 新增 research_completed 事件类型
- `server/internal/model/world.go` - PlayerState 新增 Tech 字段
- `server/internal/gamecore/core.go` - 研究settlement集成到tick循环

### 核心功能
1. **科技定义 (TechDefinition)**：包含前置科技、成本(矩阵)、解锁内容、效果
2. **研究进度 (PlayerResearch)**：追踪每个玩家的研究状态和进度
3. **研究队列**：支持队列排队和并行研究限制
4. **研究加速**：通过 Executor.ResearchBoost 属性加速
5. **科技解锁**：建筑、配方、单位、特殊内容的解锁检查

### 科技树覆盖
- 6种矩阵类型：电磁、能量、结构、信息、引力、宇宙
- 7个科技分类：主线、能源、物流、冶炼、化工、战斗、机甲
- 100+ 科技定义，完全对齐戴森球计划科技树文档

### 命令
- `start_research` - 开始研究指定科技
- `cancel_research` - 取消正在研究或队列中的科技

### 事件
- `research_completed` - 科技研究完成时触发

## 完成状态
✅ 已完成：科技树数据模型、研究命令、研究settlement、tick循环集成