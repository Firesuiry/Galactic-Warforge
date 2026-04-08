# T105 最终实现方案：无舰队时 `fleet_status` 崩溃与 `/world/fleets` 空值口径

> 日期：2026-04-05
>
> 综合 `docs/process/design_claude.md` 与 `docs/process/design_codex.md`，并对当前仓库实现现状做了再次核对。

## 1. 最终目标

本次要解决的不是单纯“让 CLI 别报错”，而是把舰队查询链路的空状态协议收口成稳定真相：

1. `GET /world/fleets` 在玩家当前没有任何舰队时，必须返回空数组 `[]`，不能返回 `null`。
2. `client-cli fleet_status` 即使面对旧服务端或未来异常回包，也不能因为空值直接崩溃。
3. 有舰队时，现有的舰队列表、舰队详情、`system_runtime` 展示能力都不能回退。
4. API 文档与 CLI 文档必须把“空列表”和“详情未命中”的协议写清楚。

## 2. 最终取舍

### 2.1 authoritative 真相放在 query 层，不放在 transport 层

最终采用在 `server/internal/query/fleet_runtime.go` 的 `Layer.Fleets()` 中直接固定列表语义：

- `spaceRuntime == nil` 时继续返回空切片
- 正常存在 `spaceRuntime` 但当前玩家无舰队时，也返回非 nil 空切片
- 推荐直接把 `out` 初始化为 `make([]FleetDetailView, 0)`，而不是在函数尾部做补丁式 `if out == nil`

原因：

- `Fleets()` 本来就是 authoritative 视图构造层，列表资源的空态语义应该在这里定死
- `handleFleets()` 只负责 HTTP transport，不应该承担业务语义判断
- `writeJSON()` 做全局 nil-slice 特判会扩大影响面，容易误伤其他接口

### 2.2 详情接口继续保持 `404 fleet not found`

最终不修改 `GET /world/fleets/{fleet_id}` 的未命中协议，继续保持：

- 命中时返回对象
- 未命中时返回 `404 fleet not found`

这里对“与新的列表口径保持一致”的最终解释是：

- 列表接口的空态是 `[]`
- 单资源详情的未命中态是 `404`
- 两者都必须是显式协议，不能再让客户端靠 `null` 做特殊猜测

也就是说，一致性来自“都不依赖 `null` 作为隐式状态”，而不是把不同资源语义强行做成同一种返回体。

### 2.3 客户端链路采用三层收口，而不是单点补丁

最终采用三层收口：

1. 服务端在 query 层修正 authoritative 列表语义
2. `shared-client` 只对 `fetchFleets()` 做局部归一化
3. CLI 在命令层和 formatter 层继续做 null-safe 兜底

不采用“只改 CLI”或“只改服务端”的原因：

- 只改 CLI 只能止血，不能修正 authoritative API
- 只改服务端会让 CLI 仍然脆弱，未来再遇到异常值仍可能直接炸掉

## 3. 详细设计

### 3.1 服务端：固定 `/world/fleets` 空态为稳定数组

目标文件：

- `server/internal/query/fleet_runtime.go`

设计要求：

- `Layer.Fleets()` 无论是否查到舰队，都返回 `[]FleetDetailView`
- 不再返回 nil slice

建议实现形态：

```go
func (ql *Layer) Fleets(playerID string, spaceRuntime *model.SpaceRuntimeState) []FleetDetailView {
    if spaceRuntime == nil {
        return []FleetDetailView{}
    }
    out := make([]FleetDetailView, 0)
    for _, playerRuntime := range spaceRuntime.Players {
        if playerRuntime == nil || playerRuntime.PlayerID != playerID {
            continue
        }
        for _, systemRuntime := range playerRuntime.Systems {
            if systemRuntime == nil {
                continue
            }
            for _, fleet := range systemRuntime.Fleets {
                if fleet == nil {
                    continue
                }
                out = append(out, fleetDetailView(fleet))
            }
        }
    }
    return out
}
```

最终效果：

- `GET /world/fleets` 在无舰队时编码结果为 `[]`
- 不再出现 JSON `null`

