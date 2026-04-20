# T111 战争蓝图底盘组件目录与 catalog 重构

## 背景

当前服务端公开的战争单位仍以固定成品为主：

- 地面：`worker`、`soldier`、`prototype`、`precision_drone`
- 太空：`corvette`、`destroyer`

但 `docs/dev/战争组件设计.md` 已明确要求战争系统改成：

- `base_hulls` / `base_frames`
- `components`
- `public_blueprints`
- 预置蓝图 + 后续改型

如果继续在现有 `UnitCatalogEntry` 上线性追加固定单位 ID，后续蓝图设计器、改型、量产、补给和战区系统都会被旧模型反向限制。

## 设计参考

- `docs/dev/战争组件设计.md`
  - 第 7 章“蓝图设计器”
  - 第 15.1 节“公开单位目录”

## 需求细节

1. 将当前战争单位公开目录从“固定单位表”重构为“两层目录”：
   - `base_hulls` / `base_frames`
   - `public_blueprints`
2. 建立 authoritative 组件目录：
   - 动力
   - 推进
   - 防御
   - 感知
   - 武器
   - 功能
3. 当前已公开的：
   - `prototype`
   - `precision_drone`
   - `corvette`
   - `destroyer`
   不再被视为“最终单位类型”，而要迁移为第一批预置标准蓝图。
4. Snapshot / save / load / query / catalog 需要统一切到新结构，不能保留一套平行旧模型做兼容包装。

## 前提任务

- 无

## 可能涉及的代码范围

- `server/internal/model/unit_catalog.go`
- `server/internal/query/catalog.go`
- `server/internal/model/*` 中与战争单位、舰队、地面战斗相关的目录模型
- `server/internal/snapshot/*`
- `shared-client/src/types.ts`
- `shared-client/src/api.ts`

## 改动需求

1. 新增或重构 authoritative 模型，至少明确以下对象：
   - 底盘 / 船体定义
   - 组件定义
   - 蓝图定义
   - 预置公开蓝图定义
2. `/catalog` 的战争相关返回至少要能表达：
   - 可设计底盘
   - 可安装组件
   - 已定型公开蓝图
   - 蓝图所属域（ground / air / orbital / space）
   - 蓝图来源（预置 / 玩家）
3. 当前 `prototype`、`precision_drone`、`corvette`、`destroyer` 要迁移成预置蓝图，不再继续把它们硬编码成“唯一公开战争单位模型”。
4. 保存 / 读档 / 回放 / query 不能出现：
   - 新模型只存在内存，无法持久化
   - `/catalog` 是新结构，但 runtime 仍依赖旧结构
   - 同一单位既有旧 `unit_type` 语义又有新 `blueprint_id` 语义，导致双写冲突
5. 现有世界单位 `worker`、`soldier`、`executor` 可继续保留，但其定位必须和战争蓝图区分清楚：
   - `worker` / `executor` 不纳入蓝图系统
   - `soldier` 若仍保留固定生成入口，也要明确其在战争蓝图体系中的关系

## 不在本任务范围

- 不要求完成蓝图设计校验
- 不要求完成蓝图创建 / 编辑命令
- 不要求完成军工生产、补给、战区、UI

## 验收标准

1. 服务端存在 authoritative 的底盘、组件、蓝图目录模型，并已接入 `/catalog`。
2. `/catalog` 中公开战争内容不再只是固定单位表，而是至少包含：
   - `base_hulls` / `base_frames`
   - `components`
   - `public_blueprints`
3. 预置战争单位 `prototype`、`precision_drone`、`corvette`、`destroyer` 已迁移为公开蓝图，不再要求调用方把它们当作旧式固定单位类型硬编码。
4. 新目录结构可被保存、读档、回放和 query 层稳定读取。
5. 代码中不存在为了兼容旧结构而额外保留一整套包装层的权宜方案。

## 完成情况

- 完成时间：2026-04-20
- 状态：已完成

### 本轮落地

- 将 `/catalog` 的战争公开目录从旧 `units[]` 中拆出，新增 `base_frames`、`base_hulls`、`components`、`public_blueprints` 四组 authoritative 数据。
- `worker` / `soldier` 继续保留在 `units[]`，`prototype` / `precision_drone` / `corvette` / `destroyer` 已迁移为预置 `public_blueprints`，不再继续作为旧式固定战争单位条目公开。
- `deploy_squad`、`commission_fleet`、舰队统计与 `produce` 的拒绝分支已切到新蓝图目录，运行态继续只保存单一标识，没有引入平行兼容包装层。
- `shared-client` 已同步 catalog 类型；服务端 API 文档与玩家指南中的公开目录口径已更新。

### 测试记录

- `cd server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/model ./internal/query`
- `cd server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/gamecore -run 'TestT099|TestT100'`
- `cd client-web && npm run build`

### 额外说明

- `cd server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/model ./internal/query ./internal/gamecore` 仍会被仓库现有基线测试 `TestT103DefaultNewGameCanKeepFirstLabAndStartFirstMiningIncome` 卡住，失败原因为 `start electromagnetism: VALIDATION_FAILED (tech already completed)`；该问题与本次 T111 改动无直接关联，本轮未顺手改动其默认新局配置。
