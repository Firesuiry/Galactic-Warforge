# T105 实现方案：无舰队时 `fleet_status` 崩溃与 `/world/fleets` 空值口径

> 日期：2026-04-05
>
> 基于 `docs/process/finished_task/T105_无舰队时fleet_status崩溃与world_fleets空值口径.md` 的改动要求。

## 1. 问题根因分析

### 1.1 服务端：Go nil slice 被 JSON 序列化为 `null`

`server/internal/query/fleet_runtime.go:73-95` 中 `Fleets()` 方法的实现：

```go
func (ql *Layer) Fleets(playerID string, spaceRuntime *model.SpaceRuntimeState) []FleetDetailView {
    if spaceRuntime == nil {
        return []FleetDetailView{}  // ← 这条路径正确，返回空切片
    }
    var out []FleetDetailView       // ← nil slice
    for _, playerRuntime := range spaceRuntime.Players {
        // ... 遍历逻辑
    }
    return out                      // ← 如果没有匹配到任何舰队，返回 nil
}
```

当 `spaceRuntime` 不为 nil 但当前玩家没有任何舰队时，`out` 始终为 `nil`。Go 的 `json.Encode(nil slice)` 输出 `null`，而 `json.Encode([]T{})` 输出 `[]`。

`handleFleets` 直接把 `Fleets()` 的返回值传给 `writeJSON`：

```go
func (s *Server) handleFleets(w http.ResponseWriter, r *http.Request, playerID string) {
    writeJSON(w, http.StatusOK, s.ql.Fleets(playerID, s.core.SpaceRuntime()))
}
```

因此当玩家无舰队时，`GET /world/fleets` 返回 JSON `null`。

### 1.2 客户端：`fmtFleetList` 未做空值防护

`client-cli/src/commands/query.ts:107-116` 中 `cmdFleetStatus` 直接把 `fetchFleets()` 返回值传给 `fmtFleetList`：

```typescript
export async function cmdFleetStatus(args: string[]): Promise<string> {
    try {
        if (!args[0]) {
            return fmtFleetList(await fetchFleets());
        }
        return fmtFleetDetail(await fetchFleet(args[0]));
    } catch (e) {
        return fmtError(String(e));
    }
}
```

`shared-client/src/api.ts` 中 `fetchFleets()` 的返回类型声明为 `Promise<FleetDetailView[]>`，但实际 JSON 反序列化后可能是 `null`。

`client-cli/src/format.ts:254` 中 `fmtFleetList` 直接访问 `fleets.length`：

```typescript
export function fmtFleetList(fleets: FleetDetailView[]): string {
    if (fleets.length === 0) {  // ← null.length → TypeError
```

## 2. 改动方案

### 2.1 服务端：确保 `Fleets()` 始终返回非 nil 切片

**文件：** `server/internal/query/fleet_runtime.go`

**改动：** 在 `Fleets()` 方法的 return 前，将 nil slice 转为空切片。

```go
func (ql *Layer) Fleets(playerID string, spaceRuntime *model.SpaceRuntimeState) []FleetDetailView {
    if spaceRuntime == nil {
        return []FleetDetailView{}
    }
    var out []FleetDetailView
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
    if out == nil {
        return []FleetDetailView{}
    }
    return out
}
```

这样无论走哪条路径，`GET /world/fleets` 都会返回 `[]` 而不是 `null`。

### 2.2 客户端：`fmtFleetList` 补空值防护

**文件：** `client-cli/src/format.ts`

**改动：** 在 `fmtFleetList` 入口处对 `null` / `undefined` 做防护。

```typescript
export function fmtFleetList(fleets: FleetDetailView[]): string {
    if (!fleets || fleets.length === 0) {
        return chalk.dim('No fleets found.');
    }
    // ... 后续不变
}
```

这是防御性编程：即使服务端未来再次返回 `null`，CLI 也不会崩溃。

### 2.3 共享客户端 API 层：`fetchFleets` 补空值归一化

**文件：** `shared-client/src/api.ts`

**改动：** 在 `fetchFleets` 返回前将 `null` 归一化为空数组。

```typescript
async function fetchFleets(): Promise<FleetDetailView[]> {
    return (await apiFetch<FleetDetailView[]>('/world/fleets')) ?? [];
}
```

这样所有消费 `fetchFleets` 的客户端（CLI、Web）都能拿到稳定的空数组，不需要各自做空值分支。

