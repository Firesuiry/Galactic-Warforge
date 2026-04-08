# T105 设计方案：无舰队时 `fleet_status` 崩溃与 `/world/fleets` 空值口径

> 日期：2026-04-05
>
> 本文针对 `docs/process/finished_task/T105_无舰队时fleet_status崩溃与world_fleets空值口径.md`。
> 该任务现已归档完成，本文保留为 T105 的设计记录。

## 1. 目标与边界

这次不是要“把 CLI 报错糊住”，而是把舰队查询链路的空状态协议收口为一套稳定真相：

1. `GET /world/fleets` 在“没有任何舰队”时必须返回稳定数组 `[]`，而不是 `null`。
2. `client-cli fleet_status` 即使面对历史服务端或未来异常回包，也不能因为空值直接崩溃。
3. 已有舰队时，现有的舰队列表、单舰详情、`system_runtime` 展示能力不能回退。
4. API 文档与 CLI 文档必须把“空列表”与“详情未命中”的口径写清楚。

本次不做的事：

- 不改 `system_runtime.fleets` 的 `omitempty` 语义。
- 不把 `/world/fleets/{fleet_id}` 的未命中从 `404` 改成 `200 + null` 或其他变体。
- 不顺手做全仓库 nil-slice 全局清洗；只修这条已经暴露给玩家的 authoritative 链路。

## 2. 当前代码事实

### 2.1 服务端空列表目前会被编码成 `null`

`server/internal/query/fleet_runtime.go` 中，`Layer.Fleets()` 当前逻辑是：

- `spaceRuntime == nil` 时直接返回 `[]FleetDetailView{}`
- 但正常存在 `spaceRuntime`、只是当前玩家没有舰队时，`out` 从未初始化为非 nil slice
- 最终 `return out` 时返回的是 Go 的 nil slice

`server/internal/gateway/server.go` 中 `handleFleets()` 直接：

```go
writeJSON(w, http.StatusOK, s.ql.Fleets(playerID, s.core.SpaceRuntime()))
```

因此 HTTP 层会把 nil slice 编码成 JSON `null`，这正是任务文档里的复现结果。

### 2.2 详情接口当前已经是明确的“未命中即 404”

`server/internal/gateway/server.go` 的 `handleFleet()` 当前逻辑是：

- 查询不到舰队时：`writeError(w, http.StatusNotFound, "fleet not found")`
- 查询到舰队时：返回正常对象

所以详情接口的问题不是“也会返回 null”，而是文档和客户端要明确：列表接口的空态是 `[]`，详情接口的未命中态是 `404 fleet not found`。两者都应该是稳定协议，而不是让调用方去猜 `null`。

### 2.3 shared-client 的类型承诺与真实返回不一致

`shared-client/src/api.ts` 当前把：

```ts
function fetchFleets(): Promise<FleetDetailView[]> {
  return apiFetch<FleetDetailView[]>('/world/fleets');
}
```

类型声明成“永远返回数组”，但底层服务端现在实际可能回 `null`。这会把协议漂移向上传染给所有消费方。

### 2.4 CLI 当前在格式化阶段直接触发崩溃

`client-cli/src/commands/query.ts` 的 `cmdFleetStatus()` 在无参数时直接：

```ts
return fmtFleetList(await fetchFleets());
```

而 `client-cli/src/format.ts` 的 `fmtFleetList()` 当前第一行就读 `fleets.length`。只要传入的是 `null`，就会抛：

```text
TypeError: Cannot read properties of null (reading 'length')
```

值得注意的是，同文件的 `fmtSystemRuntime()` 已经采用了更稳的模式：

```ts
const fleets = runtime.fleets ?? [];
```

也就是说，CLI 内部其实已经有同类空值收口范式，只是 `fmtFleetList()` 没跟上。

### 2.5 现有测试没有锁住这条协议

本次调研里跑了两组现状校验：

```bash
cd server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH \
  go test ./internal/query ./internal/gateway ./internal/gamecore -run 'Fleet|SystemRuntime'
```

结果：

- `internal/query`：`[no tests to run]`
- `internal/gateway`：`[no tests to run]`
- `internal/gamecore`：现有舰队 happy path 测试通过

以及：

```bash
cd client-cli
npm test -- --test-name-pattern='fleet|runtime|api exports'
```

结果：

- 现有 CLI 测试通过
- 但覆盖点主要是命令注册、runtime 白名单、API 导出存在性
- 还没有“无舰队时 `fleet_status` 输出稳定文本”的行为测试

结论很直接：这条问题当前没有被测试锁死。

## 3. 方案比选

### 方案 A：只在 CLI 里做空值保护

做法：

- 仅修改 `client-cli/src/format.ts` 或 `client-cli/src/commands/query.ts`

