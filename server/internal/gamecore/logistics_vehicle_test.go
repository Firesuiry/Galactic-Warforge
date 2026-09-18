package gamecore

import (
	"encoding/json"
	"fmt"
	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
	"testing"
)

func installTestStationFleet(core *GameCore, ws *model.WorldState, b *model.Building) error {
	grantTechs(ws, b.OwnerID, "planetary_logistics", "interstellar_logistics")
	for _, entry := range []struct {
		item string
		qty  int
	}{{model.ItemLogisticsDrone, b.LogisticsStation.DroneCapacityValue()}, {model.ItemLogisticsVessel, b.LogisticsStation.ShipSlotCapacityValue()}} {
		if entry.item == model.ItemLogisticsVessel && b.Type != model.BuildingTypeInterstellarLogisticsStation {
			continue
		}
		ws.Players[b.OwnerID].AddItems([]model.ItemAmount{{ItemID: entry.item, Quantity: entry.qty}})
		result, _ := core.execInstallLogisticsVehicle(ws, b.OwnerID, model.Command{Type: model.CmdInstallLogisticsVehicle, Target: model.CommandTarget{EntityID: b.ID}, Payload: map[string]any{"item_id": entry.item, "quantity": entry.qty}})
		if result.Status != model.StatusExecuted {
			return fmt.Errorf("install fixture: %s", result.Message)
		}
	}
	return nil
}

func powerLogisticsFixture(t *testing.T, ws *model.WorldState) {
	t.Helper()
	stations := []*model.Building{}
	for _, b := range ws.Buildings {
		if b.LogisticsStation != nil {
			stations = append(stations, b)
		}
	}
	for _, b := range stations {
		b.Runtime.State = model.BuildingWorkRunning
		b.LogisticsStation.Energy = b.LogisticsStation.EnergyCapacity
		supplyProductionFixture(t, ws, b)
	}
}

func TestInstallLogisticsVehiclesConsumesInventoryAtomically(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	station := newInterstellarLogisticsStationBuilding("install-station", model.Position{X: 5, Y: 5})
	attachBuilding(ws, station)
	grantTechs(ws, "p1", "planetary_logistics", "interstellar_logistics")
	player := ws.Players["p1"]
	player.AddItems([]model.ItemAmount{{ItemID: model.ItemLogisticsDrone, Quantity: 12}, {ItemID: model.ItemLogisticsVessel, Quantity: 5}})
	install := func(owner, item string, qty any) model.CommandResult {
		r, _ := core.execInstallLogisticsVehicle(ws, owner, model.Command{Type: model.CmdInstallLogisticsVehicle, Target: model.CommandTarget{EntityID: station.ID}, Payload: map[string]any{"item_id": item, "quantity": qty}})
		return r
	}
	if r := install("p1", model.ItemLogisticsDrone, 3); r.Status != model.StatusExecuted {
		t.Fatal(r)
	}
	if player.Inventory[model.ItemLogisticsDrone] != 9 || model.StationDroneCount(ws, station.ID) != 3 {
		t.Fatal("installation did not conserve inventory")
	}
	for _, tc := range []struct {
		owner, item string
		qty         any
	}{{"p1", model.ItemLogisticsDrone, 8}, {"p1", model.ItemLogisticsDrone, 0}, {"p1", model.ItemLogisticsDrone, -1}, {"p1", model.ItemLogisticsDrone, 1.5}, {"p2", model.ItemLogisticsDrone, 1}, {"p1", model.ItemIronOre, 1}, {"p1", model.ItemLogisticsVessel, 6}} {
		if r := install(tc.owner, tc.item, tc.qty); r.Status != model.StatusFailed {
			t.Fatalf("invalid installation accepted %+v: %+v", tc, r)
		}
		if player.Inventory[model.ItemLogisticsDrone] != 9 || model.StationDroneCount(ws, station.ID) != 3 || model.StationShipCount(ws, station.ID) != 0 {
			t.Fatal("failed installation mutated inventory/fleet")
		}
	}
	if r := install("p1", model.ItemLogisticsVessel, 2); r.Status != model.StatusExecuted {
		t.Fatal(r)
	}
	if player.Inventory[model.ItemLogisticsVessel] != 3 || model.StationShipCount(ws, station.ID) != 2 {
		t.Fatal("ship installation did not conserve inventory")
	}
	player.Inventory[model.ItemLogisticsDrone] = 0
	if r := install("p1", model.ItemLogisticsDrone, 1); r.Code != model.CodeInsufficientResource {
		t.Fatal(r)
	}
	for _, d := range ws.LogisticsDrones {
		if d.OwnerID != "p1" || d.HomePos == nil || *d.HomePos != station.Position {
			t.Fatalf("missing vehicle identity: %+v", d)
		}
	}
}

