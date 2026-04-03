# T081 电磁发射器与垂直发射井

## 需求细节
- 电磁发射器（EM Rail Ejector）建筑定义与运行时参数。
- 电磁发射器发射效率：每次发射消耗的能量与发射成功率。
- 电磁发射器轨道控制：控制发射的太阳帆进入不同轨道。
- 垂直发射井（Vertical Launching Silo）建筑定义与运行时参数。
- 垂直发射井火箭生产：火箭的生产配方与生产速度。
- 垂直发射井发射节奏：火箭的发射间隔与发射队列。
- 发射目标选择：发射井选择目标轨道/戴森球结构。

## 前提任务
- 无

## 实现状态：已完成

### 修改的文件
1. **server/internal/model/building_runtime.go**
   - 添加 `LaunchModule` 结构体，包含发射相关参数
   - 添加 `Launch` 字段到 `BuildingFunctionModules`
   - 添加 `LaunchModule` 验证逻辑
   - 添加 `EMRailEjector` 运行时定义（能量消耗30，发射能耗300，成功率95%，轨道半径0.5-5.0AU，倾角最大90°）
   - 添加 `VerticalLaunchingSilo` 运行时定义（能量消耗50，发射能耗500，成功率90%，轨道半径0.5-5.0AU，倾角最大90°）

2. **server/internal/model/item.go**
   - 添加 `ItemSmallCarrierRocket` 常量
   - 添加 小型运载火箭 物品定义（堆叠限制10，单个体积5）

3. **server/internal/gamecore/rules.go**
   - 添加 `math/rand` 导入
   - 更新 `execLaunchSolarSail` 函数：
     - 添加轨道参数验证（orbit_radius和inclination必须在建筑允许范围内）
     - 添加发射成功率检查（根据建筑LaunchModule的SuccessRate）
     - 发射失败时消耗太阳帆但不进入轨道

### 运行时参数说明
- **EM Rail Ejector**: 每tick消耗30能量，发射每次消耗300能量，成功率95%
- **Vertical Launching Silo**: 每tick消耗50能量，发射每次消耗500能量，成功率90%，支持火箭生产