### 3.2 服务端网关：保持列表与详情的职责分离

目标文件：

- `server/internal/gateway/server.go`

设计要求：

- `handleFleets()` 不增加额外空值修补逻辑
- `handleFleet()` 继续保持未命中 `404`

这样可以保证：

- 列表资源的语义在 query 层确定
- 单资源详情的未命中语义继续由网关维持显式错误协议

### 3.3 shared-client：只对 `fetchFleets()` 做局部归一化

目标文件：

- `shared-client/src/api.ts`

最终方案不改通用 `apiFetch()`，只改 `fetchFleets()`：

```ts
function fetchFleets(): Promise<FleetDetailView[]> {
  return apiFetch<FleetDetailView[] | null>('/world/fleets').then((fleets) => fleets ?? []);
}
```

原因：

- `fetchFleets()` 语义上本就应该稳定返回数组
- 局部归一化可以把类型承诺与运行时行为对齐
- 不改 `apiFetch()` 可以避免把其他接口本来有意义的 `null` 意外吞掉

### 3.4 CLI：命令层可测试化，formatter 继续兜底

目标文件：

- `client-cli/src/commands/query.ts`
- `client-cli/src/format.ts`

最终设计采用两层处理。

第一层：把 `cmdFleetStatus()` 提炼成可注入依赖的 helper，例如：

```ts
interface FleetStatusDeps {
  fetchFleets: () => Promise<FleetDetailView[] | null>;
  fetchFleet: (fleetId: string) => Promise<FleetDetailView>;
}
```

再提供：

- `runFleetStatusCommand(args, deps)` 作为可测 helper
- `cmdFleetStatus(args)` 作为传真实依赖的薄包装

这样做的目的不是额外抽象，而是让 CLI 行为测试可以直接注入假数据，不必依赖脆弱的全局 mock。

第二层：`fmtFleetList()` 自身继续做 null-safe 收口：

```ts
export function fmtFleetList(fleets?: FleetDetailView[] | null): string {
  const stableFleets = fleets ?? [];
  if (stableFleets.length === 0) {
    return chalk.dim('No fleets found.');
  }
  ...
}
```

原因：

- shared-client 已归一化，但 formatter 再做一次 `?? []` 成本极低
- CLI 当前崩溃点就在 formatter，本地兜底能直接封死这一类回归
- 这也与现有 `fmtSystemRuntime()` 的稳态写法保持一致

## 4. 测试设计

### 4.1 query 层测试：锁死 nil slice 根因

建议文件：

- `server/internal/query/fleet_runtime_test.go`
  或扩展
- `server/internal/query/query_test.go`

至少覆盖：

1. `spaceRuntime == nil` 时返回非 nil 空切片
2. 当前玩家无舰队时返回非 nil 空切片
3. 对返回值做 `json.Marshal(...)` 时结果严格为 `[]`
4. 有舰队时仍返回完整的 `fleet_id / system_id / formation / units`

### 4.2 gateway 测试：锁死 HTTP 合约

建议文件：

- `server/internal/gateway/server_test.go`

至少覆盖：

1. `GET /world/fleets` 在无舰队时返回 `200`，body 为 `[]`，不是 `null`
2. `GET /world/fleets/{fleet_id}` 未命中时继续返回 `404`
3. 有舰队时列表结果仍包含正确舰队字段

### 4.3 shared-client 测试：锁死归一化行为

建议文件：

- 扩展 `client-cli/src/api.test.ts`

建议做法：

- 通过 `createApiClient(...)` 注入 `fakeFetch`
- 让 `/world/fleets` 返回 `200 + null`
- 断言 `fetchFleets()` 最终得到 `[]`

这样无需给 `shared-client` 单独引入新的测试命令，也能把归一化逻辑锁住。

### 4.4 CLI 行为测试：锁死空列表输出与 happy path

建议文件：

- 新增 `client-cli/src/commands/query.test.ts`

至少覆盖：

1. `runFleetStatusCommand([], deps)` 在 `fetchFleets -> []` 时输出 `No fleets found.`
2. `runFleetStatusCommand([], deps)` 在 `fetchFleets -> null` 时仍输出 `No fleets found.`，且不抛异常
3. 有舰队时仍能列出 `fleet_id / system_id / formation / units`