## 3. 测试设计

### 3.1 服务端单元测试

**文件：** `server/internal/query/fleet_runtime_test.go`（新增或扩展）

测试用例：

1. **无舰队时返回空切片**
   - 构造一个有效的 `SpaceRuntimeState`，但当前玩家没有任何舰队
   - 断言 `Fleets()` 返回 `[]FleetDetailView{}`（非 nil）
   - 断言 JSON 序列化结果为 `[]`

2. **`spaceRuntime` 为 nil 时返回空切片**
   - 断言 `Fleets(playerID, nil)` 返回 `[]FleetDetailView{}`
   - 断言 JSON 序列化结果为 `[]`

3. **有舰队时正常返回**
   - 构造包含舰队的 `SpaceRuntimeState`
   - 断言返回的 `FleetDetailView` 包含正确的 `fleet_id`、`system_id`、`formation`、`units`

### 3.2 客户端测试

**文件：** `client-cli/src/commands/index.test.ts`（扩展现有）

测试用例：

1. **`fleet_status` 在空列表时输出稳定文本**
   - mock `fetchFleets` 返回 `[]`
   - 断言输出包含 `No fleets found.`

2. **`fleet_status` 在 null 时输出稳定文本**
   - mock `fetchFleets` 返回 `null`
   - 断言输出包含 `No fleets found.`，不抛异常

3. **`fleet_status` 有舰队时正常列出**
   - mock `fetchFleets` 返回包含舰队的数组
   - 断言输出包含 `fleet_id`、`System`、`Formation`、`Units`

## 4. 文档同步

### 4.1 `docs/dev/服务端API.md`

在 `GET /world/fleets` 段落补充空值口径说明：

- 当前玩家没有任何舰队时，返回空数组 `[]`，不返回 `null`
- 响应示例补充空列表场景：`[]`

### 4.2 `docs/dev/客户端CLI.md`

在 `fleet_status` 段落补充空列表行为说明：

- 无舰队时输出 `No fleets found.`
- 不再抛出内部异常

### 4.3 `docs/player/已知问题与回归.md`

- 将 T105 从"本轮新问题"更新为"已收口"
- 明确：`GET /world/fleets` 空值口径已从 `null` 改为 `[]`
- 明确：`fleet_status` 在无舰队时稳定显示 `No fleets found.`

## 5. 实际落地文件清单

| 序号 | 文件 | 改动类型 | 说明 |
|------|------|----------|------|
| 1 | `server/internal/query/fleet_runtime.go` | 修改 | `Fleets()` 返回空切片而非 nil |
| 2 | `client-cli/src/format.ts` | 修改 | `fmtFleetList` 补空值防护 |
| 3 | `shared-client/src/api.ts` | 修改 | `fetchFleets` 返回值归一化 |
| 4 | `server/internal/query/fleet_runtime_test.go` | 新增/扩展 | 锁住空值口径回归 |
| 5 | `client-cli/src/commands/index.test.ts` | 扩展 | 锁住 CLI 空值防护回归 |
| 6 | `docs/dev/服务端API.md` | 修改 | 补充空列表口径 |
| 7 | `docs/dev/客户端CLI.md` | 修改 | 补充空列表行为 |
| 8 | `docs/player/已知问题与回归.md` | 修改 | T105 标记为已收口 |

## 6. 验收标准

1. 默认新局和官方 midgame 中，在没有任何 fleet 的前提下执行 `fleet_status`，CLI 输出 `No fleets found.`，不报 `TypeError`。
2. `GET /world/fleets` 在无舰队时返回 `[]`，不返回 `null`。
3. `GET /world/fleets` 在有舰队时，返回的每个条目包含 `fleet_id` / `system_id` / `formation` / `units`。
4. 已有舰队时，`fleet_status` 与 `system_runtime` 的现有展示能力不回退。
5. 新增测试全部通过。

## 7. 不在本次范围内

- `SystemRuntimeView.Fleets` 字段使用了 `omitempty`，在无舰队时会被省略（不出现在 JSON 中）。这与 `GET /world/fleets` 的语义不同：`system_runtime` 是一个复合视图，省略空字段是合理的；而 `GET /world/fleets` 是专门的列表接口，必须返回稳定的数组类型。因此本次不改动 `SystemRuntimeView` 的 `omitempty` 行为。
- 其他接口的类似 nil slice 问题（如果存在）不在本次范围内，但建议后续做一次全局审查。
