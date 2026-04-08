# T105 Fleet Empty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/process/design_final.md` 收口 `/world/fleets` 空态协议，修复 `fleet_status` 在无舰队时崩溃，并同步文档与任务流转状态。

**Architecture:** 服务端在 query 层把舰队列表的 authoritative 空态固定为非 nil 空数组；shared-client 只对 `fetchFleets()` 做局部归一化；CLI 通过可注入 helper 与 formatter 双层兜底锁死空列表行为，同时保持单舰详情的 `404 fleet not found` 协议不变。

**Tech Stack:** Go server, TypeScript shared-client/client-cli, Markdown docs, Go test, Node test

---

### Task 1: 锁住服务端空列表与详情 404 合约

**Files:**
- Modify: `server/internal/query/query_test.go`
- Modify: `server/internal/gateway/server_test.go`
- Modify: `server/internal/query/fleet_runtime.go`

- [ ] **Step 1: 写失败测试**

```go
func TestFleetListReturnsNonNilEmptySlice(t *testing.T) {
	ql, _, _ := newPlanetQueryFixture(t, 16, 16)
	runtime := model.NewSpaceRuntimeState()
	runtime.EnsurePlayerSystem("p1", "sys-1")

	fleets := ql.Fleets("p1", runtime)
	if fleets == nil {
		t.Fatal("expected non-nil empty fleet slice")
	}
	body, err := json.Marshal(fleets)
	if err != nil {
		t.Fatalf("marshal fleets: %v", err)
	}
	if string(body) != "[]" {
		t.Fatalf("expected [], got %s", string(body))
	}
}
```

- [ ] **Step 2: 运行失败测试并确认当前实现返回 `null` / nil slice**

Run: `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/query ./internal/gateway -run 'TestFleet|TestWorldFleets' -count=1`
Expected: `TestFleetListReturnsNonNilEmptySlice` 失败，原因是 `Fleets()` 返回 nil slice。

- [ ] **Step 3: 写最小实现**

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

- [ ] **Step 4: 重新运行 Go 测试**

Run: `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/query ./internal/gateway -run 'TestFleet|TestWorldFleets' -count=1`
Expected: PASS

### Task 2: 锁住 shared-client 空值归一化

**Files:**
- Modify: `client-cli/src/api.test.ts`
- Modify: `shared-client/src/api.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('normalizes null fleet list responses to an empty array', async () => {
  const client = createApiClient({
    serverUrl: 'http://unit.test',
    fetchFn: async () =>
      new Response('null', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });

  assert.deepEqual(await client.fetchFleets(), []);
});
```

- [ ] **Step 2: 运行失败测试确认 `fetchFleets()` 直接透传 `null`**

Run: `cd client-cli && npm test -- --test-name-pattern="normalizes null fleet list responses"`
Expected: FAIL

- [ ] **Step 3: 写最小实现**

```ts
function fetchFleets(): Promise<FleetDetailView[]> {
  return apiFetch<FleetDetailView[] | null>('/world/fleets').then((fleets) => fleets ?? []);
}
```

- [ ] **Step 4: 重新运行 Node 测试**

Run: `cd client-cli && npm test -- --test-name-pattern="normalizes null fleet list responses"`
Expected: PASS

### Task 3: 锁住 CLI 空列表行为

**Files:**
- Create: `client-cli/src/commands/query.test.ts`
- Modify: `client-cli/src/commands/query.ts`
- Modify: `client-cli/src/format.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('prints No fleets found when no fleet exists', async () => {
  const out = await runFleetStatusCommand([], {
    fetchFleets: async () => [],
    fetchFleet: async () => {
      throw new Error('should not fetch detail');
    },
  });
  assert.match(out, /No fleets found\./);
});
```

- [ ] **Step 2: 运行失败测试确认当前实现不可注入且 formatter 对 null 不安全**

Run: `cd client-cli && npm test -- --test-name-pattern="No fleets found|fleet_status"`
Expected: FAIL

- [ ] **Step 3: 写最小实现**

```ts
export interface FleetStatusDeps {
  fetchFleets: () => Promise<FleetDetailView[] | null>;
  fetchFleet: (fleetId: string) => Promise<FleetDetailView>;
}

export function fmtFleetList(fleets?: FleetDetailView[] | null): string {
  const stableFleets = fleets ?? [];
  if (stableFleets.length === 0) {
    return chalk.dim('No fleets found.');
  }
  ...
}
```

- [ ] **Step 4: 重新运行 CLI 测试**

Run: `cd client-cli && npm test -- --test-name-pattern="No fleets found|fleet_status"`
Expected: PASS

### Task 4: 文档同步、任务收尾与整体验证

**Files:**
- Modify: `docs/dev/服务端API.md`
- Modify: `docs/dev/客户端CLI.md`
- Modify: `docs/player/已知问题与回归.md`
- Move: `docs/process/task/T105_无舰队时fleet_status崩溃与world_fleets空值口径.md` -> `docs/process/finished_task/T105_无舰队时fleet_status崩溃与world_fleets空值口径.md`

- [ ] **Step 1: 同步协议与玩家问题状态**

```md
- `GET /world/fleets` 无舰队时返回 `[]`，不会返回 `null`
- `GET /world/fleets/{fleet_id}` 未命中返回 `404 fleet not found`
- `fleet_status` 无参数时若无舰队，稳定输出 `No fleets found.`
```

- [ ] **Step 2: 移动已完成任务文件**

Run: `mv docs/process/task/T105_无舰队时fleet_status崩溃与world_fleets空值口径.md docs/process/finished_task/`
Expected: `docs/process/task/` 不再包含 T105。

- [ ] **Step 3: 跑完整相关测试与实验**

Run: `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/query ./internal/gateway -count=1`
Run: `cd client-cli && npm test`
Expected: PASS

- [ ] **Step 4: 做最小人工实验**

Run: `cd server && /home/firesuiry/sdk/go1.25.0/bin/go test ./internal/gateway -run TestWorldFleetsEndpointReturnsEmptyArrayWhenPlayerHasNoFleets -count=1 -v`
Run: `cd client-cli && npm test -- --test-name-pattern="prints No fleets found when no fleet exists"`
Expected: 分别看到 `/world/fleets` 空数组协议与 CLI 空列表输出都被真实覆盖。
