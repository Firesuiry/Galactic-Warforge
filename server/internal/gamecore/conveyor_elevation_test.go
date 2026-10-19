package gamecore

import (
	"fmt"
	"strings"
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
)

// beltFixture 在干净世界上放一条地面带；elevation > 0 时登记高架层索引
// （与 IndexBuilding 同口径，但不走占地/施工流程）。
func beltFixture(ws *model.WorldState, id string, pos model.Position, dir model.ConveyorDirection, elevation int) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypeConveyorBeltMk1, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypeConveyorBeltMk1,
		OwnerID:     "p1",
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingConveyor(b)
	b.Conveyor.Output = dir
	b.Conveyor.Input = dir.Opposite()
	b.Conveyor.Elevation = elevation
	b.Conveyor.MaxStack = 5
	b.Conveyor.Throughput = 2
	ws.Buildings[id] = b
	if elevation > 0 {
		if err := ws.IndexBeltLayer(b); err != nil {
			panic(err)
		}
	} else {
		ws.TileBuilding[model.TileKey(pos.X, pos.Y)] = id
		ws.Grid[pos.Y][pos.X].BuildingID = id
	}
	return b
}

func newBeltTestWorld() *model.WorldState {
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	return ws
}

func beltAt(ws *model.WorldState, pos model.Position, elevation int) *model.Building {
	if elevation == 0 {
		return ws.Buildings[ws.TileBuilding[model.TileKey(pos.X, pos.Y)]]
	}
	return ws.Buildings[ws.BeltLayerAt(pos.X, pos.Y, elevation)]
}

// 立体交叉：地面横线（east）穿过交叉格，竖线在交叉格前一格升到 1 层、
// 交叉格 1 层、后一格落回 0 层。两条线的货互不串，终点各收各的。
func TestBeltElevationOverpassCrossesWithoutMixing(t *testing.T) {
	ws := newBeltTestWorld()
	// 竖线：北 → 南，在交叉格前一格 (5,4) 已升到 1 层，交叉格 (5,5) 1 层，
	// 后一格 (5,6) 落回 0 层。
	rise := beltFixture(ws, "v-rise", model.Position{X: 5, Y: 4}, model.ConveyorSouth, 1)
	over := beltFixture(ws, "v-over", model.Position{X: 5, Y: 5}, model.ConveyorSouth, 1)
	fall := beltFixture(ws, "v-fall", model.Position{X: 5, Y: 6}, model.ConveyorSouth, 0)
	// 地面横线：西 → 东，穿过交叉格 (5,5)。交叉格上同时有地面带与高架带
	// （高架带允许架在地面带/低矮物流上方）。
	horizIn := beltFixture(ws, "h-in", model.Position{X: 4, Y: 5}, model.ConveyorEast, 0)
	horizCross := beltFixture(ws, "h-cross", model.Position{X: 5, Y: 5}, model.ConveyorEast, 0)
	horizOut := beltFixture(ws, "h-out", model.Position{X: 6, Y: 5}, model.ConveyorEast, 0)
	// 两条线的起点各放一件不同的货。
	vertStart := beltFixture(ws, "v-start", model.Position{X: 5, Y: 3}, model.ConveyorSouth, 0)
	horizStart := beltFixture(ws, "h-start", model.Position{X: 3, Y: 5}, model.ConveyorEast, 0)
	_ = rise
	_ = fall
	vertEnd := beltFixture(ws, "v-end", model.Position{X: 5, Y: 7}, model.ConveyorSouth, 0)
	horizEnd := beltFixture(ws, "h-end", model.Position{X: 7, Y: 5}, model.ConveyorEast, 0)
	_ = over
	_ = horizIn
	_ = horizCross
	_ = horizOut

	vertStart.Conveyor.Insert(model.ItemIronOre, 1)
	horizStart.Conveyor.Insert(model.ItemCopperOre, 1)

	for i := 0; i < 12; i++ {
		settleConveyors(ws)
	}

	if got := vertEnd.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("vertical line end should hold 1 item, got %d", got)
	}
	if vertEnd.Conveyor.Buffer[0].ItemID != model.ItemIronOre {
		t.Fatalf("vertical line end got %s, want iron ore", vertEnd.Conveyor.Buffer[0].ItemID)
	}
	if got := horizEnd.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("horizontal line end should hold 1 item, got %d", got)
	}
	if horizEnd.Conveyor.Buffer[0].ItemID != model.ItemCopperOre {
		t.Fatalf("horizontal line end got %s, want copper ore", horizEnd.Conveyor.Buffer[0].ItemID)
	}
	for _, id := range []string{"v-rise", "v-over", "v-fall", "h-in", "h-out"} {
		if b := ws.Buildings[id]; b.Conveyor.TotalItems() != 0 {
			t.Fatalf("%s should be empty after transfer, got %d", id, b.Conveyor.TotalItems())
		}
	}
}

