# T082 戴森球结构与应力系统

## 需求细节
- 戴森球节点（Node）定义与建造：节点是戴森球的基本结构单元。
- 戴森球框架（Frame）建造：框架连接节点形成球体骨架。
- 戴森球壳体（Shell）建造：壳体覆盖框架形成能量收集表面。
- 阶段性产能：不同建造阶段的能量输出比例。
- 纬度建造限制：戴森球不同纬度的建造约束与应力分布。
- 戴森球应力系统：结构完整性、应力计算、崩溃条件。
- 多层结构：支持多个戴森球壳层（内层/外层）。
- 拆除与调整：部分拆除戴森球结构，材料返还规则。

## 前提任务
- 无

## 架构设计
- 详细设计请参考: `docs/process/detail/T082.md`

## 实现状态：已完成

### 新增文件
1. **server/internal/model/dyson_sphere.go**
   - `DysonSphereState` - 戴森球完整状态
   - `DysonLayer` - 单层壳体
   - `DysonNode` - 节点定义
   - `DysonFrame` - 框架定义
   - `DysonShell` - 壳体定义
   - `DysonStressParams` / `DysonStressResult` - 应力系统参数
   - 阶段性产能计算 (`EnergyStageEmpty` 到 `EnergyStageFullShell`)
   - 应力计算函数 `CalculateLayerStress`

2. **server/internal/gamecore/dyson_sphere_settlement.go**
   - `AddDysonLayer` - 添加新壳层
   - `AddDysonNode` - 添加节点
   - `AddDysonFrame` - 添加框架
   - `AddDysonShell` - 添加壳体
   - `DemolishDysonComponent` - 拆除组件
   - `settleDysonSpheres` - 每tick结算
   - `GetDysonSphereEnergyForPlayer` - 获取能量输出

3. **server/internal/model/command.go**
   - 新增命令类型: `CmdBuildDysonNode`, `CmdBuildDysonFrame`, `CmdBuildDysonShell`, `CmdDemolishDyson`
