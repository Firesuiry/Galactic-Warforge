package gamecore

import (
	"fmt"
	"testing"

	"siliconworld/internal/model"
)

// buildElevatedWorld 造一个最小世界：玩家背包有货、机甲就在旁边，用于
// 通过真实 build 命令（入队 → 落成）验证高架带全流程。
func buildElevatedWorld(t *testing.T) (*GameCore, *model.WorldState) {
	t.Helper()
	core := newConstructionTestCore(t, 4, 4)
	ws := core.world
	// 机甲放到地图中间，保证建造范围（operate_range 100）覆盖测试格。
	execState := ws.Players["p1"].ExecutorForPlanet(ws.PlanetID)
	if execState == nil {
		t.Fatal("test world has no executor")
	}
	unit := ws.Units[execState.UnitID]
	if unit == nil {
		t.Fatal("test world has no executor unit")
	}
	unit.Position = model.Position{X: 20, Y: 20}
	return core, ws
}

func buildAndComplete(t *testing.T, core *GameCore, ws *model.WorldState, payload map[string]any, pos model.Position) model.CommandResult {
	t.Helper()
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
		Target:  model.CommandTarget{Position: &pos},
		Payload: payload,
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("build %v at %v rejected: %+v", payload, pos, res)
	}
	for _, task := range ws.Construction.Tasks {
		if task.Position.X == pos.X && task.Position.Y == pos.Y {
			if _, err := core.completeConstructionTask(ws, task); err != nil {
				t.Fatalf("complete construction: %v", err)
			}
			return res
		}
	}
	t.Fatalf("construction task at %v not found", pos)
	return res
}

// 高架带经完整 build 流程落成后：conveyor.elevation 写入、BeltLayers 登记、
// 地面层 TileBuilding 不被占用。
func TestElevatedBeltBuildLifecycle(t *testing.T) {
	core, ws := buildElevatedWorld(t)
	pos := model.Position{X: 20, Y: 21}
	buildAndComplete(t, core, ws, map[string]any{
		"building_type": "conveyor_belt_mk1", "direction": "east", "elevation": 2,
	}, pos)

	id := ws.BeltLayerAt(pos.X, pos.Y, 2)
	if id == "" {
		t.Fatal("elevated belt missing from BeltLayers")
	}
	b := ws.Buildings[id]
	if b == nil || b.Conveyor == nil || b.Conveyor.Elevation != 2 {
		t.Fatalf("elevated belt state wrong: %+v", b)
	}
	if ws.TileBuilding[model.TileKey(pos.X, pos.Y)] != "" {
		t.Fatal("elevated belt must not occupy the ground layer")
	}
	if ws.Grid[pos.Y][pos.X].BuildingID != "" {
		t.Fatal("elevated belt must not write Grid.BuildingID")
	}

	// 拆掉：BeltLayers 同步释放。
	core.execDemolish(ws, "p1", model.Command{Target: model.CommandTarget{EntityID: id}}, noPayload{})
	if ws.BeltLayerAt(pos.X, pos.Y, 2) != "" {
		t.Fatal("demolished elevated belt still indexed")
	}
}

// 高架带必须有明确方向：只给 rotation 时按 rotation 推（rotation 90 = east）。
func TestElevatedBeltDirectionFromRotation(t *testing.T) {
	core, ws := buildElevatedWorld(t)
	pos := model.Position{X: 20, Y: 21}
	buildAndComplete(t, core, ws, map[string]any{
		"building_type": "conveyor_belt_mk1", "rotation": 180, "elevation": 1,
	}, pos)
	id := ws.BeltLayerAt(pos.X, pos.Y, 1)
	if id == "" {
		t.Fatal("elevated belt missing")
	}
	if got := ws.Buildings[id].Conveyor.Output; got != model.ConveyorSouth {
		t.Fatalf("rotation 180 should give south output, got %s", got)
	}
}

// 同层施工占位：两个高架任务不能占同一格同一层，但可以分别占 1 层与 2 层。
func TestElevatedBeltConstructionLayerReservation(t *testing.T) {
	core, ws := buildElevatedWorld(t)
	pos := model.Position{X: 20, Y: 21}
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
		Target:  model.CommandTarget{Position: &pos},
		Payload: map[string]any{"building_type": "conveyor_belt_mk1", "direction": "east", "elevation": 1},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("first elevated task rejected: %+v", res)
	}
	res, _ = execCommand(core, model.CmdBuild, ws, "p1", model.Command{
		Target:  model.CommandTarget{Position: &pos},
		Payload: map[string]any{"building_type": "conveyor_belt_mk1", "direction": "east", "elevation": 1},
	})
	if res.Code != model.CodePositionOccupied {
		t.Fatalf("duplicate layer reservation should be rejected, got %+v", res)
	}
	res, _ = execCommand(core, model.CmdBuild, ws, "p1", model.Command{
		Target:  model.CommandTarget{Position: &pos},
		Payload: map[string]any{"building_type": "conveyor_belt_mk1", "direction": "east", "elevation": 2},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("different layer should be allowed, got %+v", res)
	}
	if ws.Construction.ReservedTiles[model.TileKey(pos.X, pos.Y)] != "" {
		t.Fatal("elevated tasks must not reserve the ground tile")
	}
}