优点：

- 改动最少
- 能立即止住 CLI 崩溃

缺点：

- authoritative API 仍然返回错误口径 `null`
- 其他调用方以后仍会踩同样的坑
- 文档无法继续宣称 `/world/fleets` 是稳定数组接口

结论：不采用。它只是在消费层补洞，没有修协议真相。

### 方案 B：只修服务端列表返回

做法：

- 仅修改 `server/internal/query/fleet_runtime.go`

优点：

- authoritative 口径被修正
- 绝大多数正常客户端都能恢复

缺点：

- CLI 仍然脆弱，一旦连到旧版本服务端或未来又有类似空值漂移，还是会直接崩
- shared-client 的类型承诺依然没有被防御性兑现

结论：不采用。它修了根因，但没有把调用链的防线补全。

### 方案 C：服务端 authoritative 收口 + shared-client 归一化 + CLI 展示兜底

做法：

- 服务端保证 `/world/fleets` 空态返回 `[]`
- shared-client 对 `fetchFleets()` 做局部归一化
- CLI 在格式化层继续做 null-safe 兜底
- 用服务端、API 层、CLI 三层测试锁回归

优点：

- authoritative 真相正确
- 客户端对旧服务端和未来异常值更稳
- 变更点集中，不需要搞全局 JSON 魔法

缺点：

- 改动面比单点补丁大
- 需要补几处测试

结论：采用。这个方案同时满足“优雅实现”和“低耦合防回归”。

## 4. 推荐设计

### 4.1 服务端：在 query 层把舰队列表语义固定成“永远是数组”

目标文件：

- `server/internal/query/fleet_runtime.go`

推荐改法：

- 直接把 `out` 初始化为非 nil 空切片，而不是在 return 前做临时补丁

建议形态：

```go
func (ql *Layer) Fleets(playerID string, spaceRuntime *model.SpaceRuntimeState) []FleetDetailView {
    if spaceRuntime == nil {
        return []FleetDetailView{}
    }
    out := make([]FleetDetailView, 0)
    ...
    return out
}
```

这样做比“最后 `if out == nil { return []FleetDetailView{} }`”更直接，原因有两个：

1. 语义从函数入口就明确了：这是一个列表接口，不存在 `nil` 这种第三种状态。
2. 不需要在函数尾部补救，逻辑更干净。

为什么不在 `handleFleets()` 或 `writeJSON()` 层做？

- `handleFleets()` 只负责 transport，不该知道 `nil` slice 在业务上代表什么。
- `writeJSON()` 如果做全局 nil-slice 特判，会把仓库里其他接口的语义一起改变，风险过大。
- `Fleets()` 本来就是构造视图对象的 authoritative 层，列表形态应该在这里定死。

### 4.2 详情接口：继续保持 `404 fleet not found`

目标文件：

- `server/internal/gateway/server.go`
- `docs/dev/服务端API.md`

推荐结论：

- `/world/fleets/{fleet_id}` 未命中时继续返回 `404`
- 本次只把文档写清楚，不改协议形态

原因：

- 详情接口与列表接口不是同一种资源语义
- 列表“空”应是 `[]`
- 详情“未命中”应是 `404`
- 统一的不是“都返回数组”，而是“都不再用 `null` 作为调用方必须特殊猜测的协议分支”

这也满足任务里“未命中口径保持一致”的真正目的：让前端和 CLI 面对的是显式协议，而不是 `null`。

### 4.3 shared-client：只在 `fetchFleets()` 做局部归一化，不做全局空值魔改

目标文件：

- `shared-client/src/api.ts`

推荐改法：

```ts
function fetchFleets(): Promise<FleetDetailView[]> {
  return apiFetch<FleetDetailView[] | null>('/world/fleets').then((fleets) => fleets ?? []);
}
```

设计原则：

- 只对 `fetchFleets()` 这个明确“应该返回数组”的接口做归一化
- 不去修改通用 `apiFetch()`，避免把其他接口的 `null` 含义意外吞掉

这样有两个价值：

1. shared-client 的类型承诺终于和运行时行为一致。
2. 即便 CLI 连接到旧服务端，也能拿到稳定数组。

附带收益：

- 虽然 `client-web` 当前没有消费 `fetchFleets()`，但未来如果接入同一路径，也会自动受益。

### 4.4 CLI：把 `fleet_status` 抽成可注入依赖的 helper，并在 formatter 继续兜底

目标文件：

- `client-cli/src/commands/query.ts`
- `client-cli/src/format.ts`
- 新增 `client-cli/src/commands/query.test.ts`

推荐改法分两层。

### 第一层：提炼可测试 helper

参照 `client-cli/src/commands/debug.ts` 中 `runSaveCommand(...)` 的模式，把当前 `cmdFleetStatus()` 改成：