func newVehicleFlightFixture(t *testing.T) (*model.WorldState, *model.Building, *model.Building, *model.LogisticsDroneState) {
	t.Helper()
	ws := model.NewWorldState("planet-1", 12)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	a := newLogisticsStationBuilding("origin", model.Position{X: 1, Y: 1})
	b := newLogisticsStationBuilding("target", model.Position{X: 9, Y: 1})
	attachBuilding(ws, a)
	attachBuilding(ws, b)
	if err := a.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{ItemID: model.ItemIronOre, Mode: model.LogisticsStationModeSupply}); err != nil {
		t.Fatal(err)
	}
	if err := b.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{ItemID: model.ItemIronOre, Mode: model.LogisticsStationModeDemand, LocalStorage: 50}); err != nil {
		t.Fatal(err)
	}
	a.LogisticsStation.Inventory = model.ItemInventory{model.ItemIronOre: 100}
	b.LogisticsStation.Inventory = make(model.ItemInventory)
	d := model.NewLogisticsDroneState("drone", a.ID, a.Position)
	if err := model.RegisterLogisticsDrone(ws, d); err != nil {
		t.Fatal(err)
	}
	powerLogisticsFixture(t, ws)
	return ws, a, b, d
}

func TestDroneRoundTripPrepaidEnergyAndPowerOutage(t *testing.T) {
	ws, a, b, d := newVehicleFlightFixture(t)
	a.LogisticsStation.Energy = 0
	settleLogisticsDispatch(ws, map[string]*model.WorldState{ws.PlanetID: ws})
	if d.Status != model.LogisticsDroneIdle || a.LogisticsStation.Inventory[model.ItemIronOre] != 100 {
		t.Fatal("launched without charged energy")
	}
	a.LogisticsStation.Energy = 1000
	ws.PowerInputs = nil
	ws.PowerSnapshot = nil
	settleLogisticsDispatch(ws, map[string]*model.WorldState{ws.PlanetID: ws})
	if d.Status != model.LogisticsDroneIdle {
		t.Fatal("charged station launched without grid power")
	}
	powerLogisticsFixture(t, ws)
	before := a.LogisticsStation.Energy
	settleLogisticsDispatch(ws, map[string]*model.WorldState{ws.PlanetID: ws})
	if d.Status != model.LogisticsDroneTakeoff || a.LogisticsStation.Energy != before-16 {
		t.Fatalf("round-trip energy not reserved: %+v", d)
	}
	ws.PowerInputs = nil
	ws.PowerSnapshot = nil
	for i := 0; i < 4; i++ {
		settleLogisticsDrones(ws)
	}
	if !d.Returning || d.Status != model.LogisticsDroneTakeoff || d.Position != b.Position || b.LogisticsStation.Inventory[model.ItemIronOre] != 50 {
		t.Fatalf("must unload then start physical return %+v", d)
	}
	// Renew demand during return: this same drone must not teleport into another trip.
	b.LogisticsStation.Inventory[model.ItemIronOre] = 0
	powerLogisticsFixture(t, ws)
	settleLogisticsDispatch(ws, map[string]*model.WorldState{ws.PlanetID: ws})
	if !d.Returning || d.Position != b.Position {
		t.Fatal("returning drone was dispatched again")
	}
	for i := 0; i < 4; i++ {
		settleLogisticsDrones(ws)
	}
	if d.Status != model.LogisticsDroneIdle || d.Position != a.Position || d.Returning {
		t.Fatalf("did not return home: %+v", d)
	}
}

