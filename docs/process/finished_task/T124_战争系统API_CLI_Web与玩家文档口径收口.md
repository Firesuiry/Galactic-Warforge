# T124 战争系统 API、CLI、Web 与玩家文档口径收口

## 背景

战争系统是一次跨：

- server
- shared-client
- client-cli
- client-web
- agent-gateway
- docs

的联合演进。如果最终没有把文档口径收齐，后续会重复出现此前戴森链路中已经发生过的问题：

- 服务端已实现，玩家文档仍是旧口径
- CLI / Web 暴露的能力和 API 文档不一致
- 文档宣称“已可玩”，真实入口却缺失

## 设计参考

- `docs/dev/战争组件设计.md`
- `docs/dev/README.md`
- `docs/player/玩法指南.md`

## 需求细节

1. 所有战争系统公开入口必须统一口径。
2. 文档要明确：
   - 当前真实可玩到哪里
   - 哪些是预置蓝图
   - 如何量产、部署、补给、战报、登陆
   - AI 军事委派如何使用
3. 不能再保留“代码和文档各说各话”的状态。

## 前提任务

- `T120_客户端CLI战争命令与查询链路补齐.md`
- `T121_client_web战争蓝图军工战区与战报工作台.md`
- `T122_战争验证场景与自动化回归基线.md`
- `T123_AI_Agent军事自治权限边界与战区委派闭环.md`

## 可能涉及的代码范围

- `docs/dev/服务端API.md`
- `docs/dev/客户端CLI.md`
- `docs/dev/client-web.md`
- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`
- 其他因战争系统公开能力变化而失效的开发 / 玩家文档

## 改动需求

1. 更新服务端 API 文档，至少覆盖：
   - 蓝图目录与蓝图命令
   - 军工生产 / 翻修 / 部署
   - task force / theater / stance
   - contacts / supply / battle_report
   - blockade / landing / orbital_superiority
2. 更新 CLI 文档，明确：
   - 新增战争命令
   - 查询输出语义
   - 最小战争闭环示例
3. 更新 Web 文档，明确：
   - 蓝图工作台
   - 军工总览
   - 战区面板
   - 战报与情报面板
4. 更新玩家文档，明确：
   - 战争系统真实起步路径
   - 如何从工业推进到战争
   - 如何组织舰队 / 任务群
   - 如何查看补给和战报
   - 如何发起登陆与使用轨道支援
5. 对任何未完全开放的能力，必须明确写清当前边界，不能继续用模糊表述“已完成”。

## 不在本任务范围

- 不要求新增代码功能
- 不要求新增新的战争玩法设计稿

## 验收标准

1. API、CLI、Web、玩家文档对战争系统的口径一致。
2. 文档中每个公开入口都能在真实代码和验证场景中找到对应能力。
3. 对未完成能力有明确边界说明，不再出现误导性“已全部实现”表述。

## 完成情况

- 完成时间：2026-04-21
- 结果：已完成
- 实现摘要：
  - 更新 `docs/dev/服务端API.md`，补齐 `config-war.yaml + map-war.yaml` 官方战争验证场景说明，明确预置科技、军工锚点、补给节点、公开预置蓝图和 `accepted != 最终成功` 的 authoritative 边界。
  - 更新 `docs/dev/客户端CLI.md`，把官方战争验证局作为最小 CLI 闭环的推荐入口，并补充 AI 军事委派的真实使用顺序与权限边界。
  - 更新 `docs/dev/client-web.md`，明确 `/war` 适用的官方战争场景、页面职责，以及 `/war` 与 `/agents` 在战争操作和 AI 委派上的边界分工。
  - 更新 `docs/player/玩法指南.md`，补齐战争系统真实起步路径、蓝图/军工/部署/战区/封锁/登陆链路、AI 军事委派入口，并删除过期的“只剩基础命令表”口径。
  - 更新 `docs/player/上手与验证.md`，把官方战争验证路径扩成可复现的蓝图改型、量产、编舰、任务群、战区、封锁、登陆和 AI 委派验证流程，并写明占位 ID 的获取方式。
- 关键验证：
  - `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/startup ./internal/gateway -count=1`
  - `cd client-cli && npm test -- --test-name-pattern='official war regression'`
  - `cd client-web && npx playwright test tests/war-workbench.spec.ts tests/war-workbench-authoritative.spec.ts`