// 坡道直行上下：0 → 1 → 1 → 0 的竖线能一路走通。
func TestBeltElevationRampUpAndDown(t *testing.T) {
	ws := newBeltTestWorld()
	beltFixture(ws, "s0", model.Position{X: 2, Y: 2}, model.ConveyorSouth, 0)
	beltFixture(ws, "s1", model.Position{X: 2, Y: 3}, model.ConveyorSouth, 1)
	beltFixture(ws, "s2", model.Position{X: 2, Y: 4}, model.ConveyorSouth, 1)
	beltFixture(ws, "s3", model.Position{X: 2, Y: 5}, model.ConveyorSouth, 0)
	end := beltFixture(ws, "s4", model.Position{X: 2, Y: 6}, model.ConveyorSouth, 0)
	ws.Buildings["s0"].Conveyor.Insert(model.ItemIronOre, 1)
	for i := 0; i < 10; i++ {
		settleConveyors(ws)
	}
	if got := end.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("ramp line should deliver 1 item, got %d", got)
	}
}

// 坡道不允许转弯：交叉格 1 层的带子输出朝东（不是直行延续），上游的竖线
// 不能把货送进去。
func TestBeltElevationRampRejectsTurn(t *testing.T) {
	ws := newBeltTestWorld()
	src := beltFixture(ws, "src", model.Position{X: 3, Y: 3}, model.ConveyorSouth, 0)
	turned := beltFixture(ws, "turned", model.Position{X: 3, Y: 4}, model.ConveyorEast, 1)
	src.Conveyor.Insert(model.ItemIronOre, 1)
	for i := 0; i < 6; i++ {
		settleConveyors(ws)
	}
	if got := turned.Conveyor.TotalItems(); got != 0 {
		t.Fatalf("ramp must not turn: got %d items on turned belt", got)
	}
	if got := src.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("source should keep its item (dead end), got %d", got)
	}
}

// 坡道不允许侧汇：侧向来的地面带不能把货汇进高架带（高架带只接受直行延续）。
func TestBeltElevationRampRejectsSideMerge(t *testing.T) {
	ws := newBeltTestWorld()
	side := beltFixture(ws, "side", model.Position{X: 2, Y: 4}, model.ConveyorEast, 0)
	over := beltFixture(ws, "over", model.Position{X: 3, Y: 4}, model.ConveyorSouth, 1)
	side.Conveyor.Insert(model.ItemCopperOre, 1)
	for i := 0; i < 6; i++ {
		settleConveyors(ws)
	}
	if got := over.Conveyor.TotalItems(); got != 0 {
		t.Fatalf("ramp must not accept side merge: got %d items on overpass", got)
	}
	if got := side.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("side belt should keep its item, got %d", got)
	}
}

// 同层优先：邻格同时有 0 层与 1 层候选时，0 层的带子先收。
func TestBeltElevationSameLayerPriority(t *testing.T) {
	ws := newBeltTestWorld()
	src := beltFixture(ws, "src", model.Position{X: 4, Y: 4}, model.ConveyorEast, 0)
	ground := beltFixture(ws, "ground", model.Position{X: 5, Y: 4}, model.ConveyorEast, 0)
	upper := beltFixture(ws, "upper", model.Position{X: 5, Y: 4}, model.ConveyorEast, 1)
	src.Conveyor.Insert(model.ItemIronOre, 1)
	for i := 0; i < 4; i++ {
		settleConveyors(ws)
	}
	if got := ground.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("same-layer candidate should receive the item, got %d", got)
	}
	if got := upper.Conveyor.TotalItems(); got != 0 {
		t.Fatalf("elevated candidate must not receive while same layer is open, got %d", got)
	}
}

// 分拣器只接地面层：高架带不能被分拣器当端点（取货/放货都不行）。
func TestSorterIgnoresElevatedBelt(t *testing.T) {
	ws := newBeltTestWorld()
	sorter := surfaceTestBuilding(ws, "sorter", model.BuildingTypeSorterMk1, model.Position{X: 3, Y: 3})
	model.InitBuildingSorter(sorter)
	beltFixture(ws, "over", model.Position{X: 3, Y: 4}, model.ConveyorSouth, 1)
	if link, ok := sorterFindEndpoint(ws, sorter, model.ConveyorSouth, 1, false); ok {
		t.Fatalf("sorter must not insert into elevated belt, got %s", link.id)
	}
	if link, ok := sorterFindEndpoint(ws, sorter, model.ConveyorSouth, 1, true); ok {
		t.Fatalf("sorter must not take from elevated belt, got %s", link.id)
	}
}