func TestDroneFullDestinationWaitsAndLostStationConservesCargo(t *testing.T) {
	for _, scenario := range []string{"full", "removed", "enemy", "lost_home"} {
		t.Run(scenario, func(t *testing.T) {
			ws, a, b, d := newVehicleFlightFixture(t)
			settleLogisticsDispatch(ws, map[string]*model.WorldState{ws.PlanetID: ws})
			switch scenario {
			case "full":
				b.LogisticsStation.Inventory[model.ItemIronOre] = 195
			case "removed", "lost_home":
				delete(ws.Buildings, b.ID)
				delete(ws.LogisticsStations, b.ID)
			case "enemy":
				b.OwnerID = "p2"
			}
			if scenario == "lost_home" {
				delete(ws.Buildings, a.ID)
				delete(ws.LogisticsStations, a.ID)
			}
			for i := 0; i < 4; i++ {
				settleLogisticsDrones(ws)
			}
			if scenario == "full" {
				if b.LogisticsStation.Inventory[model.ItemIronOre] != 200 || d.CargoQty() != 45 || d.Status != model.LogisticsDroneWaitingUnload {
					t.Fatalf("full destination overflow/loss: %+v", d)
				}
				b.LogisticsStation.Inventory[model.ItemIronOre] -= 45
				settleLogisticsDrones(ws)
				if d.CargoQty() != 0 || !d.Returning {
					t.Fatal("waiting cargo did not unload after space became available")
				}
			} else if d.CargoQty() != 50 || !d.Returning {
				t.Fatalf("unavailable destination lost cargo %+v", d)
			}
			for i := 0; i < 4; i++ {
				settleLogisticsDrones(ws)
			}
			if scenario == "lost_home" {
				if d.Status != model.LogisticsDroneStranded || d.CargoQty() != 50 || ws.LogisticsDrones[d.ID] != d {
					t.Fatalf("lost home deleted cargo: %+v", d)
				}
			} else if scenario != "full" {
				if d.Status != model.LogisticsDroneIdle || a.LogisticsStation.Inventory[model.ItemIronOre] != 100 {
					t.Fatalf("cargo failed to return: %+v", d)
				}
			}
		})
	}
}

func TestDronePickupReservesStockAndDemandAndReturnsActualCargo(t *testing.T) {
	ws, source, home, old := newVehicleFlightFixture(t)
	delete(ws.LogisticsDrones, old.ID)
	d := model.NewLogisticsDroneState("pickup-1", home.ID, home.Position)
	d2 := model.NewLogisticsDroneState("pickup-2", home.ID, home.Position)
	for _, v := range []*model.LogisticsDroneState{d, d2} {
		if err := model.RegisterLogisticsDrone(ws, v); err != nil {
			t.Fatal(err)
		}
	}
	worlds := map[string]*model.WorldState{ws.PlanetID: ws}
	source.Runtime.State = model.BuildingWorkNoPower // collection of already stored stock is passive
	settleLogisticsDispatch(ws, worlds)
	if d.TripKind != "pickup" || d.PickupQuantity != 50 || d.CargoQty() != 0 || d2.Status != model.LogisticsDroneIdle {
		t.Fatalf("bad pickup reservation: %+v %+v", d, d2)
	}
	// A second powered supplier vehicle cannot dispatch the stock promised to pickup.
	source.Runtime.State = model.BuildingWorkRunning
	supplyDrone := model.NewLogisticsDroneState("supply", source.ID, source.Position)
	if err := model.RegisterLogisticsDrone(ws, supplyDrone); err != nil {
		t.Fatal(err)
	}
	settleLogisticsDispatch(ws, worlds)
	if supplyDrone.Status != model.LogisticsDroneIdle || d2.Status != model.LogisticsDroneIdle {
		t.Fatal("same demand scheduled twice")
	}
	source.LogisticsStation.Inventory[model.ItemIronOre] = 20 // external consumption while en route
	for i := 0; i < 4; i++ {
		settleLogisticsDrones(ws)
	}
	if !d.Returning || d.CargoQty() != 20 || source.LogisticsStation.Inventory[model.ItemIronOre] != 0 {
		t.Fatalf("pickup invented missing stock: %+v", d)
	}
	for i := 0; i < 4; i++ {
		settleLogisticsDrones(ws)
	}
	if d.Status != model.LogisticsDroneIdle || d.Position != home.Position || home.LogisticsStation.Inventory[model.ItemIronOre] != 20 {
		t.Fatalf("pickup cargo did not return home: %+v", d)
	}
}

