package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestPowerShortageShutdown(t *testing.T) {
	ws := newPowerTestWorld()
	gen := addPowerTestBuilding(ws, "gen-1", model.BuildingTypeWindTurbine, model.Position{X: 1, Y: 1})
	consumer := addPowerTestBuilding(ws, "c-1", model.BuildingTypeMiningMachine, model.Position{X: 2, Y: 1})
	addResourceNode(ws, "r-1", consumer.Position, 8)

	ws.PowerInputs = nil
	ws.PowerGrid = model.BuildPowerGridGraph(ws)

	events := settleResources(ws)
	if consumer.Runtime.State != model.BuildingWorkNoPower {
		t.Fatalf("expected consumer no_power, got %s", consumer.Runtime.State)
	}
	if ws.Players["p1"].Resources.Minerals != 0 {
		t.Fatalf("expected minerals unchanged, got %d", ws.Players["p1"].Resources.Minerals)
	}
	if ws.Players["p1"].Resources.Energy != 20 {
		t.Fatalf("expected energy unchanged, got %d", ws.Players["p1"].Resources.Energy)
	}
	if len(events) == 0 {
		t.Fatalf("expected power shortage event")
	}
	_ = gen
}

func TestPowerShortageSlowdown(t *testing.T) {
	ws := newPowerTestWorld()
	// 细分网格：采矿机 3×3 + 采集覆盖 1 圈 = 5×5，两台机器必须离得比这更远，
	// 才不会有人的覆盖范围吃到别人的矿；电网连线距离只有 3，改用无线输电塔
	// （无线覆盖 18）把两台都接上。
	gen := addPowerTestBuilding(ws, "gen-1", model.BuildingTypeWirelessPowerTower, model.Position{X: 1, Y: 1})
	gen.Runtime.Params.ConnectionPoints = []model.ConnectionPoint{
		{ID: "power", Kind: model.ConnectionPower, Offset: model.GridOffset{X: 0, Y: 0}, Capacity: 0},
	}
	// 本用例只关心两个耗电建筑之间的分配：输电塔当纯电源，自身不耗电。
	gen.Runtime.Params.EnergyConsume = 0
	if gen.Runtime.Functions.Energy != nil {
		gen.Runtime.Functions.Energy.ConsumePerTick = 0
	}

	high := addPowerTestBuilding(ws, "c-1", model.BuildingTypeMiningMachine, model.Position{X: 2, Y: 1})
	low := addPowerTestBuilding(ws, "c-2", model.BuildingTypeMiningMachine, model.Position{X: 2, Y: 8})
	addResourceNode(ws, "r-1", high.Position, 8)
	addResourceNode(ws, "r-2", low.Position, 8)

	high.Runtime.Params.PowerPriority = 5
	low.Runtime.Params.PowerPriority = 1

	ws.PowerInputs = []model.PowerInput{{BuildingID: gen.ID, OwnerID: "p1", Output: 3}}
	ws.PowerGrid = model.BuildPowerGridGraph(ws)

	settleResources(ws)

	if high.Runtime.State != model.BuildingWorkRunning {
		t.Fatalf("expected high priority running, got %s", high.Runtime.State)
	}
	if low.Runtime.State != model.BuildingWorkRunning {
		t.Fatalf("expected low priority running (slow), got %s", low.Runtime.State)
	}
	// 供电 3 分给两台（优先级 5 与 1）：高优先级按满功率 8，低优先级按剩余比例。
	// 细分网格后采矿机是 3×3，覆盖范围内的资源格数量变了，这里只断言"高优先级
	// 拿满、低优先级被压产"，不再钉死绝对件数。
	highOre := totalStorageItems(high.Storage)
	lowOre := totalStorageItems(low.Storage)
	if highOre != 8 {
		t.Fatalf("expected high priority to mine at full yield 8, got %d", highOre)
	}
	if lowOre <= 0 || lowOre >= 8 {
		t.Fatalf("expected low priority throttled between 1 and 7, got %d", lowOre)
	}
	if ws.Players["p1"].Resources.Energy != 20 {
		t.Fatalf("expected energy unchanged before finalize, got %d", ws.Players["p1"].Resources.Energy)
	}
}

func TestPowerShortageRecovery(t *testing.T) {
	ws := newPowerTestWorld()
	gen := addPowerTestBuilding(ws, "gen-1", model.BuildingTypeWindTurbine, model.Position{X: 1, Y: 1})
	consumer := addPowerTestBuilding(ws, "c-1", model.BuildingTypeMiningMachine, model.Position{X: 2, Y: 1})
	addResourceNode(ws, "r-1", consumer.Position, 8)

	ws.PowerInputs = nil
	ws.PowerGrid = model.BuildPowerGridGraph(ws)

	settleResources(ws)
	if consumer.Runtime.State != model.BuildingWorkNoPower {
		t.Fatalf("expected consumer no_power, got %s", consumer.Runtime.State)
	}

	ws.PowerInputs = []model.PowerInput{{BuildingID: gen.ID, OwnerID: "p1", Output: 2}}
	ws.PowerGrid = model.BuildPowerGridGraph(ws)

	events := settleResources(ws)
	if consumer.Runtime.State != model.BuildingWorkRunning {
		t.Fatalf("expected consumer running after restore, got %s", consumer.Runtime.State)
	}
	if !hasPowerRestoreEvent(events, consumer.ID) {
		t.Fatalf("expected power_restored event")
	}
}

