# T105 无舰队时 `fleet_status` 崩溃与 `/world/fleets` 空值口径

## 问题背景

- 日期：`2026-04-05`
- 本轮深度试玩已确认：
  - 默认新局起步链可玩
  - 官方 midgame 的主要 DSP 建筑、戴森主链与接收站模式切换都能真实走通
  - 终局派生验证局下，`deploy_squad`、`commission_fleet`、`fleet_assign`、`fleet_status`、`system_runtime` 也已经能在“已有舰队”的状态下正常工作
- 因此，本轮不再把“戴森相关建筑、科技树、玩法整体未实现”记录为当前缺口；新发现的是一个更具体的 CLI/API 口径问题。

## 复现环境

- 默认新局：
  - 端口：`18410`
  - 数据目录：`/tmp/sw-dsp-default.jTl8RW/data`
- 官方 midgame：
  - 端口：`18411`
  - 数据目录：`/tmp/sw-dsp-mid.NA7lTf/data`
- 玩家：
  - `p1 / key_player_1`
- 客户端入口：
  - `client-cli`

## 复现

1. 启动默认新局或官方 midgame。
2. 登录 `p1`。
3. 不创建任何 fleet，直接执行：
   - `fleet_status`
4. 同时对服务端直接查询：
   - `curl -sf -H 'Authorization: Bearer key_player_1' http://127.0.0.1:<port>/world/fleets`

## 实际现象

- CLI 当前会直接报错：
  - `Error: TypeError: Cannot read properties of null (reading 'length')`
- 直接查询服务端可见：
  - `GET /world/fleets` 返回的是 JSON `null`
  - 而不是空数组 `[]`
- `client-cli/src/commands/query.ts` 当前直接把 `fetchFleets()` 返回值交给 `fmtFleetList(...)`
- `client-cli/src/format.ts` 的 `fmtFleetList` 直接读取 `fleets.length`
- 这意味着“当前没有舰队”这个正常状态，会被 `null` 口径击穿成 CLI 崩溃

## 影响

- 终局舰队线虽然已经开放，但玩家在“尚未拥有舰队”的起始观察面上会先撞到 CLI 异常
- 这会误导试玩者，以为舰队查询入口仍未实现或客户端不稳定
- `docs/dev/服务端API.md`、`docs/dev/客户端CLI.md` 当前都把这条线描述成公开可用，因此空值口径必须和玩家入口保持一致

## 改动要求

### 1. 收口 `/world/fleets` 的空值返回

- authoritative 接口在“当前没有任何舰队”时必须返回空数组 `[]`
- 不要继续返回 `null`
- `GET /world/fleets/{fleet_id}` 的未命中口径也要与新的列表口径保持一致，避免前端/CLI 再做特殊空值分支

### 2. 补强 `client-cli fleet_status` 的空值防护

- 即使服务端未来再次回出 `null`，CLI 也不能直接抛 JS `TypeError`
- 最低要求：
  - `fleet_status` 在空列表时稳定显示类似 `No fleets found.`
  - 不再向玩家暴露内部异常栈或空值实现细节

### 3. 补测试锁死这条回归

- 至少补以下验证：
  - 服务端在无舰队时，`GET /world/fleets` 返回 `[]`
  - `client-cli fleet_status` 在无舰队时输出稳定文本，不崩溃
  - 有舰队时，`fleet_status` 仍能正常列出：
    - `fleet_id`
    - `system_id`
    - `formation`
    - `units`

### 4. 同步文档口径

- 如接口返回从 `null` 改为 `[]`，需要同步更新：
  - `docs/dev/服务端API.md`
  - `docs/dev/客户端CLI.md`
- 文档需要明确：
  - 无舰队时的列表返回
  - `fleet_status` 的空列表输出

## 验收标准

1. 默认新局和官方 midgame 中，在还没有任何 fleet 的前提下执行 `fleet_status`，CLI 不再报 `TypeError`。
2. `GET /world/fleets` 在无舰队时返回空数组 `[]`，而不是 `null`。
3. 已有舰队时，`fleet_status` 与 `system_runtime` 的现有展示能力不回退。
