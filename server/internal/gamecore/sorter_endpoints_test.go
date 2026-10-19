package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// 分拣器端点诊断（第 22 轮）：两端都连上、背面空、正面被另一台分拣器挡住
// （logistics.md §9 反例）、放货端建筑没有输入口。

func newDiagnosticSorterWorld(t *testing.T) *model.WorldState {
	t.Helper()
	ws := model.NewWorldState("planet-1", 16)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	return ws
}

func TestDiagnoseSorterBothEndpointsConnected(t *testing.T) {
	ws := newDiagnosticSorterWorld(t)
	input := newConveyorBuilding("b-in", model.Position{X: 2, Y: 4}, model.ConveyorEast)
	output := newConveyorBuilding("b-out", model.Position{X: 4, Y: 4}, model.ConveyorEast)
	sorter := newSorterBuilding("b-sorter", model.Position{X: 3, Y: 4}) // 背面西、正面东
	attachBuilding(ws, input)
	attachBuilding(ws, output)
	attachBuilding(ws, sorter)

	view := DiagnoseSorterEndpoints(ws, sorter)
	if view == nil {
		t.Fatal("expected sorter endpoint view")
	}
	if view.Pick.BuildingID != "b-in" || view.Pick.BuildingType != model.BuildingTypeConveyorBeltMk1 {
		t.Fatalf("pick endpoint = %+v", view.Pick)
	}
	if view.Pick.Steps != 1 || view.Pick.Direction != string(model.ConveyorWest) {
		t.Fatalf("pick steps/direction = %+v", view.Pick)
	}
	if view.Drop.BuildingID != "b-out" || view.Drop.Steps != 1 || view.Drop.Direction != string(model.ConveyorEast) {
		t.Fatalf("drop endpoint = %+v", view.Drop)
	}
	if view.Pick.Reason != "" || view.Drop.Reason != "" {
		t.Fatalf("connected endpoints must not carry a reason: %+v", view)
	}

	// 诊断必须与真实搬运口径一致：settleSorters 真能搬。
	input.Conveyor.Insert(model.ItemIronOre, 1)
	settleSorters(ws)
	if got := output.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("diagnosed route must actually transfer, moved %d", got)
	}
}

func TestDiagnoseSorterPickSideEmpty(t *testing.T) {
	ws := newDiagnosticSorterWorld(t)
	output := newConveyorBuilding("b-out", model.Position{X: 4, Y: 4}, model.ConveyorEast)
	sorter := newSorterBuilding("b-sorter", model.Position{X: 3, Y: 4})
	attachBuilding(ws, output)
	attachBuilding(ws, sorter)

	view := DiagnoseSorterEndpoints(ws, sorter)
	if view.Pick.Reason != model.SorterEndpointReasonNoBuilding {
		t.Fatalf("empty back side must report no_building, got %+v", view.Pick)
	}
	if view.Pick.BuildingID != "" || view.Pick.BlockerID != "" {
		t.Fatalf("empty back side must not name a building, got %+v", view.Pick)
	}
	if view.Drop.BuildingID != "b-out" {
		t.Fatalf("drop endpoint = %+v", view.Drop)
	}
}

// logistics.md §9 反例：熔炉与补给站紧贴，两台分拣器正好面对面，互相挡住。
func TestDiagnoseSorterDropBlockedByAnotherSorter(t *testing.T) {
	ws := newDiagnosticSorterWorld(t)
	smelter := newProductionTestBuilding("b-55", model.BuildingTypeArcSmelter, model.Position{X: 14, Y: 14}, "smelt_iron")
	storage := newBuilding("b-105", model.BuildingTypeSupplyStation, "p1", model.Position{X: 17, Y: 14})
	east := newSorterBuilding("b-181", model.Position{X: 16, Y: 13}) // 正面东
	east.Rotation = model.PlanRotation90
	west := newSorterBuilding("b-182", model.Position{X: 17, Y: 13}) // 正面西
	west.Rotation = model.PlanRotation270
	attachBuilding(ws, smelter)
	attachBuilding(ws, storage)
	attachBuilding(ws, east)
	attachBuilding(ws, west)

	view := DiagnoseSorterEndpoints(ws, east)
	if view.Drop.Reason != model.SorterEndpointReasonBlockedBySorter {
		t.Fatalf("drop blocked by facing sorter: %+v", view.Drop)
	}
	if view.Drop.BlockerID != "b-182" || view.Drop.BlockerType != model.BuildingTypeSorterMk1 || view.Drop.Steps != 1 {
		t.Fatalf("blocker must be the facing sorter b-182 at 1 step, got %+v", view.Drop)
	}
	if view.Drop.BuildingID != "" {
		t.Fatalf("blocked drop endpoint must not report a building, got %+v", view.Drop)
	}
	// 背面是空地：同一条 y=13 轴上没有熔炉（熔炉从 y=14 开始）。
	if view.Pick.Reason != model.SorterEndpointReasonNoBuilding {
		t.Fatalf("pick side should be empty in the §9 layout, got %+v", view.Pick)
	}
}

