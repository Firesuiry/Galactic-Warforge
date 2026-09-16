package gamecore

import (
	"encoding/json"
	"reflect"
	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
	"testing"
)

func stationRuntimeFixture() (*model.WorldState, *model.Building, *model.Building, *model.Building) {
	ws := model.NewWorldState("station-runtime", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true, Resources: model.Resources{Energy: 100}, Inventory: model.ItemInventory{}}
	b := newLogisticsStationBuilding("station", model.Position{X: 3, Y: 3})
	attachBuilding(ws, b)
	model.RegisterLogisticsStation(ws, b)
	b.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{ItemID: model.ItemIronOre, Mode: model.LogisticsStationModeSupply})
	b.LogisticsStation.BeltPorts = map[model.ConveyorDirection]model.LogisticsBeltPort{model.ConveyorWest: {Mode: "input", ItemID: model.ItemIronOre}, model.ConveyorEast: {Mode: "output", ItemID: model.ItemIronOre}}
	input := newConveyorBuilding("input", model.Position{X: 2, Y: 3}, model.ConveyorEast)
	output := newConveyorBuilding("output", model.Position{X: 4, Y: 3}, model.ConveyorEast)
	attachBuilding(ws, input)
	attachBuilding(ws, output)
	return ws, b, input, output
}

func TestStationBeltIOFiltersUsesSingleInventoryAndBackpressures(t *testing.T) {
	ws, b, input, output := stationRuntimeFixture()
	s := b.LogisticsStation
	input.Conveyor.Insert(model.ItemIronOre, 8)
	settleLogisticsStationIO(ws)
	if input.Conveyor.TotalItems() != 2 || output.Conveyor.TotalItems() != 6 || s.Inventory[model.ItemIronOre] != 0 || b.Storage != nil {
		t.Fatal("station belt transfer lost items or created duplicate storage")
	}
	if ws.ConveyorTraffic.Departed[input.ID] != 6 {
		t.Fatal("station intake missing real flow observation")
	}
	input.Conveyor.Buffer = []model.ItemStack{{ItemID: model.ItemCopperOre, Quantity: 3}}
	settleLogisticsStationIO(ws)
	if input.Conveyor.TotalItems() != 3 {
		t.Fatal("input port took unfiltered item")
	}
	input.Conveyor.Buffer = []model.ItemStack{{ItemID: model.ItemIronOre, Quantity: 2, Spray: &model.SprayState{Level: 3, RemainingUses: 8}}}
	settleLogisticsStationIO(ws)
	if input.Conveyor.TotalItems() != 2 || input.Conveyor.Buffer[0].Spray.RemainingUses != 8 {
		t.Fatal("station silently discarded paid spray metadata")
	}
	s.Inventory[model.ItemIronOre] = 200
	output.Conveyor.Insert(model.ItemIronOre, 4)
	input.Conveyor.Buffer = []model.ItemStack{{ItemID: model.ItemIronOre, Quantity: 2}}
	settleLogisticsStationIO(ws)
	if s.Inventory[model.ItemIronOre] != 200 || input.Conveyor.TotalItems() != 2 || output.Conveyor.TotalItems() != 10 {
		t.Fatal("full buffers did not backpressure")
	}
	b.Runtime.State = model.BuildingWorkNoPower
	output.Conveyor.Take(10)
	settleLogisticsStationIO(ws)
	if output.Conveyor.TotalItems() != 0 || s.Inventory[model.ItemIronOre] != 200 {
		t.Fatal("unpowered station moved cargo")
	}
}

func TestStationTransferItemCannotBypassConfigurationAndCapacity(t *testing.T) {
	ws, b, _, _ := stationRuntimeFixture()
	gc := &GameCore{}
	ws.Players["p1"].Inventory[model.ItemIronOre] = 250
	ws.Players["p1"].Inventory[model.ItemCopperOre] = 5
	command := model.Command{Payload: map[string]any{"building_id": b.ID, "item_id": model.ItemCopperOre, "quantity": 5}}
	result, _ := gc.execTransferItem(ws, "p1", command)
	if result.Status != model.StatusFailed || ws.Players["p1"].Inventory[model.ItemCopperOre] != 5 {
		t.Fatal("unconfigured station item accepted")
	}
	command.Payload["item_id"] = model.ItemIronOre
	command.Payload["quantity"] = 250
	result, _ = gc.execTransferItem(ws, "p1", command)
	if result.Status != model.StatusExecuted || b.LogisticsStation.Inventory[model.ItemIronOre] != 200 || ws.Players["p1"].Inventory[model.ItemIronOre] != 50 || b.Storage != nil {
		t.Fatalf("station transfer wrong: %+v", result)
	}
}

