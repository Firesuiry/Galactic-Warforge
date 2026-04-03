# T070 蓝图数据结构与序列化

## 需求细节
- 蓝图基础结构：建筑类型、参数、相对坐标与方向。
- 蓝图元数据：尺寸/边界、版本号、创建时间、创建者（可选）。
- 校验规则：字段合法性、坐标范围、方向枚举、参数完整性。
- 序列化与反序列化：供存档与网络传输复用。

## 完成情况
- 新增蓝图数据模型与序列化/反序列化工具，覆盖元数据、边界、方向与参数校验。
- 增加蓝图校验与序列化测试，验证常见错误与往返一致性。
- 测试：`/home/firesuiry/sdk/go1.25.0/bin/go test ./internal/model`。

## 变更文件
- `server/internal/model/blueprint.go`
- `server/internal/model/blueprint_test.go`