func TestDiagnoseSorterDropTargetWithoutInputPort(t *testing.T) {
	ws := newDiagnosticSorterWorld(t)
	// 采矿机只有 out-0 输出口，不能当放货端。
	miner := newBuilding("b-miner", model.BuildingTypeMiningMachine, "p1", model.Position{X: 5, Y: 4})
	sorter := newSorterBuilding("b-sorter", model.Position{X: 3, Y: 4}) // 正面东
	attachBuilding(ws, miner)
	attachBuilding(ws, sorter)

	view := DiagnoseSorterEndpoints(ws, sorter)
	if view.Drop.Reason != model.SorterEndpointReasonNoPort {
		t.Fatalf("drop onto output-only building must report no_port, got %+v", view.Drop)
	}
	if view.Drop.BlockerID != "b-miner" || view.Drop.BlockerType != model.BuildingTypeMiningMachine {
		t.Fatalf("blocker must name the miner, got %+v", view.Drop)
	}
	// 同一台采矿机作为取货端是有效的（有输出口），但这里在正面，不参与取货。
	if view.Pick.Reason != model.SorterEndpointReasonNoBuilding {
		t.Fatalf("pick side should be empty, got %+v", view.Pick)
	}
}

func TestDiagnoseSorterReportsNotOwnedAndSplitter(t *testing.T) {
	ws := newDiagnosticSorterWorld(t)
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	enemyBelt := newConveyorBuilding("b-enemy", model.Position{X: 2, Y: 4}, model.ConveyorEast)
	enemyBelt.OwnerID = "p2"
	splitter := newBuilding("b-split", model.BuildingTypeSplitter, "p1", model.Position{X: 4, Y: 4})
	model.InitBuildingConveyor(splitter)
	sorter := newSorterBuilding("b-sorter", model.Position{X: 3, Y: 4})
	attachBuilding(ws, enemyBelt)
	attachBuilding(ws, splitter)
	attachBuilding(ws, sorter)

	view := DiagnoseSorterEndpoints(ws, sorter)
	if view.Pick.Reason != model.SorterEndpointReasonNotOwned {
		t.Fatalf("enemy belt must report not_owned, got %+v", view.Pick)
	}
	if view.Pick.BlockerID != "b-enemy" {
		t.Fatalf("not_owned must name the enemy belt, got %+v", view.Pick)
	}
	if view.Drop.Reason != model.SorterEndpointReasonSplitter {
		t.Fatalf("splitter must report splitter, got %+v", view.Drop)
	}
}

// 建造回执预判：排队中（尚未落成）的建筑也要算进端点。
func TestSorterBuildReceiptPredictsEndpointsIncludingPending(t *testing.T) {
	core := newConstructionTestCore(t, 2)
	ws := core.world
	player := ws.Players["p1"]
	grantAllItems(ws, "p1", 500)
	base, err := findOpenTileForType(ws, 3, model.BuildingTypeArcSmelter)
	if err != nil || base == nil {
		t.Fatalf("no open tile for smelter: %v", err)
	}
	smelterPos := *base
	// 熔炉先下单（施工任务，尚未落成）。
	res := buildAt(t, core, ws, smelterPos, model.BuildingTypeArcSmelter)
	if res.Code != model.CodeOK {
		t.Fatalf("queue smelter: %s (%s)", res.Code, res.Message)
	}
	// 熔炉东侧 1 格放分拣器：背面西 = 熔炉，正面东 = 空地。
	sorterPos, ok := eastNeighbor(ws, smelterPos)
	if !ok {
		t.Fatal("no free tile east of the smelter footprint")
	}
	res = buildRotatedAt(t, core, ws, sorterPos, model.BuildingTypeSorterMk1, 90)
	if res.Code != model.CodeOK {
		t.Fatalf("queue sorter: %s (%s)", res.Code, res.Message)
	}
	if !strings.Contains(res.Message, "取货端：电弧熔炉（施工中，任务 c-") {
		t.Fatalf("receipt must predict the pending smelter as pick endpoint, got %q", res.Message)
	}
	if !strings.Contains(res.Message, "放货端：未连上") {
		t.Fatalf("receipt must report the empty drop side, got %q", res.Message)
	}
	_ = player
}

// eastNeighbor 返回熔炉占地（3×3）正东 1 格、且整格可建的位置。
func eastNeighbor(ws *model.WorldState, anchor model.Position) (model.Position, bool) {
	fp := model.Footprint{Width: 3, Height: 3}
	origin := model.Position{X: anchor.X + fp.Width, Y: anchor.Y}
	if !ws.FootprintFits(origin, model.Footprint{Width: 1, Height: 1}, model.BuildingTypeSorterMk1, "") {
		return model.Position{}, false
	}
	return origin, true
}

func buildRotatedAt(t *testing.T, core *GameCore, ws *model.WorldState, pos model.Position, btype model.BuildingType, rotation int) model.CommandResult {
	t.Helper()
	res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
		Type:   model.CmdBuild,
		Target: model.CommandTarget{Position: &pos},
		Payload: map[string]any{
			"building_type": string(btype),
			"rotation":      rotation,
		},
	})
	return res
}