// 读档往返后 BeltLayers 索引与连接不变。
func TestBeltElevationSurvivesSnapshotRoundTrip(t *testing.T) {
	ws := newBeltTestWorld()
	beltFixture(ws, "s0", model.Position{X: 2, Y: 2}, model.ConveyorSouth, 0)
	beltFixture(ws, "s1", model.Position{X: 2, Y: 3}, model.ConveyorSouth, 1)
	beltFixture(ws, "s2", model.Position{X: 2, Y: 4}, model.ConveyorSouth, 1)
	beltFixture(ws, "s3", model.Position{X: 2, Y: 5}, model.ConveyorSouth, 0)
	end := beltFixture(ws, "s4", model.Position{X: 2, Y: 6}, model.ConveyorSouth, 0)
	ws.Buildings["s0"].Conveyor.Insert(model.ItemIronOre, 1)

	restored, err := snapshot.CaptureWorld(ws).Restore()
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if got := restored.BeltLayerAt(2, 3, 1); got != "s1" {
		t.Fatalf("restored belt layer index missing s1, got %q", got)
	}
	if got := restored.BeltLayerAt(2, 4, 1); got != "s2" {
		t.Fatalf("restored belt layer index missing s2, got %q", got)
	}
	if restored.TileBuilding[model.TileKey(2, 3)] != "" {
		t.Fatal("elevated belt leaked into ground TileBuilding")
	}
	for i := 0; i < 10; i++ {
		settleConveyors(restored)
	}
	restoredEnd := restored.Buildings[end.ID]
	if got := restoredEnd.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("restored ramp line should still deliver, end has %d", got)
	}
}

// 地面单位能从高架带下面穿过。
func TestBeltElevationDoesNotBlockGroundUnits(t *testing.T) {
	ws := newBeltTestWorld()
	beltFixture(ws, "over", model.Position{X: 3, Y: 3}, model.ConveyorSouth, 1)
	if ws.Grid[3][3].BuildingID != "" {
		t.Fatal("elevated belt must not write Grid.BuildingID")
	}
	unit := &model.Unit{
		ID:          "u1",
		Type:        model.UnitTypeExecutor,
		OwnerID:     "p1",
		Position:    model.Position{X: 3, Y: 2},
		HP:          100,
		MaxHP:       100,
		VisionRange: 4,
	}
	ws.Units[unit.ID] = unit
	ws.TileUnits[model.TileKey(3, 2)] = []string{unit.ID}
	if !tileWalkableForUnit(ws, model.Position{X: 3, Y: 3}, unit.ID) {
		t.Fatal("ground unit should walk under an elevated belt")
	}
}

// 放置校验：高架带压在熔炉上被拒（POSITION_OCCUPIED 中文文案）。
func TestBuildElevationRejectsOverBuilding(t *testing.T) {
	core := newConstructionTestCore(t, 2)
	ws := core.world
	pos, _ := findTwoOpenTiles(ws)
	profile := model.BuildingProfileFor(model.BuildingTypeArcSmelter, 1)
	smelter := &model.Building{
		ID: "b-smelter", Type: model.BuildingTypeArcSmelter, OwnerID: "p1",
		Position: pos, Runtime: profile.Runtime, HP: profile.MaxHP, MaxHP: profile.MaxHP, Level: 1,
	}
	ws.Buildings[smelter.ID] = smelter
	if err := ws.IndexBuilding(smelter); err != nil {
		t.Fatal(err)
	}
	dir := "east"
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
		Target:  model.CommandTarget{Position: &pos},
		Payload: map[string]any{"building_type": "conveyor_belt_mk1", "direction": dir, "elevation": 1},
	})
	if res.Code != model.CodePositionOccupied || res.Message != "高架传送带不能架在建筑上方" {
		t.Fatalf("elevated belt over smelter: %+v", res)
	}
}

// 放置校验：高架带压在地面带/分拣器上允许。
func TestBuildElevationAllowsOverGroundBelt(t *testing.T) {
	core := newConstructionTestCore(t, 2)
	ws := core.world
	pos, _ := findTwoOpenTiles(ws)
	beltFixture(ws, "ground", pos, model.ConveyorEast, 0)
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
		Target:  model.CommandTarget{Position: &pos},
		Payload: map[string]any{"building_type": "conveyor_belt_mk1", "direction": "north", "elevation": 1},
	})
	if res.Status != model.StatusExecuted {
		t.Fatalf("elevated belt over ground belt should be allowed: %+v", res)
	}
	if key := model.BeltLayerKey(pos.X, pos.Y, 1); ws.Construction.ReservedTiles[key] == "" {
		t.Fatal("elevated task should reserve x:y@e")
	}
	if ws.Construction.ReservedTiles[model.TileKey(pos.X, pos.Y)] != "" {
		t.Fatal("elevated task must not reserve the ground tile")
	}
}