## 5. 文档同步

目标文件：

- `docs/dev/服务端API.md`
- `docs/dev/客户端CLI.md`
- `docs/player/已知问题与回归.md`

同步要求：

### 5.1 服务端 API 文档

- `GET /world/fleets` 明确写出：
  - 无舰队时返回 `[]`
  - 不返回 `null`
  - 增加空列表响应示例
- `GET /world/fleets/{fleet_id}` 明确写出：
  - 未命中返回 `404 fleet not found`

### 5.2 CLI 文档

- `fleet_status` 无参数时查询舰队列表
- 无舰队时输出 `No fleets found.`
- 指定不存在的 `fleet_id` 时走现有错误分支，不暴露 JS `TypeError`

### 5.3 玩家问题文档

- 将 T105 从当前问题更新为已收口或待验证已修复
- 明确 `/world/fleets` 的空值口径已从 `null` 改为 `[]`
- 明确 `fleet_status` 空列表时会稳定显示 `No fleets found.`

## 6. 实际落地文件清单

| 文件 | 改动类型 | 目的 |
| --- | --- | --- |
| `server/internal/query/fleet_runtime.go` | 修改 | 固定舰队列表空态为非 nil 空切片 |
| `server/internal/query/fleet_runtime_test.go` 或 `server/internal/query/query_test.go` | 新增/扩展 | 锁住 query 层空列表语义 |
| `server/internal/gateway/server_test.go` | 扩展 | 锁住 HTTP `[]` 与详情 `404` 合约 |
| `shared-client/src/api.ts` | 修改 | 对 `fetchFleets()` 做局部归一化 |
| `client-cli/src/api.test.ts` | 扩展 | 锁住旧服务端 `null` 回包的兼容性 |
| `client-cli/src/commands/query.ts` | 修改 | 提炼可测试的 `runFleetStatusCommand(...)` |
| `client-cli/src/commands/query.test.ts` | 新增 | 锁住 `fleet_status` 空态与正常展示 |
| `client-cli/src/format.ts` | 修改 | `fmtFleetList()` 做 null-safe 兜底 |
| `docs/dev/服务端API.md` | 修改 | 明确 `[]` 与 `404` 口径 |
| `docs/dev/客户端CLI.md` | 修改 | 明确 `No fleets found.` 行为 |
| `docs/player/已知问题与回归.md` | 修改 | 更新 T105 问题状态 |

## 7. 验收标准

1. 默认新局和官方 midgame 中，在没有任何 fleet 的前提下执行 `fleet_status`，CLI 输出 `No fleets found.`，不再报 `TypeError`。
2. `GET /world/fleets` 在无舰队时返回 `[]`，不是 `null`。
3. `GET /world/fleets/{fleet_id}` 未命中时继续返回 `404 fleet not found`。
4. 已有舰队时，`fleet_status` 与 `system_runtime` 的现有展示能力不回退。
5. 新增的服务端测试与客户端测试全部通过。

## 8. 不在本次范围内

- 不修改 `SystemRuntimeView.Fleets` 的 `omitempty` 语义；`system_runtime` 是复合视图，不必强行与专用列表接口共享空态表现。
- 不在 `writeJSON()` 或其他全局层做 nil-slice 魔法替换。
- 不把整个仓库所有列表接口都做一轮 nil-slice 清洗；本次只修已经暴露给玩家的舰队查询链路。

## 9. 结论

T105 的正确落地方式不是单点补丁，而是三层收口：

1. 服务端在 query 层把 `/world/fleets` 的 authoritative 空态固定为 `[]`
2. shared-client 把 `fetchFleets()` 的类型承诺兑现为稳定数组
3. CLI 在命令层与 formatter 层继续兜底，并补上真正锁回归的行为测试

这样处理后，玩家在“尚未拥有舰队”的正常状态下不会再撞上 CLI 内部异常，同时 API、shared-client、CLI 三层的协议边界也会保持清晰且低耦合。