func TestShipPickupAcrossPlanetsSurvivesSnapshotAndFullHome(t *testing.T) {
	ws := model.NewWorldState("home", 12)
	remote := model.NewWorldState("remote", 12)
	for _, w := range []*model.WorldState{ws, remote} {
		w.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	}
	home := newInterstellarLogisticsStationBuilding("same-id", model.Position{X: 1, Y: 1})
	source := newOrbitalCollectorBuilding("same-id", model.Position{X: 7, Y: 1}, "p1")
	attachBuilding(ws, home)
	attachBuilding(remote, source)
	if err := home.LogisticsStation.UpsertInterstellarSetting(model.LogisticsStationItemSetting{ItemID: model.ItemHydrogen, Mode: model.LogisticsStationModeDemand, LocalStorage: 50}); err != nil {
		t.Fatal(err)
	}
	if err := source.LogisticsStation.UpsertInterstellarSetting(model.LogisticsStationItemSetting{ItemID: model.ItemHydrogen, Mode: model.LogisticsStationModeSupply}); err != nil {
		t.Fatal(err)
	}
	source.LogisticsStation.Inventory = model.ItemInventory{model.ItemHydrogen: 100}
	s := model.NewLogisticsShipState("ship", home.ID, home.Position)
	if err := model.RegisterLogisticsShip(ws, s); err != nil {
		t.Fatal(err)
	}
	powerLogisticsFixture(t, ws)
	worlds := map[string]*model.WorldState{ws.PlanetID: ws, remote.PlanetID: remote}
	before := home.LogisticsStation.Energy
	settleInterstellarDispatch(worlds, nil)
	if s.TripKind != "pickup" || s.TargetPlanetID != "remote" || s.PickupQuantity != 50 || home.LogisticsStation.Energy != before-100 {
		t.Fatalf("bad cross-planet pickup: %+v", s)
	}
	if !logisticsItemInFlight(worlds, "home", home.ID, model.ItemHydrogen) || !logisticsItemInFlight(worlds, "remote", source.ID, model.ItemHydrogen) {
		t.Fatal("pickup did not reserve both slot references")
	}
	for i := 0; i < 9; i++ {
		settleLogisticsShips(worlds)
	}
	if !s.Returning || s.CargoQty() != 50 || s.CurrentPlanetID != "remote" || s.TargetPlanetID != "home" {
		t.Fatalf("ship did not collect at remote: %+v", s)
	}
	// Persist through JSON during the loaded return flight.
	raw, err := json.Marshal(snapshot.CaptureWorld(ws))
	if err != nil {
		t.Fatal(err)
	}
	var saved snapshot.WorldSnapshot
	if err := json.Unmarshal(raw, &saved); err != nil {
		t.Fatal(err)
	}
	restored, err := saved.Restore()
	if err != nil {
		t.Fatal(err)
	}
	worlds["home"] = restored
	home = restored.Buildings[home.ID]
	s = restored.LogisticsShips[s.ID]
	if s.HomePos == nil || s.OwnerID != "p1" || !s.Returning || s.CargoQty() != 50 {
		t.Fatalf("snapshot lost vehicle identity: %+v", s)
	}
	home.LogisticsStation.Inventory = model.ItemInventory{model.ItemHydrogen: 495}
	for i := 0; i < 9; i++ {
		settleLogisticsShips(worlds)
	}
	if s.Status != model.LogisticsShipWaitingUnload || s.CargoQty() != 45 || home.LogisticsStation.Inventory[model.ItemHydrogen] != 500 {
		t.Fatalf("ship overflowed full home: %+v", s)
	}
	home.LogisticsStation.Inventory[model.ItemHydrogen] -= 45
	settleLogisticsShips(worlds)
	if s.Status != model.LogisticsShipIdle || s.CurrentPlanetID != "home" || s.CargoQty() != 0 || s.Position != home.Position {
		t.Fatalf("ship did not finish home delivery: %+v", s)
	}
}