// 放置校验：地面造熔炉压在高架带下被拒。
func TestBuildGroundBuildingRejectedUnderElevatedBelt(t *testing.T) {
	core := newConstructionTestCore(t, 2)
	ws := core.world
	pos, _ := findTwoOpenTiles(ws)
	beltFixture(ws, "over", pos, model.ConveyorEast, 1)
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
		Target:  model.CommandTarget{Position: &pos},
		Payload: map[string]any{"building_type": "arc_smelter", "recipe_id": "smelt_iron"},
	})
	if res.Code != model.CodePositionOccupied || res.Message != "上方有高架传送带" {
		t.Fatalf("ground smelter under elevated belt: %+v", res)
	}
}

// 放置校验：非传送带给 elevation、越界、高架带 auto 都被 INVALID_ELEVATION 拒绝。
func TestBuildElevationValidation(t *testing.T) {
	core := newConstructionTestCore(t, 2)
	ws := core.world
	pos, _ := findTwoOpenTiles(ws)
	cases := []struct {
		name    string
		payload map[string]any
		want    string
	}{
		{"non-belt", map[string]any{"building_type": "arc_smelter", "recipe_id": "smelt_iron", "elevation": 1}, "只有传送带可以架高"},
		{"negative", map[string]any{"building_type": "conveyor_belt_mk1", "direction": "east", "elevation": -1}, fmt.Sprintf("高度只能 0–%d 层", model.MaxBeltElevation)},
		{"out-of-range", map[string]any{"building_type": "conveyor_belt_mk1", "direction": "east", "elevation": model.MaxBeltElevation + 1}, fmt.Sprintf("高度只能 0–%d 层", model.MaxBeltElevation)},
		{"auto", map[string]any{"building_type": "conveyor_belt_mk1", "direction": "auto", "elevation": 1}, "高架传送带必须有明确的输出方向（不能是 auto）"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
				Target:  model.CommandTarget{Position: &pos},
				Payload: tc.payload,
			})
			if res.Code != model.CodeInvalidElevation || res.Message != tc.want {
				t.Fatalf("got %+v, want INVALID_ELEVATION %q", res, tc.want)
			}
		})
	}
}

// 错误信息契约（§3.2）：高架层同格同层的两种冲突都回 POSITION_OCCUPIED，
// 且中文提示要能看出「第几层、和什么冲突」——玩家据此才知道该换层还是拆东西。
func TestBuildElevationLayerConflictMessages(t *testing.T) {
	core := newConstructionTestCore(t, 2)
	ws := core.world
	pos, _ := findTwoOpenTiles(ws)
	beltFixture(ws, "layer1", pos, model.ConveyorEast, 1)

	// 同格同层已有带子：报出层号与占用者归属。
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
		Target:  model.CommandTarget{Position: &pos},
		Payload: map[string]any{"building_type": "conveyor_belt_mk1", "direction": "north", "elevation": 1},
	})
	if res.Code != model.CodePositionOccupied || !strings.Contains(res.Message, "该格已有你的建筑") {
		t.Fatalf("same-layer belt conflict message: %+v", res)
	}

	// 同格同层已有施工任务：提示里带建筑名与任务状态。
	ws.Construction = model.NewConstructionQueue()
	task := &model.ConstructionTask{
		ID: "c-1", PlayerID: "p1", BuildingType: model.BuildingTypeConveyorBeltMk1,
		Position: pos, Elevation: 2, ConveyorDirection: model.ConveyorEast,
		State: model.ConstructionPending,
	}
	if err := ws.Construction.Enqueue(ws, task); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	res, _ = execCommand(core, model.CmdBuild, ws, "p1", model.Command{
		Target:  model.CommandTarget{Position: &pos},
		Payload: map[string]any{"building_type": "conveyor_belt_mk1", "direction": "north", "elevation": 2},
	})
	if res.Code != model.CodePositionOccupied || !strings.Contains(res.Message, "施工任务") || !strings.Contains(res.Message, "传送带") {
		t.Fatalf("same-layer construction conflict message: %+v", res)
	}
}

