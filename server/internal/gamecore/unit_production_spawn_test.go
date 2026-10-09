package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

// 单位不会同格堆叠（试玩报告 C）：兵营批量出厂时，出生点必须跳过已有地面单位
// 的格子，相邻一圈没有空位就向外扩几圈；再找不到就让单位留在生产队列里等
// 下一 tick，并发一条中文告警（按现有去重规则只报一次）。
//
// 旧实现（findAdjacentFree）只看 ws.TileBuilding，所以一批单位全部落在同一格：
// 实测 p2 的 22 个地面单位只占 8 格，最多 15 个挤在同一格。

// unitStackTestCore 小地图 + p1 有基地与执行体，用于出厂点测试。
func unitStackTestCore(t *testing.T) *GameCore {
	t.Helper()
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	player.Resources.Minerals = 5000
	player.Resources.Energy = 5000
	grantAllItems(ws, "p1", 200)
	grantTechs(ws, "p1", "dyson_sphere_program")
	return core
}

// testBarracks 生成一座队列可控的兵营（直接放世界，不经过电力/施工链）。
// 兵营是耗电建筑：结算要求电网带电才出货，这里给它一座相邻的风机。
func testBarracks(ws *model.WorldState, id string, pos model.Position, owner string) *model.Building {
	b := newBuilding(id, "barracks", owner, pos)
	b.Runtime.State = model.BuildingWorkRunning
	b.Storage.Inventory = model.ItemInventory{model.ItemIronIngot: 400, model.ItemCircuitBoard: 400}
	placeBuilding(ws, b)
	power := ws.SurfaceOffset(pos, 1, 0)
	if ws.InBounds(power.X, power.Y) && ws.Grid[power.Y][power.X].BuildingID == "" {
		gen := newBuilding("gen-"+id, model.BuildingTypeWindTurbine, owner, power)
		gen.Runtime.State = model.BuildingWorkRunning
		placeBuilding(ws, gen)
		settlePowerGeneration(ws, currentPlanetEnvironment(nil, ws.PlanetID))
		finalizePowerSettlement(ws, nil)
	}
	return b
}

