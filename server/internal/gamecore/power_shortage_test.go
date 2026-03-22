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
	gen := addPowerTestBuilding(ws, "gen-1", model.BuildingTypeWindTurbine, model.Position{X: 1, Y: 1})
	gen.Runtime.Params.ConnectionPoints = []model.ConnectionPoint{
		{ID: "power", Kind: model.ConnectionPower, Offset: model.GridOffset{X: 0, Y: 0}, Capacity: 0},
	}

	high := addPowerTestBuilding(ws, "c-1", model.BuildingTypeMiningMachine, model.Position{X: 2, Y: 1})
	low := addPowerTestBuilding(ws, "c-2", model.BuildingTypeMiningMachine, model.Position{X: 3, Y: 1})
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
	if got := totalStorageItems(high.Storage) + totalStorageItems(low.Storage); got != 12 {
		t.Fatalf("expected 12 ore buffered after partial power, got %d", got)
	}
	if ws.Players["p1"].Resources.Energy != 17 {
		t.Fatalf("expected energy 17, got %d", ws.Players["p1"].Resources.Energy)
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

func newPowerTestWorld() *model.WorldState {
	ws := model.NewWorldState("p1", 8, 8)
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