func TestStationChargesOnlyRealAllocatedGridEnergyAndStopsAtFull(t *testing.T) {
	ws, b, _, _ := stationRuntimeFixture()
	generator := surfaceTestBuilding(ws, "generator", model.BuildingTypeWindTurbine, model.Position{X: 3, Y: 2})
	ws.PowerInputs = []model.PowerInput{{BuildingID: generator.ID, OwnerID: "p1", Output: 17}}
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
	finalizePowerSettlement(ws, nil)
	settleResources(ws)
	settleLogisticsCharging(ws)
	if b.LogisticsStation.Energy != 10 || b.LogisticsStation.LastChargeAmount != 10 || ws.PowerSnapshot.Allocations.Buildings[b.ID].Allocated != 11 {
		t.Fatalf("wrong grid charge %+v allocation=%+v", b.LogisticsStation, ws.PowerSnapshot.Allocations.Buildings[b.ID])
	}
	if ws.Players["p1"].Resources.Energy != 106 {
		t.Fatalf("charging counted as free player surplus: %d", ws.Players["p1"].Resources.Energy)
	}
	settleLogisticsCharging(ws)
	if b.LogisticsStation.Energy != 10 {
		t.Fatal("same tick charged twice")
	}
	ws.Tick++
	b.LogisticsStation.Energy = 999
	finalizePowerSettlement(ws, nil)
	settleResources(ws)
	settleLogisticsCharging(ws)
	if b.LogisticsStation.Energy != 1000 || b.LogisticsStation.LastChargeAmount != 1 || ws.PowerSnapshot.Allocations.Buildings[b.ID].Demand != 2 {
		t.Fatal("last charge exceeded remaining capacity")
	}
	ws.Tick++
	finalizePowerSettlement(ws, nil)
	settleResources(ws)
	settleLogisticsCharging(ws)
	if model.PowerDemandForBuilding(b) != 1 || b.LogisticsStation.LastChargeAmount != 0 {
		t.Fatal("full station kept demanding charge power")
	}
	ws.Tick++
	b.LogisticsStation.Energy = 0
	ws.PowerInputs = nil
	finalizePowerSettlement(ws, nil)
	settleResources(ws)
	settleLogisticsCharging(ws)
	if b.LogisticsStation.Energy != 0 || b.Runtime.State != model.BuildingWorkNoPower {
		t.Fatal("player global energy substituted for station grid power")
	}
}

func TestConfigureStationPortsAndSlotRemovalAreAtomic(t *testing.T) {
	ws, b, _, _ := stationRuntimeFixture()
	gc := &GameCore{}
	original := b.LogisticsStation.Clone()
	invalid := []any{"bad", map[string]any{"auto": map[string]any{"mode": "input", "item_id": model.ItemIronOre}}, map[string]any{"north": map[string]any{"mode": "none", "item_id": model.ItemIronOre}}, map[string]any{"north": map[string]any{"mode": "input", "item_id": model.ItemCopperOre}}, map[string]any{"north": map[string]any{"mode": true, "item_id": model.ItemIronOre}}}
	for _, ports := range invalid {
		result, _ := gc.execConfigureLogisticsStation(ws, "p1", model.Command{Target: model.CommandTarget{EntityID: b.ID}, Payload: map[string]any{"belt_ports": ports}})
		if result.Status != model.StatusFailed || !reflect.DeepEqual(b.LogisticsStation, original) {
			t.Fatal("invalid port configuration partially applied")
		}
	}
	remove := model.Command{Target: model.CommandTarget{EntityID: b.ID}, Payload: map[string]any{"scope": "planetary", "item_id": model.ItemIronOre, "mode": "none", "local_storage": 0, "remove": true}}
	if result, _ := gc.execConfigureLogisticsSlot(ws, "p1", remove); result.Status != model.StatusFailed {
		t.Fatal("removed a port-bound slot")
	}
	result, _ := gc.execConfigureLogisticsStation(ws, "p1", model.Command{Target: model.CommandTarget{EntityID: b.ID}, Payload: map[string]any{"belt_ports": map[string]any{}}})
	if result.Status != model.StatusExecuted || len(b.LogisticsStation.BeltPorts) != 0 {
		t.Fatal("empty port object failed to clear ports")
	}
	b.LogisticsStation.Inventory = model.ItemInventory{model.ItemIronOre: 1}
	if result, _ := gc.execConfigureLogisticsSlot(ws, "p1", remove); result.Status != model.StatusFailed {
		t.Fatal("removed stocked slot")
	}
	b.LogisticsStation.Inventory = nil
	ws.LogisticsDrones["transit"] = &model.LogisticsDroneState{StationID: b.ID, Cargo: model.ItemInventory{model.ItemIronOre: 1}}
	if result, _ := gc.execConfigureLogisticsSlot(ws, "p1", remove); result.Status != model.StatusFailed {
		t.Fatal("removed in-transit cargo slot")
	}
	delete(ws.LogisticsDrones, "transit")
	result, _ = gc.execConfigureLogisticsSlot(ws, "p1", remove)
	if result.Status != model.StatusExecuted || b.LogisticsStation.ConfiguredItem(model.ItemIronOre) {
		t.Fatalf("empty slot removal failed %+v", result)
	}
}