// queueUnit 走真实 produce 命令把单位排进生产队列。
func queueUnit(t *testing.T, core *GameCore, ws *model.WorldState, b *model.Building, owner string, utype model.UnitType) {
	t.Helper()
	res, _ := execCommand(core, model.CmdProduce, ws, owner, model.Command{
		Type:    model.CmdProduce,
		Target:  model.CommandTarget{Layer: "planet", EntityID: b.ID},
		Payload: map[string]any{"unit_type": string(utype)},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("produce %s: %s (%s)", utype, res.Code, res.Message)
	}
}

// runUnitProduction 只推进生产队列（跳过电力/施工链），返回产生的全部事件。
func runUnitProduction(ws *model.WorldState, b *model.Building, ticks int) []*model.GameEvent {
	var events []*model.GameEvent
	for i := 0; i < ticks; i++ {
		if len(b.UnitQueue) == 0 {
			return events
		}
		ws.Tick++
		events = append(events, settleUnitProduction(ws)...)
	}
	return events
}

// countOwnedGroundUnits 统计 owner 的存活地面单位与其占用的格子。
func countOwnedGroundUnits(ws *model.WorldState, owner string, utype model.UnitType) (int, map[model.Position]string) {
	seen := map[model.Position]string{}
	n := 0
	for _, u := range ws.Units {
		if u == nil || u.OwnerID != owner || u.HP <= 0 || u.Type != utype {
			continue
		}
		n++
		seen[u.Position] = u.ID
	}
	return n, seen
}

// 一批单位依次出厂时各自占一格，绝不重叠。
func TestUnitProductionNeverStacks(t *testing.T) {
	core := unitStackTestCore(t)
	ws := core.World()
	home := botPlayerHome(t, ws, "p1")
	pos := botAdjacentFreeTile(ws, home, "")
	if pos == nil {
		t.Fatal("no tile for barracks")
	}
	barracks := testBarracks(ws, "barracks-stack", *pos, "p1")

	const count = 12
	for i := 0; i < count; i++ {
		queueUnit(t, core, ws, barracks, "p1", model.UnitTypeSoldier)
	}
	runUnitProduction(ws, barracks, count*80)
	if len(barracks.UnitQueue) != 0 {
		t.Fatalf("queue not drained: %d left", len(barracks.UnitQueue))
	}

	spawned, seen := countOwnedGroundUnits(ws, "p1", model.UnitTypeSoldier)
	if spawned != count {
		t.Fatalf("spawned %d units, want %d", spawned, count)
	}
	if len(seen) != spawned {
		t.Fatalf("%d units share only %d tiles", spawned, len(seen))
	}
}

// 出生点被完全封死时：单位留在队列里、发一条中文告警、不堆叠。
func TestUnitProductionWaitsWhenSpawnBlocked(t *testing.T) {
	core := unitStackTestCore(t)
	ws := core.World()
	// 清出一片平地，保证封死判定可控。
	for y := range ws.Grid {
		for x := range ws.Grid[y] {
			ws.Grid[y][x].Terrain = terrain.TileBuildable
		}
	}
	center := model.Position{X: 10, Y: 10}
	// 先放兵营（自带相邻风机供电），再把出生半径内剩下的每一格都用建筑封死。
	barracks := testBarracks(ws, "barracks-blocked", center, "p1")
	blocked := 0
	for _, tile := range ws.SurfaceDisc(center, unitSpawnRadius+1) {
		if !ws.InBounds(tile.X, tile.Y) || ws.Grid[tile.Y][tile.X].BuildingID != "" {
			continue
		}
		b := newBuilding("wall-"+model.TileKey(tile.X, tile.Y), model.BuildingTypeWindTurbine, "p1", tile)
		b.Runtime.State = model.BuildingWorkRunning
		placeBuilding(ws, b)
		blocked++
	}
	if blocked == 0 {
		t.Fatal("test setup failed to block the spawn ring")
	}
	queueUnit(t, core, ws, barracks, "p1", model.UnitTypeSoldier)

	events := runUnitProduction(ws, barracks, 200)
	if len(barracks.UnitQueue) != 1 {
		t.Fatalf("blocked unit must stay queued, queue=%d", len(barracks.UnitQueue))
	}
	if n, _ := countOwnedGroundUnits(ws, "p1", model.UnitTypeSoldier); n != 0 {
		t.Fatalf("no unit may spawn on a blocked ring, got %d", n)
	}
	alerts := 0
	chinese := false
	for _, ev := range events {
		if ev == nil || ev.EventType != model.EvtProductionAlert {
			continue
		}
		alerts++
		if alert, _ := ev.Payload["alert"].(*model.ProductionAlert); alert != nil && containsChinese(alert.Message) {
			chinese = true
		}
	}
	if alerts != 1 {
		t.Fatalf("expected exactly one spawn-blocked alert, got %d", alerts)
	}
	if !chinese {
		t.Fatal("spawn-blocked alert must carry a Chinese message")
	}
}

// 相邻一圈被占满时向外扩圈，而不是硬塞进同一格。
func TestUnitProductionExpandsOutward(t *testing.T) {
	core := unitStackTestCore(t)
	ws := core.World()
	center := model.Position{X: 12, Y: 12}
	barracks := testBarracks(ws, "barracks-outward", center, "p1")
	// 先把相邻一圈用地面单位占满（模拟"挤成一团"的现场）。
	ring := ws.SurfaceNeighbors(center)
	for _, tile := range ring {
		spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", tile)
	}
	queueUnit(t, core, ws, barracks, "p1", model.UnitTypeSoldier)
	runUnitProduction(ws, barracks, 120)
	if len(barracks.UnitQueue) != 0 {
		t.Fatalf("unit must spawn outward instead of waiting, queue=%d", len(barracks.UnitQueue))
	}
	spawned, seen := countOwnedGroundUnits(ws, "p1", model.UnitTypeSoldier)
	if spawned != len(ring)+1 {
		t.Fatalf("spawned %d units, want %d", spawned, len(ring)+1)
	}
	if len(seen) != spawned {
		t.Fatalf("%d units share only %d tiles", spawned, len(seen))
	}
}
