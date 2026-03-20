# T077 施工材料来源与锁定规则

## 需求细节
- 定义材料来源优先级：本地库存、物流节点等的选择顺序。
- 可用量校验：在调度前校验数量，避免超额占用。
- 预留/锁定机制：为施工队列锁定材料，避免并发冲突。
- 数据结构调整：如需变更接口，直接重构调用点，不做兼容层。

## 实现状态
- 材料来源优先级：已实现 (MaterialSourceType + MaterialSource with Priority)
- 可用量校验：已在 reserveConstructionMaterials 中实现
- 预留/锁定机制：已在 ConstructionMaterialReservation 中实现
- 数据结构调整：已集成到 ConstructionQueue

## 实现记录

### 新增类型 (model/construction.go)
- `MaterialSourceType`: 材料来源类型枚举 (Local=0, Logistics=1)
- `MaterialSource`: 材料来源结构，包含类型、建筑ID、优先级
- `MaterialReservation`: 材料预约结构，记录任务ID、玩家ID、各材料数量、来源、预约时间
- `ConstructionMaterialReservation`: 材料预约管理器，包含NextSeq和Reservations映射

### 新增函数 (gamecore/construction.go)
- `reserveConstructionMaterials()`: 验证资源可用性并锁定/扣除材料
- `releaseConstructionReservation()`: 释放预约的材料并退款（取消时调用）
- `getAvailableConstructionMaterials()`: 获取可用材料（为未来物流集成预留）

### 修改的函数
- `execBuild`: 使用 reserveConstructionMaterials 替代直接扣除
- `execCancelConstruction`: 使用 releaseConstructionReservation 替代直接退款
- `execRestoreConstruction`: 对已取消任务重新预约材料

### 测试用例
- TestConstructionMaterialReservation: 验证材料预约创建和资源扣除
- TestConstructionMaterialRefundOnCancel: 验证取消时材料返还
- TestConstructionMaterialReReservationOnRestore: 验证恢复时重新预约

## 修改文件
- `server/internal/model/construction.go`: 新增 MaterialSource, MaterialReservation, ConstructionMaterialReservation 类型
- `server/internal/gamecore/construction.go`: 新增 reserveConstructionMaterials, releaseConstructionReservation, getAvailableConstructionMaterials 函数
- `server/internal/gamecore/rules.go`: 修改 execBuild, execCancelConstruction, execRestoreConstruction 使用新材料预约系统
- `server/internal/gamecore/construction_queue_test.go`: 新增三个测试用例

## 状态
已完成

## 测试结果
```
/home/firesuiry/sdk/go1.25.0/bin/go test ./...
ok  siliconworld/internal/gamecore   0.012s
ok  siliconworld/internal/gateway   (cached)
ok  siliconworld/internal/mapgen    (cached)
ok  siliconworld/internal/model     (cached)
ok  siliconworld/internal/persistence      (cached)
ok  siliconworld/internal/queue    (cached)
ok  siliconworld/internal/snapshot (cached)
ok  siliconworld/internal/visibility       (cached)
```