func TestShipUnavailableDestinationReturnsCargoAndStrandedSnapshot(t *testing.T) {
	for _, lostHome := range []bool{false, true} {
		t.Run(fmt.Sprint(lostHome), func(t *testing.T) {
			ws := model.NewWorldState("planet-1", 12)
			ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
			a := newInterstellarLogisticsStationBuilding("a", model.Position{X: 1, Y: 1})
			b := newInterstellarLogisticsStationBuilding("b", model.Position{X: 3, Y: 1})
			attachBuilding(ws, a)
			attachBuilding(ws, b)
			a.LogisticsStation.UpsertInterstellarSetting(model.LogisticsStationItemSetting{ItemID: model.ItemIronOre, Mode: model.LogisticsStationModeSupply})
			b.LogisticsStation.UpsertInterstellarSetting(model.LogisticsStationItemSetting{ItemID: model.ItemIronOre, Mode: model.LogisticsStationModeDemand, LocalStorage: 25})
			a.LogisticsStation.Inventory = model.ItemInventory{model.ItemIronOre: 100}
			s := model.NewLogisticsShipState("ship", a.ID, a.Position)
			if err := model.RegisterLogisticsShip(ws, s); err != nil {
				t.Fatal(err)
			}
			powerLogisticsFixture(t, ws)
			worlds := map[string]*model.WorldState{ws.PlanetID: ws}
			settleInterstellarDispatch(worlds, nil)
			b.OwnerID = "p2"
			if lostHome {
				delete(ws.Buildings, a.ID)
				delete(ws.LogisticsStations, a.ID)
			}
			ws.PowerInputs = nil
			ws.PowerSnapshot = nil
			for i := 0; i < 10; i++ {
				settleLogisticsShips(worlds)
			}
			if lostHome {
				if s.Status != model.LogisticsShipStranded || s.CargoQty() != 25 {
					t.Fatalf("lost cargo after home destruction: %+v", s)
				}
				restored, err := snapshot.CaptureWorld(ws).Restore()
				if err != nil {
					t.Fatal(err)
				}
				if got := restored.LogisticsShips[s.ID]; got == nil || got.CargoQty() != 25 || got.OwnerID != "p1" || got.Status != model.LogisticsShipStranded {
					t.Fatalf("stranded ship did not survive snapshot: %+v", got)
				}
			} else if s.Status != model.LogisticsShipIdle || a.LogisticsStation.Inventory[model.ItemIronOre] != 100 || b.LogisticsStation.Inventory[model.ItemIronOre] != 0 {
				t.Fatalf("hostile target received cargo or return lost it: %+v", s)
			}
		})
	}
}

func TestLocalAndInterstellarDispatchShareDemandAndPickupReservations(t *testing.T) {
	ws := model.NewWorldState("planet-1", 12)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	source := newInterstellarLogisticsStationBuilding("a", model.Position{X: 1, Y: 1})
	home := newInterstellarLogisticsStationBuilding("b", model.Position{X: 7, Y: 1})
	attachBuilding(ws, source)
	attachBuilding(ws, home)
	for _, b := range []*model.Building{source, home} {
		mode := model.LogisticsStationModeSupply
		local := 0
		if b == home {
			mode = model.LogisticsStationModeDemand
			local = 50
		}
		setting := model.LogisticsStationItemSetting{ItemID: model.ItemIronOre, Mode: mode, LocalStorage: local}
		if err := b.LogisticsStation.UpsertSetting(setting); err != nil {
			t.Fatal(err)
		}
		if err := b.LogisticsStation.UpsertInterstellarSetting(setting); err != nil {
			t.Fatal(err)
		}
	}
	source.LogisticsStation.Inventory = model.ItemInventory{model.ItemIronOre: 50}
	d := model.NewLogisticsDroneState("d", home.ID, home.Position)
	if err := model.RegisterLogisticsDrone(ws, d); err != nil {
		t.Fatal(err)
	}
	s := model.NewLogisticsShipState("s", source.ID, source.Position)
	if err := model.RegisterLogisticsShip(ws, s); err != nil {
		t.Fatal(err)
	}
	powerLogisticsFixture(t, ws)
	worlds := map[string]*model.WorldState{ws.PlanetID: ws}
	settleLogisticsDispatch(ws, worlds)
	if d.TripKind != "pickup" || d.PickupQuantity != 50 {
		t.Fatalf("missing local pickup: %+v", d)
	}
	settleInterstellarDispatch(worlds, nil)
	if s.Status != model.LogisticsShipIdle || source.LogisticsStation.Inventory[model.ItemIronOre] != 50 {
		t.Fatal("ship duplicated demand already reserved by local pickup")
	}
	// A third interstellar destination cannot steal physically reserved source stock either.
	third := newInterstellarLogisticsStationBuilding("c", model.Position{X: 10, Y: 1})
	attachBuilding(ws, third)
	if err := third.LogisticsStation.UpsertInterstellarSetting(model.LogisticsStationItemSetting{ItemID: model.ItemIronOre, Mode: model.LogisticsStationModeDemand, LocalStorage: 50}); err != nil {
		t.Fatal(err)
	}
	settleInterstellarDispatch(worlds, nil)
	if s.Status != model.LogisticsShipIdle || source.LogisticsStation.Inventory[model.ItemIronOre] != 50 {
		t.Fatal("delivery consumed source stock already reserved by pickup")
	}
	for i := 0; i < 8; i++ {
		settleLogisticsDrones(ws)
	}
	if home.LogisticsStation.Inventory[model.ItemIronOre] != 50 || source.LogisticsStation.Inventory[model.ItemIronOre] != 0 {
		t.Fatal("cross-mode pickup failed to conserve physical stock")
	}
}