// 跨层施工预留互查（审查 P2 / 契约 §3.2）：高架带与地面施工任务必须互斥，
// 低矮物流地面任务与高架预留可共存。两个顺序都要覆盖。
func TestConstructionReservationCrossLayerConflicts(t *testing.T) {
	enqueue := func(t *testing.T, ws *model.WorldState, id string, btype model.BuildingType, pos model.Position, elevation int) error {
		t.Helper()
		return ws.Construction.Enqueue(ws, &model.ConstructionTask{
			ID: id, PlayerID: "p1", BuildingType: btype, Position: pos,
			Elevation: elevation, State: model.ConstructionPending,
		})
	}

	t.Run("ground-building-then-elevated-belt-rejected", func(t *testing.T) {
		core := newConstructionTestCore(t, 2)
		ws := core.world
		pos, _ := findTwoOpenTiles(ws)
		ws.Construction = model.NewConstructionQueue()
		if err := enqueue(t, ws, "ground", model.BuildingTypeArcSmelter, pos, 0); err != nil {
			t.Fatalf("enqueue ground task: %v", err)
		}
		res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
			Target:  model.CommandTarget{Position: &pos},
			Payload: map[string]any{"building_type": "conveyor_belt_mk1", "direction": "east", "elevation": 1},
		})
		if res.Code != model.CodePositionOccupied || !strings.Contains(res.Message, "第 1 层") || !strings.Contains(res.Message, "下方有地面施工任务") {
			t.Fatalf("elevated belt over ground construction task: %+v", res)
		}
	})

	t.Run("elevated-belt-then-ground-building-rejected", func(t *testing.T) {
		core := newConstructionTestCore(t, 2)
		ws := core.world
		pos, _ := findTwoOpenTiles(ws)
		ws.Construction = model.NewConstructionQueue()
		if err := enqueue(t, ws, "over", model.BuildingTypeConveyorBeltMk1, pos, 2); err != nil {
			t.Fatalf("enqueue elevated task: %v", err)
		}
		res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
			Target:  model.CommandTarget{Position: &pos},
			Payload: map[string]any{"building_type": "arc_smelter", "recipe_id": "smelt_iron"},
		})
		if res.Code != model.CodePositionOccupied || !strings.Contains(res.Message, "第 2 层") || !strings.Contains(res.Message, "已有传送带施工任务") {
			t.Fatalf("ground building under elevated construction task: %+v", res)
		}
	})

	t.Run("low-logistics-ground-task-coexists", func(t *testing.T) {
		core := newConstructionTestCore(t, 2)
		ws := core.world
		pos, _ := findTwoOpenTiles(ws)
		ws.Construction = model.NewConstructionQueue()
		if err := enqueue(t, ws, "ground-belt", model.BuildingTypeConveyorBeltMk1, pos, 0); err != nil {
			t.Fatalf("enqueue ground belt: %v", err)
		}
		res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
			Target:  model.CommandTarget{Position: &pos},
			Payload: map[string]any{"building_type": "conveyor_belt_mk1", "direction": "east", "elevation": 1},
		})
		if res.Status != model.StatusExecuted {
			t.Fatalf("elevated belt over ground belt construction task should be allowed: %+v", res)
		}
		// 反过来：高架预留不妨碍地面低矮物流任务。
		ws2 := core.world
		ws2.Construction = model.NewConstructionQueue()
		pos2 := pos
		if err := enqueue(t, ws2, "over-2", model.BuildingTypeConveyorBeltMk1, pos2, 1); err != nil {
			t.Fatalf("enqueue elevated task: %v", err)
		}
		res, _ = execCommand(core, model.CmdBuild, ws2, "p1", model.Command{
			Target:  model.CommandTarget{Position: &pos2},
			Payload: map[string]any{"building_type": "splitter"},
		})
		if res.Status != model.StatusExecuted {
			t.Fatalf("ground low-logistics building under elevated construction task should be allowed: %+v", res)
		}
	})

	t.Run("queue-enqueue-enforces-cross-layer", func(t *testing.T) {
		ws := model.NewWorldState("planet-1", 8)
		ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
		ws.Construction = model.NewConstructionQueue()
		pos := model.Position{X: 2, Y: 2}
		if err := enqueue(t, ws, "ground", model.BuildingTypeArcSmelter, pos, 0); err != nil {
			t.Fatalf("enqueue ground: %v", err)
		}
		err := enqueue(t, ws, "over", model.BuildingTypeConveyorBeltMk1, pos, 1)
		if err == nil || !strings.Contains(err.Error(), "第 1 层") || !strings.Contains(err.Error(), "地面施工任务") {
			t.Fatalf("Enqueue must reject elevated belt over ground construction task, got %v", err)
		}
	})
}