func TestStationSnapshotPreservesPortsEnergyAndSoleInventory(t *testing.T) {
	ws, b, _, _ := stationRuntimeFixture()
	s := b.LogisticsStation
	s.Energy = 350
	s.LastChargeTick = 8
	s.LastChargeAmount = 6
	s.Inventory = model.ItemInventory{model.ItemIronOre: 42}
	s.RefreshCapacityCache()
	data, err := json.Marshal(snapshot.CaptureWorld(ws))
	if err != nil {
		t.Fatal(err)
	}
	var saved snapshot.WorldSnapshot
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	restored, err := saved.Restore()
	if err != nil {
		t.Fatal(err)
	}
	got := restored.Buildings[b.ID]
	if got.Storage != nil || got.LogisticsStation.Energy != 350 || got.LogisticsStation.Inventory[model.ItemIronOre] != 42 || got.LogisticsStation.BeltPorts[model.ConveyorEast].Mode != "output" || restored.LogisticsStations[b.ID] != got.LogisticsStation {
		t.Fatal("station restore duplicated or lost runtime inventory/ports")
	}
	got.LogisticsStation.Inventory[model.ItemIronOre] = 1
	got.LogisticsStation.BeltPorts[model.ConveyorEast] = model.LogisticsBeltPort{Mode: "input", ItemID: model.ItemIronOre}
	if s.Inventory[model.ItemIronOre] != 42 || s.BeltPorts[model.ConveyorEast].Mode != "output" {
		t.Fatal("station snapshot aliases live inventory/ports")
	}
	saved.Buildings[b.ID].LogisticsStation.Inventory[model.ItemIronOre] = 201
	if _, err := saved.Restore(); err == nil {
		t.Fatal("restored over-capacity station")
	}
}

func TestStationChargingCompetitionCannotDuplicatePower(t *testing.T) {
	ws, a, _, _ := stationRuntimeFixture()
	b := newLogisticsStationBuilding("second", model.Position{X: 4, Y: 2})
	attachBuilding(ws, b)
	model.RegisterLogisticsStation(ws, b)
	generator := surfaceTestBuilding(ws, "generator", model.BuildingTypeWindTurbine, model.Position{X: 3, Y: 2})
	ws.PowerInputs = []model.PowerInput{{BuildingID: generator.ID, OwnerID: "p1", Output: 12}}
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
	finalizePowerSettlement(ws, nil)
	settleResources(ws)
	settleLogisticsCharging(ws)
	charged := a.LogisticsStation.Energy + b.LogisticsStation.Energy
	if charged != 10 || ws.Players["p1"].Resources.Energy != 100 {
		t.Fatalf("12 grid energy must cover 2 operating + 10 charging: charged=%d player=%d", charged, ws.Players["p1"].Resources.Energy)
	}
}