func TestPowerShortageRefreshesNoPowerReasonWhenCoverageBecomesUnderPower(t *testing.T) {
	ws := newPowerTestWorld()
	addPowerTestBuilding(ws, "gen-1", model.BuildingTypeWindTurbine, model.Position{X: 1, Y: 1})
	consumer := addPowerTestBuilding(ws, "c-1", model.BuildingTypeMiningMachine, model.Position{X: 6, Y: 1})
	addResourceNode(ws, "r-1", consumer.Position, 8)

	ws.PowerInputs = nil
	ws.PowerGrid = model.BuildPowerGridGraph(ws)

	settleResources(ws)
	if consumer.Runtime.State != model.BuildingWorkNoPower {
		t.Fatalf("expected consumer no_power after disconnected tick, got %s", consumer.Runtime.State)
	}
	if consumer.Runtime.StateReason != "power_out_of_range" {
		t.Fatalf("expected initial reason power_out_of_range, got %s", consumer.Runtime.StateReason)
	}

	addPowerTestBuilding(ws, "tower-1", model.BuildingTypeTeslaTower, model.Position{X: 4, Y: 1})
	ws.PowerInputs = nil
	ws.PowerGrid = model.BuildPowerGridGraph(ws)

	events := settleResources(ws)
	if consumer.Runtime.State != model.BuildingWorkNoPower {
		t.Fatalf("expected consumer to remain no_power while supply is still zero, got %s", consumer.Runtime.State)
	}
	if consumer.Runtime.StateReason != stateReasonUnderPower {
		t.Fatalf("expected no_power reason to refresh to under_power, got %s", consumer.Runtime.StateReason)
	}
	if !hasBuildingStateReasonEvent(events, consumer.ID, model.BuildingWorkNoPower, model.BuildingWorkNoPower, "power_out_of_range", stateReasonUnderPower) {
		t.Fatalf("expected no_power reason-change event, got %+v", events)
	}
}

func newPowerTestWorld() *model.WorldState {
	ws := model.NewWorldState("p1", 8)
	ws.Players["p1"] = &model.PlayerState{
		PlayerID: "p1",
		IsAlive:  true,
		Resources: model.Resources{
			Minerals: 0,
			Energy:   20,
		},
	}
	return ws
}

func addPowerTestBuilding(ws *model.WorldState, id string, btype model.BuildingType, pos model.Position) *model.Building {
	profile := model.BuildingProfileFor(btype, 1)
	building := &model.Building{
		ID:       id,
		Type:     btype,
		OwnerID:  "p1",
		Position: pos,
		Runtime:  profile.Runtime,
	}
	model.InitBuildingStorage(building)
	ws.Buildings[id] = building
	return building
}

func addResourceNode(ws *model.WorldState, id string, pos model.Position, yield int) {
	if ws.Resources == nil {
		ws.Resources = make(map[string]*model.ResourceNodeState)
	}
	ws.Resources[id] = &model.ResourceNodeState{
		ID:           id,
		PlanetID:     ws.PlanetID,
		Kind:         "iron_ore",
		Behavior:     "finite",
		Position:     pos,
		MaxAmount:    1000,
		Remaining:    1000,
		BaseYield:    yield,
		CurrentYield: yield,
	}
	ws.Grid[pos.Y][pos.X].ResourceNodeID = id
}

func hasPowerRestoreEvent(events []*model.GameEvent, buildingID string) bool {
	for _, evt := range events {
		if evt.EventType != model.EvtBuildingStateChanged {
			continue
		}
		if evt.Payload["building_id"] == buildingID && evt.Payload["reason"] == "power_restored" {
			return true
		}
	}
	return false
}

func hasBuildingStateReasonEvent(
	events []*model.GameEvent,
	buildingID string,
	prevState, nextState model.BuildingWorkState,
	prevReason, reason string,
) bool {
	for _, evt := range events {
		if evt.EventType != model.EvtBuildingStateChanged {
			continue
		}
		if evt.Payload["building_id"] != buildingID {
			continue
		}
		if evt.Payload["prev_state"] != prevState || evt.Payload["next_state"] != nextState {
			continue
		}
		if evt.Payload["prev_reason"] != prevReason || evt.Payload["reason"] != reason {
			continue
		}
		return true
	}
	return false
}