func TestManufacturedVehiclesTravelByBeltIntoStationAndInstall(t *testing.T) {
	for _, itemID := range []string{model.ItemLogisticsDrone, model.ItemLogisticsVessel} {
		t.Run(itemID, func(t *testing.T) {
			ws := model.NewWorldState("planet-1", 12)
			ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true, Inventory: make(model.ItemInventory)}
			grantTechs(ws, "p1", "planetary_logistics", "interstellar_logistics")
			core := &GameCore{}
			factory := newBuilding("factory", model.BuildingTypeAssemblingMachineMk1, "p1", model.Position{X: 3, Y: 3})
			factory.Production.RecipeID = itemID
			factory.Runtime.State = model.BuildingWorkRunning
			attachBuilding(ws, factory)
			belt := newConveyorBuilding("belt", model.Position{X: 4, Y: 3}, model.ConveyorEast)
			attachBuilding(ws, belt)
			station := newInterstellarLogisticsStationBuilding("station", model.Position{X: 5, Y: 3})
			attachBuilding(ws, station)
			if err := station.LogisticsStation.UpsertSetting(model.LogisticsStationItemSetting{ItemID: itemID, Mode: model.LogisticsStationModeNone}); err != nil {
				t.Fatal(err)
			}
			station.LogisticsStation.BeltPorts = map[model.ConveyorDirection]model.LogisticsBeltPort{model.ConveyorWest: {Mode: "input", ItemID: itemID}}
			recipe, ok := model.Recipe(itemID)
			if !ok {
				t.Fatal("missing vehicle recipe")
			}
			for _, input := range recipe.Inputs {
				ws.Players["p1"].Inventory[input.ItemID] = input.Quantity
				result, _ := core.execTransferItem(ws, "p1", model.Command{Type: model.CmdTransferItem, Payload: map[string]any{"building_id": factory.ID, "item_id": input.ItemID, "quantity": input.Quantity}})
				if result.Status != model.StatusExecuted {
					t.Fatalf("input transfer: %+v", result)
				}
				settleStorage(ws)
			}
			supplyProductionFixture(t, ws, factory)
			supplyProductionFixture(t, ws, station)
			for i := 0; i < recipe.Duration+20; i++ {
				ws.Tick++
				settleProduction(ws)
				settleStorage(ws)
				settleBuildingIO(ws)
				settleLogisticsStationIO(ws)
			}
			if station.LogisticsStation.Inventory[itemID] != 1 || ws.Players["p1"].Inventory[itemID] != 0 || factory.ExportableItemQuantity(itemID) != 0 || belt.Conveyor.TotalItems() != 0 {
				t.Fatalf("manufacturing belt path failed: station=%v factory=%+v belt=%+v", station.LogisticsStation.Inventory, factory.Storage, belt.Conveyor)
			}
			for _, input := range recipe.Inputs {
				if ws.Players["p1"].Inventory[input.ItemID] != 0 || availableStorageItem(factory.Storage, input.ItemID) != 0 {
					t.Fatal("manufacturing did not consume physical ingredients")
				}
			}
			command := model.Command{Type: model.CmdInstallLogisticsVehicle, Target: model.CommandTarget{EntityID: station.ID}, Payload: map[string]any{"item_id": itemID, "quantity": 2, "source": "station"}}
			result, _ := core.execInstallLogisticsVehicle(ws, "p1", command)
			if result.Code != model.CodeInsufficientResource || station.LogisticsStation.Inventory[itemID] != 1 || len(ws.LogisticsDrones)+len(ws.LogisticsShips) != 0 {
				t.Fatalf("batch installation was not atomic: %+v", result)
			}
			command.Payload["quantity"] = 1
			for _, source := range []any{"unknown", true, 1, ""} {
				command.Payload["source"] = source
				result, _ = core.execInstallLogisticsVehicle(ws, "p1", command)
				if result.Code != model.CodeValidationFailed || station.LogisticsStation.Inventory[itemID] != 1 {
					t.Fatalf("invalid source changed inventory: %+v", result)
				}
			}
			command.Payload["source"] = "station"
			result, _ = core.execInstallLogisticsVehicle(ws, "p1", command)
			if result.Status != model.StatusExecuted || station.LogisticsStation.Inventory[itemID] != 0 || len(ws.LogisticsDrones)+len(ws.LogisticsShips) != 1 || ws.Players["p1"].Inventory[itemID] != 0 {
				t.Fatalf("station-source installation did not conserve manufactured vehicle: %+v", result)
			}
		})
	}
}