- 一个纯命令 helper，例如 `runFleetStatusCommand(args, deps)`
- 一个薄包装 `cmdFleetStatus(args)`，只负责传真实依赖

建议依赖形态：

```ts
interface FleetStatusDeps {
  fetchFleets: () => Promise<FleetDetailView[] | null>;
  fetchFleet: (fleetId: string) => Promise<FleetDetailView>;
}
```

这样做的原因不是“为了抽象而抽象”，而是当前 ESM 直引 API 函数很难做局部 mock。抽成 helper 后，CLI 行为测试可以直接注入假数据，不需要碰全局 `fetch` 或模块替换。

### 第二层：formatter 自身继续 null-safe

`client-cli/src/format.ts` 推荐把签名放宽为：

```ts
export function fmtFleetList(fleets?: FleetDetailView[] | null): string
```

内部第一步统一：

```ts
const stableFleets = fleets ?? [];
```

然后按空列表输出：

```ts
chalk.dim('No fleets found.')
```

为什么 shared-client 已经归一化了，CLI 还要兜底？

- 因为 CLI 崩溃点就在 formatter，本地再做一次 `?? []` 成本极低
- 这样 formatter 本身就和 `fmtSystemRuntime()` 的稳态写法一致
- 即使未来其他调用方直接把 `null` 传进来，也不会炸

### 4.5 文档：把“空列表”和“详情未命中”明确写成协议

目标文件：

- `docs/dev/服务端API.md`
- `docs/dev/客户端CLI.md`

服务端 API 文档需要新增的明确口径：

- `GET /world/fleets`
  - 当前玩家无舰队时返回 `[]`
  - 不返回 `null`
  - 补一个空列表响应示例
- `GET /world/fleets/{fleet_id}`
  - 未命中时返回 `404 fleet not found`

CLI 文档需要新增的明确口径：

- `fleet_status`
  - 无参数时查询舰队列表
  - 当前无舰队时输出 `No fleets found.`
  - 传 `fleet_id` 且不存在时，继续走现有错误输出分支，不暴露 JS `TypeError`

可选但建议的同步：

- `docs/player/已知问题与回归.md`
  - 把 T105 从“当前问题”改成“已修复/待验证已收口”

## 5. 测试设计

### 5.1 服务端 query 测试：锁死 nil slice 根因

建议文件：

- `server/internal/query/query_test.go`
- 或拆成新文件 `server/internal/query/fleet_runtime_test.go`

推荐用例：

### 用例 1：当前玩家无舰队时返回非 nil 空切片

构造：

- 有 `SpaceRuntimeState`
- 有当前玩家 runtime
- 但所有 system runtime 下都没有舰队

断言：

- `Fleets("p1", runtime)` 返回长度为 0
- 返回值不是 nil

### 用例 2：JSON 编码结果是 `[]`

对上面的返回值直接 `json.Marshal(...)`

断言：

- 编码结果严格等于 `[]`

这条测试能直接锁住根因，不会再让 nil slice 偷渡回来。

### 5.2 服务端 gateway 测试：锁死 HTTP 合约

建议文件：

- `server/internal/gateway/server_test.go`

推荐新增用例：

### 用例 1：`GET /world/fleets` 在无舰队时返回空数组

步骤：

1. 用现有 `newTestServer(t)` 起服务
2. 不做任何 `commission_fleet`
3. 带 `Bearer key1` 请求 `GET /world/fleets`

断言：

- HTTP `200`
- 响应 JSON 可以解成 `[]any`
- 长度为 `0`
- 原始 body 不为 `null`

### 用例 2：`GET /world/fleets/{fleet_id}` 未命中仍是 404

步骤：

- 请求不存在的 `fleet_id`

断言：

- HTTP `404`
- 错误文案包含 `fleet not found`

这样可以防止后续有人误把详情接口也改成 `200 + null`。

### 5.3 shared-client 测试：锁死归一化行为

考虑到 `shared-client` 目录当前没有独立 test script，推荐把这条测试放在已有的 `client-cli` 测试体系里，直接导入 `createApiClient(...)`。

建议文件：

- `client-cli/src/api.test.ts`

推荐用例：

### 用例：旧服务端回 `null` 时，`fetchFleets()` 仍返回 `[]`

做法：

- 用 `createApiClient({ serverUrl: 'http://example.test', auth: { playerKey: 'key1' }, fetchFn: fakeFetch })`
- 让 fake fetch 对 `/world/fleets` 返回 HTTP 200，body 为 `null`，并带 `Content-Type: application/json`

断言：

- `await client.fetchFleets()` 得到 `[]`

这样不需要为 `shared-client` 单独引入新的测试命令，也能把归一化逻辑锁住。