// 高架带上面还能再架一层（同格 1 层 + 2 层），层索引互不覆盖。
func TestElevatedBeltStackedLayers(t *testing.T) {
	core, ws := buildElevatedWorld(t)
	pos := model.Position{X: 20, Y: 21}
	buildAndComplete(t, core, ws, map[string]any{
		"building_type": "conveyor_belt_mk1", "direction": "east", "elevation": 1,
	}, pos)
	// 直接调 completeConstructionTask 会留下已完成的旧任务；走正常施工推进
	// （推进一 tick 让队列处理）再下第二层，避免同 ID 复用。
	if len(ws.Construction.Tasks) != 0 {
		for _, task := range ws.Construction.Tasks {
			_ = ws.Construction.Transition(task.ID, model.ConstructionCompleted)
			ws.Construction.Remove(task.ID)
		}
	}
	buildAndComplete(t, core, ws, map[string]any{
		"building_type": "conveyor_belt_mk1", "direction": "north", "elevation": 2,
	}, pos)
	if ws.BeltLayerAt(pos.X, pos.Y, 1) == "" || ws.BeltLayerAt(pos.X, pos.Y, 2) == "" {
		t.Fatal("stacked elevated belts should both be indexed")
	}
	if ws.BeltLayerAt(pos.X, pos.Y, 1) == ws.BeltLayerAt(pos.X, pos.Y, 2) {
		t.Fatal("stacked layers must be distinct buildings")
	}
}

// 施工任务落成前地面被非低矮物流建筑占用：落成失败（不静默覆盖地面）。
func TestElevatedBeltCompletionRejectsGroundBuilding(t *testing.T) {
	core, ws := buildElevatedWorld(t)
	pos := model.Position{X: 20, Y: 21}
	// 先把地面熔炉放好，再塞一个高架施工任务（模拟「下单后地面被占」的时序）。
	profile := model.BuildingProfileFor(model.BuildingTypeArcSmelter, 1)
	smelter := &model.Building{
		ID: "b-smelter", Type: model.BuildingTypeArcSmelter, OwnerID: "p1",
		Position: pos, Runtime: profile.Runtime, HP: profile.MaxHP, MaxHP: profile.MaxHP, Level: 1,
	}
	ws.Buildings[smelter.ID] = smelter
	if err := ws.IndexBuilding(smelter); err != nil {
		t.Fatal(err)
	}
	ws.Construction = model.NewConstructionQueue()
	task := &model.ConstructionTask{
		ID: "c-late", PlayerID: "p1", BuildingType: model.BuildingTypeConveyorBeltMk1,
		Position: pos, Elevation: 1, ConveyorDirection: model.ConveyorEast,
		Cost:  model.BuildCost{},
		State: model.ConstructionPending,
	}
	if _, err := core.completeConstructionTask(ws, task); err == nil {
		t.Fatal("elevated belt completion over a smelter must fail")
	}
	if got := fmt.Sprint(ws.BeltLayerAt(pos.X, pos.Y, 1)); got != "" {
		t.Fatalf("failed completion must not index the belt, got %s", got)
	}
}

// 契约 §3.2：拆除高架带按 building id，照常退料、从 BeltLayers 删除，
// 地面同格的分拣器/地面带不受影响（高架与地面是两条独立实体）。
func TestElevatedBeltDemolishRefundsAndKeepsGroundBuilding(t *testing.T) {
	core, ws := buildElevatedWorld(t)
	pos := model.Position{X: 20, Y: 21}
	buildAndComplete(t, core, ws, map[string]any{
		"building_type": "conveyor_belt_mk1", "direction": "east", "elevation": 2,
	}, pos)
	beltID := ws.BeltLayerAt(pos.X, pos.Y, 2)
	if beltID == "" {
		t.Fatal("elevated belt missing from BeltLayers")
	}
	belt := ws.Buildings[beltID]

	// 地面同格放一台分拣器（低矮物流，允许高架带压在上面）。
	sorterProfile := model.BuildingProfileFor(model.BuildingTypeSorterMk1, 1)
	sorter := &model.Building{
		ID: "b-sorter-under", Type: model.BuildingTypeSorterMk1, OwnerID: "p1",
		Position: pos, Level: 1, Runtime: sorterProfile.Runtime,
		HP: sorterProfile.MaxHP, MaxHP: sorterProfile.MaxHP,
	}
	ws.Buildings[sorter.ID] = sorter
	if err := ws.IndexBuilding(sorter); err != nil {
		t.Fatalf("index ground sorter: %v", err)
	}
	ws.Construction = model.NewConstructionQueue()
	ws.Players["p1"].Inventory = model.ItemInventory{}

	refund := model.BuildingDemolishRefundWithRate(belt.Type, belt.Level, model.BuildingDemolishRuleFor(belt.Type).RefundRate)
	if len(refund.Items) == 0 {
		t.Fatal("belt should refund materials")
	}
	res, _ := execCommand(core, model.CmdDemolish, ws, "p1", model.Command{
		Target: model.CommandTarget{EntityID: beltID},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("demolish elevated belt failed: %+v", res)
	}
	for _, item := range refund.Items {
		if got := ws.Players["p1"].Inventory[item.ItemID]; got < item.Quantity {
			t.Fatalf("refund %s: got %d, want >= %d", item.ItemID, got, item.Quantity)
		}
	}
	if ws.Buildings[beltID] != nil || ws.BeltLayerAt(pos.X, pos.Y, 2) != "" {
		t.Fatal("demolished elevated belt still indexed")
	}
	// 地面同格的分拣器必须原样保留（高架带被摧毁不影响地面层）。
	if ws.Buildings[sorter.ID] == nil {
		t.Fatal("ground sorter removed by elevated belt demolition")
	}
	if got := ws.TileBuilding[model.TileKey(pos.X, pos.Y)]; got != sorter.ID {
		t.Fatalf("ground tile index lost after elevated demolition: %q", got)
	}
}