func TestPlanetaryStationRejectsInstallingVesselFromEitherInventory(t *testing.T) {
	ws, station, _, _ := newVehicleFlightFixture(t)
	core := &GameCore{}
	ws.Players["p1"].Inventory = model.ItemInventory{model.ItemLogisticsVessel: 1}
	station.LogisticsStation.Inventory[model.ItemLogisticsVessel] = 1
	for _, source := range []string{"player", "station"} {
		result, _ := core.execInstallLogisticsVehicle(ws, "p1", model.Command{Type: model.CmdInstallLogisticsVehicle, Target: model.CommandTarget{EntityID: station.ID}, Payload: map[string]any{"item_id": model.ItemLogisticsVessel, "quantity": 1, "source": source}})
		if result.Code != model.CodeValidationFailed || station.LogisticsStation.Inventory[model.ItemLogisticsVessel] != 1 || ws.Players["p1"].Inventory[model.ItemLogisticsVessel] != 1 || len(ws.LogisticsShips) != 0 {
			t.Fatal("planetary station accepted vessel or consumed it")
		}
	}
}

func TestForecastCannotDispatchMoreCargoThanPhysicalDestinationCapacity(t *testing.T) {
	previous := model.CurrentLogisticsSchedulingConfig()
	cfg := previous
	cfg.DemandForecastMultiplier = 2
	if err := model.SetLogisticsSchedulingConfig(cfg); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { model.SetLogisticsSchedulingConfig(previous) })
	for _, interstellar := range []bool{false, true} {
		t.Run(fmt.Sprint(interstellar), func(t *testing.T) {
			ws := model.NewWorldState("planet-1", 16)
			ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
			a := newInterstellarLogisticsStationBuilding("a", model.Position{X: 1, Y: 1})
			b := newInterstellarLogisticsStationBuilding("b", model.Position{X: 6, Y: 1})
			target := newInterstellarLogisticsStationBuilding("target", model.Position{X: 12, Y: 1})
			for _, station := range []*model.Building{a, b, target} {
				attachBuilding(ws, station)
				setting := model.LogisticsStationItemSetting{ItemID: model.ItemIronOre, Mode: model.LogisticsStationModeSupply}
				if station == target {
					setting.Mode = model.LogisticsStationModeDemand
					setting.LocalStorage = 500
				} else {
					station.LogisticsStation.Inventory = model.ItemInventory{model.ItemIronOre: 500}
				}
				var err error
				if interstellar {
					err = station.LogisticsStation.UpsertInterstellarSetting(setting)
				} else {
					err = station.LogisticsStation.UpsertSetting(setting)
				}
				if err != nil {
					t.Fatal(err)
				}
				if station == target {
					continue
				}
				for i := 0; i < 5; i++ {
					id := fmt.Sprintf("%s-%d", station.ID, i)
					if interstellar {
						err = model.RegisterLogisticsShip(ws, model.NewLogisticsShipState(id, station.ID, station.Position))
					} else {
						err = model.RegisterLogisticsDrone(ws, model.NewLogisticsDroneState(id, station.ID, station.Position))
					}
					if err != nil {
						t.Fatal(err)
					}
				}
			}
			powerLogisticsFixture(t, ws)
			worlds := map[string]*model.WorldState{ws.PlanetID: ws}
			if interstellar {
				settleInterstellarDispatch(worlds, nil)
			} else {
				settleLogisticsDispatch(ws, worlds)
			}
			cargo := 0
			for _, d := range ws.LogisticsDrones {
				cargo += d.CargoQty()
			}
			for _, s := range ws.LogisticsShips {
				cargo += s.CargoQty()
			}
			if cargo != 500 || a.LogisticsStation.Inventory[model.ItemIronOre]+b.LogisticsStation.Inventory[model.ItemIronOre] != 500 {
				t.Fatalf("forecast dispatched beyond finite capacity: cargo=%d", cargo)
			}
		})
	}
}