### 5.4 CLI 命令测试：锁死空列表输出与有舰队展示

建议文件：

- 新增 `client-cli/src/commands/query.test.ts`

推荐用例：

### 用例 1：空列表时输出 `No fleets found.`

步骤：

- 调 `runFleetStatusCommand([], { fetchFleets: async () => [], ... })`

断言：

- 输出包含 `No fleets found.`

### 用例 2：依赖层返回 `null` 时仍稳定输出

步骤：

- 调 `runFleetStatusCommand([], { fetchFleets: async () => null, ... })`

断言：

- 输出包含 `No fleets found.`
- 不抛异常

### 用例 3：有舰队时仍列出关键信息

步骤：

- 注入一条舰队数据

断言：

- 输出包含 `FleetID`
- 输出包含 `fleet-demo`
- 输出包含 `sys-1`
- 输出包含 `wedge` 或其他 formation
- 输出包含单位栈文本

这样既锁空态，又锁 happy path 不回退。

## 6. 落地文件清单

| 文件 | 改动类型 | 目的 |
| --- | --- | --- |
| `server/internal/query/fleet_runtime.go` | 修改 | 把 `/world/fleets` 的空态收口为非 nil 空切片 |
| `server/internal/query/query_test.go` 或 `server/internal/query/fleet_runtime_test.go` | 新增/扩展 | 锁住 query 层空列表编码语义 |
| `server/internal/gateway/server_test.go` | 扩展 | 锁住 HTTP `[]` 合约与详情 `404` |
| `shared-client/src/api.ts` | 修改 | 仅对 `fetchFleets()` 做局部归一化 |
| `client-cli/src/commands/query.ts` | 修改 | 提炼 `runFleetStatusCommand(...)` 便于测试 |
| `client-cli/src/format.ts` | 修改 | `fmtFleetList()` 做 null-safe 兜底 |
| `client-cli/src/api.test.ts` | 扩展 | 锁 shared-client 归一化行为 |
| `client-cli/src/commands/query.test.ts` | 新增 | 锁 CLI 空列表输出与正常列表展示 |
| `docs/dev/服务端API.md` | 修改 | 明确 `[]` 与 `404` 口径 |
| `docs/dev/客户端CLI.md` | 修改 | 明确 `No fleets found.` 空态输出 |

## 7. 验收与验证计划

实现完成后，建议至少跑以下验证。

### 7.1 自动化测试

服务端：

```bash
cd /home/firesuiry/develop/siliconWorld/server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH \
  go test ./internal/query ./internal/gateway
```

CLI：

```bash
cd /home/firesuiry/develop/siliconWorld/client-cli
npm test
```

### 7.2 手工回归

默认新局与官方 midgame 都要验证一遍。

空舰队场景：

1. 登录 `p1`
2. 不创建任何舰队
3. 执行 `fleet_status`
4. 直接请求 `GET /world/fleets`

断言：

- `fleet_status` 输出 `No fleets found.`
- `GET /world/fleets` 返回 `[]`

有舰队场景：

1. `transfer`
2. `commission_fleet`
3. `fleet_assign`
4. `fleet_status`
5. `system_runtime`

断言：

- `fleet_status` 仍能展示 `fleet_id / system_id / formation / units`
- `system_runtime` 中对应舰队仍可见

## 8. 风险与注意事项

### 8.1 不要把修复做成全局 JSON 特判

如果在 `writeJSON()` 里做 nil-slice 统一替换，会影响整个服务端所有接口。这个问题当前只在 `Fleets()` 的 authoritative 列表语义上被确认，不应该用全局魔法扩大影响面。

### 8.2 不要顺手改 `system_runtime.fleets`

`SystemRuntimeView.Fleets` 目前带 `omitempty`，在无舰队时省略字段。这和 `/world/fleets` 作为“专门的列表资源”不是一个层级。本次只修列表接口，不混改复合视图语义。

### 8.3 不要把详情未命中伪装成空对象

`/world/fleets/{fleet_id}` 的语义是“单资源查询”。未命中继续走 `404` 才是正确协议；如果改成 `200 + null` 或 `200 + {}`，只会把调用方判断变复杂。

## 9. 结论

T105 的正确收口方式不是单点补丁，而是三层收口：

1. 服务端把 `/world/fleets` 的 authoritative 空态固定为 `[]`
2. shared-client 把 `fetchFleets()` 的类型承诺兑现为稳定数组
3. CLI 在 formatter 与命令 helper 层继续兜底，并补上真正的行为测试

这样修完后：

- 玩家在“尚未拥有舰队”的正常状态下不会再撞 `TypeError`
- API、shared-client、CLI 三层口径一致
- 详情未命中与列表空态各自保持清晰且低耦合的协议语义