func TestStationSlotRemovalPreservesOtherScopeAndOtherPlanetIdentity(t *testing.T) {
	ws, b, _, _ := stationRuntimeFixture()
	b.Type = model.BuildingTypeInterstellarLogisticsStation
	model.SyncBuildingLogisticsStation(b)
	b.LogisticsStation.BeltPorts = nil
	if err := b.LogisticsStation.UpsertInterstellarSetting(model.LogisticsStationItemSetting{ItemID: model.ItemIronOre, Mode: model.LogisticsStationModeDemand, LocalStorage: 100}); err != nil {
		t.Fatal(err)
	}
	other := model.NewWorldState("other-planet", 8)
	other.LogisticsDrones["elsewhere"] = &model.LogisticsDroneState{StationID: b.ID, Cargo: model.ItemInventory{model.ItemIronOre: 1}}
	gc := &GameCore{worlds: map[string]*model.WorldState{ws.PlanetID: ws, other.PlanetID: other}}
	command := model.Command{Target: model.CommandTarget{EntityID: b.ID}, Payload: map[string]any{"scope": "planetary", "item_id": model.ItemIronOre, "mode": "none", "local_storage": 0, "remove": true}}
	result, _ := gc.execConfigureLogisticsSlot(ws, "p1", command)
	if result.Status != model.StatusExecuted || !b.LogisticsStation.ConfiguredItem(model.ItemIronOre) || len(b.LogisticsStation.Settings) != 0 || len(b.LogisticsStation.InterstellarSettings) != 1 {
		t.Fatalf("wrong cross-scope/planet removal: %+v", result)
	}
}

func TestStationBeltIOAcrossCubeSeam(t *testing.T) {
	ws := model.NewWorldState("seam-station", 8)
	b := newLogisticsStationBuilding("station", model.Position{X: 0, Y: 4})
	attachBuilding(ws, b)
	b.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{ItemID: model.ItemIronOre, Mode: model.LogisticsStationModeNone})
	b.LogisticsStation.BeltPorts = map[model.ConveyorDirection]model.LogisticsBeltPort{model.ConveyorWest: {Mode: "input", ItemID: model.ItemIronOre}}
	pos, forward := ws.SurfaceStep(b.Position, model.ConveyorWest)
	source := newConveyorBuilding("source", pos, forward.Opposite())
	attachBuilding(ws, source)
	source.Conveyor.Insert(model.ItemIronOre, 3)
	settleLogisticsStationIO(ws)
	if source.Conveyor.TotalItems() != 0 || b.LogisticsStation.Inventory[model.ItemIronOre] != 3 {
		t.Fatal("cross-face station input missed transformed belt direction")
	}
}

func TestLogisticsStationConstructionInitializesEmptyFiniteInventoryAndEnergy(t *testing.T) {
	for _, kind := range []model.BuildingType{model.BuildingTypePlanetaryLogisticsStation, model.BuildingTypeInterstellarLogisticsStation} {
		t.Run(string(kind), func(t *testing.T) {
			core := newConstructionTestCore(t, 2, 2)
			ws := core.world
			ws.Players["p1"].Resources = model.Resources{Minerals: 1000, Energy: 1000}
			pos, _ := findTwoOpenTiles(ws)
			result, _ := core.execBuild(ws, "p1", model.Command{Type: model.CmdBuild, Target: model.CommandTarget{Position: &pos}, Payload: map[string]any{"building_type": string(kind)}})
			if result.Status != model.StatusExecuted {
				t.Fatalf("build station: %+v", result)
			}
			for _, task := range ws.Construction.Tasks {
				if _, err := core.completeConstructionTask(ws, task); err != nil {
					t.Fatal(err)
				}
			}
			for _, b := range ws.Buildings {
				if b.Type == kind {
					if b.Storage != nil || b.LogisticsStation == nil || b.LogisticsStation.Energy != 0 || len(b.LogisticsStation.Inventory) != 0 || len(b.LogisticsStation.BeltPorts) != 0 || ws.LogisticsStations[b.ID] != b.LogisticsStation {
						t.Fatal("station built with duplicate/seeded cargo or missing registry")
					}
					if err := b.LogisticsStation.Validate(); err != nil {
						t.Fatal(err)
					}
					return
				}
			}
			t.Fatal("station missing after construction")
		})
	}
}
