package gamecore

import (
	"siliconworld/internal/model"
	"testing"
)

func distributorTestWorld(t *testing.T) (*model.WorldState, *model.Building, *model.Building) {
	t.Helper()
	ws := model.NewWorldState("distributor-test", 32)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true, Inventory: model.ItemInventory{}}
	ws.PowerSnapshot = &model.PowerSettlementSnapshot{Tick: ws.Tick, Allocations: model.PowerAllocationState{Buildings: map[string]model.PowerAllocation{}}}
	add := func(id string, x int, mode model.LogisticsStationMode, keep int) *model.Building {
		host := newBuilding(id+"-depot", model.BuildingTypeDepotMk1, "p1", model.Position{X: x, Y: 8})
		host.Storage = model.NewStorageState(model.StorageModule{Capacity: 100, Slots: 4})
		ws.Buildings[host.ID] = host
		b := newBuilding(id, model.BuildingTypeLogisticsDistributor, "p1", model.Position{X: x, Y: 8, Z: 1})
		b.Distributor = model.NewDistributorState(host.ID)
		b.Distributor.ItemID, b.Distributor.Mode, b.Distributor.LocalStorage = model.ItemIronOre, mode, keep
		b.Distributor.Energy = 100
		b.Runtime.State = model.BuildingWorkRunning
		ws.Buildings[id] = b
		ws.PowerSnapshot.Allocations.Buildings[id] = model.PowerAllocation{Demand: 11, Allocated: 11, Ratio: 1}
		return b
	}
	return ws, add("source", 8, model.LogisticsStationModeSupply, 10), add("sink", 14, model.LogisticsStationModeDemand, 15)
}

func distributorTestBot(t *testing.T, ws *model.WorldState, home *model.Building, id string) *model.LogisticsBotState {
	t.Helper()
	bot := model.NewLogisticsBotState(id, home.ID, home.Position)
	if err := model.RegisterLogisticsBot(ws, bot); err != nil {
		t.Fatal(err)
	}
	return bot
}

func distributorTestTicks(t *testing.T, ws *model.WorldState, n int, active bool) {
	t.Helper()
	for i := 0; i < n; i++ {
		settleDistributors(ws, active)
		for _, bot := range ws.LogisticsBots {
			if err := bot.Validate(); err != nil {
				t.Fatalf("tick %d bot %+v: %v", i, bot, err)
			}
		}
		ws.Tick++
		if ws.PowerSnapshot != nil {
			ws.PowerSnapshot.Tick = ws.Tick
		}
	}
}

func distributorTestLoad(t *testing.T, ws *model.WorldState, b *model.Building, item string, n int) {
	t.Helper()
	got, _, err := model.DistributorHost(ws, b).Storage.Load(item, n)
	if err != nil || got != n {
		t.Fatalf("load %d: got %d, %v", n, got, err)
	}
}

func TestDistributorWarehouseDeliveryAndPickupReserveDemand(t *testing.T) {
	for _, pickup := range []bool{false, true} {
		name := "delivery"
		if pickup {
			name = "pickup"
		}
		t.Run(name, func(t *testing.T) {
			ws, source, sink := distributorTestWorld(t)
			distributorTestLoad(t, ws, source, model.ItemIronOre, 40)
			home := source
			if pickup {
				home = sink
			}
			first := distributorTestBot(t, ws, home, "a")
			second := distributorTestBot(t, ws, home, "b")
			third := distributorTestBot(t, ws, home, "c")
			distributorTestTicks(t, ws, 1, true)
			if first.PickupQuantity != 10 || second.PickupQuantity != 5 || third.Status != model.LogisticsDroneIdle {
				t.Fatalf("overbooked demand: %+v %+v %+v", first, second, third)
			}
			if home.Distributor.Energy != 76 {
				t.Fatalf("round trips not prepaid: %d", home.Distributor.Energy)
			}
			before := first.Position
			distributorTestTicks(t, ws, 1, true)
			if distance := ws.SurfaceDistance(before, first.Position); distance != 2 || first.EnergyRemaining != 10 {
				t.Fatalf("actual motion/energy: distance=%d bot=%+v", distance, first)
			}
			distributorTestTicks(t, ws, 12, true)
			if got := commandStorageItemQuantity(model.DistributorHost(ws, source).Storage, model.ItemIronOre); got != 25 {
				t.Fatalf("source=%d, want 25", got)
			}
			if got := commandStorageItemQuantity(model.DistributorHost(ws, sink).Storage, model.ItemIronOre); got != 15 {
				t.Fatalf("sink=%d, want 15", got)
			}
			for _, bot := range ws.LogisticsBots {
				if bot.Status != model.LogisticsDroneIdle || bot.CargoQty() != 0 {
					t.Fatalf("failed to return: %+v", bot)
				}
			}
			if home.Distributor.Energy != 76 {
				t.Fatalf("consumed wrong flight energy: %d", home.Distributor.Energy)
			}
		})
	}
}

func TestDistributorOutageAndInsufficientEnergyStopDispatch(t *testing.T) {
	for _, cause := range []string{"no_snapshot", "no_allocation", "runtime", "energy"} {
		t.Run(cause, func(t *testing.T) {
			ws, source, _ := distributorTestWorld(t)
			distributorTestLoad(t, ws, source, model.ItemIronOre, 30)
			bot := distributorTestBot(t, ws, source, "bot")
			switch cause {
			case "no_snapshot":
				ws.PowerSnapshot = nil
			case "no_allocation":
				delete(ws.PowerSnapshot.Allocations.Buildings, source.ID)
			case "runtime":
				source.Runtime.State = model.BuildingWorkNoPower
			case "energy":
				source.Distributor.Energy = 11
			}
			energy := source.Distributor.Energy
			distributorTestTicks(t, ws, 3, true)
			if bot.Status != model.LogisticsDroneIdle || source.Distributor.Energy != energy || model.DistributorHost(ws, source).Storage.OutputQuantity(model.ItemIronOre) != 30 {
				t.Fatal("blocked dispatch moved cargo or spent energy")
			}
		})
	}
}

func TestDistributorPrepaidFlightSurvivesPowerLoss(t *testing.T) {
	ws, source, sink := distributorTestWorld(t)
	distributorTestLoad(t, ws, source, model.ItemIronOre, 30)
	sink.Distributor.LocalStorage = 10
	bot := distributorTestBot(t, ws, source, "bot")
	distributorTestTicks(t, ws, 1, true)
	source.Runtime.State = model.BuildingWorkNoPower
	ws.PowerSnapshot = nil
	distributorTestTicks(t, ws, 8, true)
	if bot.Status != model.LogisticsDroneIdle || model.DistributorHost(ws, sink).Storage.OutputQuantity(model.ItemIronOre) != 10 || source.Distributor.Energy != 88 {
		t.Fatalf("prepaid flight failed during outage: %+v", bot)
	}
}

func distributorTestMecha(ws *model.WorldState, pos model.Position) *model.Unit {
	unit := model.UnitStats(model.UnitTypeExecutor)
	unit.ID, unit.OwnerID, unit.Type, unit.Position = "mecha", "p1", model.UnitTypeExecutor, pos
	unit.Mecha.LogisticsRequests = map[string]model.MechaLogisticsRequest{model.ItemIronOre: {Min: 5, Max: 12}}
	ws.Units[unit.ID] = &unit
	ws.Players["p1"].SetPlanetExecutor(ws.PlanetID, model.NewExecutorState(unit.ID, 1, 10, 1, 0))
	return &unit
}

func TestDistributorMechaMinMaxDeliveryAndCollection(t *testing.T) {
	for _, collection := range []bool{false, true} {
		name := "delivery"
		if collection {
			name = "collection"
		}
		t.Run(name, func(t *testing.T) {
			ws, home, sink := distributorTestWorld(t)
			sink.Distributor.Mode = model.LogisticsStationModeNone
			home.Distributor.Mode = model.LogisticsStationModeNone
			home.Distributor.LocalStorage = 0
			home.Distributor.PlayerDeliveryEnabled = true
			home.Distributor.PlayerCollectionEnabled = true
			distributorTestMecha(ws, sink.Position)
			player := ws.Players["p1"]
			if collection {
				player.Inventory[model.ItemIronOre] = 29
			} else {
				distributorTestLoad(t, ws, home, model.ItemIronOre, 40)
			}
			for _, id := range []string{"a", "b", "c"} {
				distributorTestBot(t, ws, home, id)
			}
			distributorTestTicks(t, ws, 15, true)
			if player.Inventory[model.ItemIronOre] != 12 {
				t.Fatalf("request max violated: %d", player.Inventory[model.ItemIronOre])
			}
			want := 28
			if collection {
				want = 17
			}
			if got := model.DistributorHost(ws, home).Storage.OutputQuantity(model.ItemIronOre); got != want {
				t.Fatalf("home cargo %d, want %d", got, want)
			}
			// Inside the min/max band there must be no replenishment flight.
			player.Inventory[model.ItemIronOre] = 7
			energy := home.Distributor.Energy
			distributorTestTicks(t, ws, 3, true)
			if player.Inventory[model.ItemIronOre] != 7 || home.Distributor.Energy != energy {
				t.Fatal("dispatched within min/max band")
			}
		})
	}
}

func TestDistributorMechaLeavesRangeOrActivePlanetReturnsCargo(t *testing.T) {
	for _, inactive := range []bool{false, true} {
		name := "moved"
		if inactive {
			name = "inactive_planet"
		}
		t.Run(name, func(t *testing.T) {
			ws, home, sink := distributorTestWorld(t)
			sink.Distributor.Mode = model.LogisticsStationModeNone
			home.Distributor.Mode = model.LogisticsStationModeNone
			home.Distributor.PlayerDeliveryEnabled = true
			distributorTestLoad(t, ws, home, model.ItemIronOre, 30)
			unit := distributorTestMecha(ws, sink.Position)
			bot := distributorTestBot(t, ws, home, "bot")
			distributorTestTicks(t, ws, 2, true)
			if !inactive {
				unit.Position = model.Position{X: 26, Y: 8}
			}
			distributorTestTicks(t, ws, 10, !inactive)
			if bot.Status != model.LogisticsDroneIdle || ws.Players["p1"].Inventory[model.ItemIronOre] != 0 || model.DistributorHost(ws, home).Storage.OutputQuantity(model.ItemIronOre) != 30 {
				t.Fatalf("lost cargo after target moved: %+v", bot)
			}
			if home.Distributor.Energy != 96 {
				t.Fatalf("unused prepaid energy not refunded: %d", home.Distributor.Energy)
			}
		})
	}
}

func TestDistributorInvalidTargetAndFullHomePreserveCargo(t *testing.T) {
	ws, home, sink := distributorTestWorld(t)
	host := model.DistributorHost(ws, home)
	host.Storage = model.NewStorageState(model.StorageModule{Capacity: 30, Slots: 2})
	distributorTestLoad(t, ws, home, model.ItemIronOre, 30)
	bot := distributorTestBot(t, ws, home, "bot")
	distributorTestTicks(t, ws, 2, true)
	delete(ws.Buildings, sink.ID)
	distributorTestLoad(t, ws, home, model.ItemCopperOre, 10)
	distributorTestTicks(t, ws, 5, true)
	if bot.Status != model.LogisticsDroneWaitingUnload || bot.StateReason != "home_full" || bot.Cargo[model.ItemIronOre] != 10 {
		t.Fatalf("cargo lost on full return: %+v", bot)
	}
	host.Storage.Provide(model.ItemCopperOre, 10)
	distributorTestTicks(t, ws, 2, true)
	if bot.Status != model.LogisticsDroneIdle || host.Storage.OutputQuantity(model.ItemIronOre) != 30 {
		t.Fatalf("did not resume unloading: %+v", bot)
	}
}

func TestDistributorFullDestinationWaitsAndResumes(t *testing.T) {
	ws, home, sink := distributorTestWorld(t)
	sink.Distributor.LocalStorage = 10
	host := model.DistributorHost(ws, sink)
	host.Storage = model.NewStorageState(model.StorageModule{Capacity: 10, Slots: 2})
	distributorTestLoad(t, ws, home, model.ItemIronOre, 30)
	bot := distributorTestBot(t, ws, home, "bot")
	distributorTestTicks(t, ws, 1, true)
	distributorTestLoad(t, ws, sink, model.ItemCopperOre, 10)
	distributorTestTicks(t, ws, 5, true)
	if bot.Status != model.LogisticsDroneWaitingUnload || bot.StateReason != "destination_full" || bot.CargoQty() != 10 {
		t.Fatalf("full destination lost cargo: %+v", bot)
	}
	host.Storage.Provide(model.ItemCopperOre, 10)
	distributorTestTicks(t, ws, 5, true)
	if bot.Status != model.LogisticsDroneIdle || host.Storage.OutputQuantity(model.ItemIronOre) != 10 {
		t.Fatalf("destination never resumed: %+v", bot)
	}
}

func TestDistributorChargingConsumesOnlyAllocatedPowerOnce(t *testing.T) {
	ws, home, _ := distributorTestWorld(t)
	home.Distributor.Energy = 0
	base := model.PowerDemandForBuilding(home) - home.Distributor.ChargingDemand()
	ws.PowerSnapshot.Allocations.Buildings[home.ID] = model.PowerAllocation{Demand: base + 10, Allocated: base + 3, Ratio: 1}
	settleLogisticsCharging(ws)
	settleLogisticsCharging(ws)
	if home.Distributor.Energy != 3 || home.Distributor.LastChargeAmount != 3 {
		t.Fatalf("charge was free or duplicated: %+v", home.Distributor)
	}
	ws.Tick++
	ws.PowerSnapshot.Tick = ws.Tick
	home.Distributor.Energy = 999
	settleLogisticsCharging(ws)
	if home.Distributor.Energy != 1000 || home.Distributor.LastChargeAmount != 1 {
		t.Fatal("overcharged capacity")
	}
	ws.Tick++
	ws.PowerSnapshot.Tick = ws.Tick
	home.Distributor.Energy = 0
	ws.PowerSnapshot.Allocations.Buildings[home.ID] = model.PowerAllocation{Demand: base + 10, Allocated: base, Ratio: 1}
	settleLogisticsCharging(ws)
	if home.Distributor.Energy != 0 {
		t.Fatal("base operation power created charge")
	}
}

func TestDistributorInstallConsumesRealItemsAndCannotUninstallActiveCargo(t *testing.T) {
	for _, source := range []string{"player", "storage"} {
		t.Run(source, func(t *testing.T) {
			ws, home, _ := distributorTestWorld(t)
			player := ws.Players["p1"]
			core := &GameCore{}
			cmd := model.Command{Target: model.CommandTarget{EntityID: home.ID}, Payload: map[string]any{"quantity": 2, "source": source}}
			result, _ := core.execInstallLogisticsBot(ws, "p1", cmd)
			if result.Code != model.CodeInsufficientResource || len(ws.LogisticsBots) != 0 {
				t.Fatalf("installed absent items: %+v", result)
			}
			if source == "player" {
				player.Inventory[model.ItemLogisticsBot] = 2
			} else {
				distributorTestLoad(t, ws, home, model.ItemLogisticsBot, 2)
			}
			result, _ = core.execInstallLogisticsBot(ws, "p1", cmd)
			if result.Code != model.CodeOK || len(ws.LogisticsBots) != 2 || player.Inventory[model.ItemLogisticsBot] != 0 || model.DistributorHost(ws, home).Storage.OutputQuantity(model.ItemLogisticsBot) != 0 {
				t.Fatalf("install accounting: %+v", result)
			}
			distributorTestLoad(t, ws, home, model.ItemIronOre, 30)
			distributorTestTicks(t, ws, 1, true)
			result, _ = core.execUninstallLogisticsBot(ws, "p1", cmd)
			if result.Status != model.StatusFailed || len(ws.LogisticsBots) != 2 || player.Inventory[model.ItemLogisticsBot] != 0 {
				t.Fatal("active robots uninstalled")
			}
			distributorTestTicks(t, ws, 10, true)
			result, _ = core.execUninstallLogisticsBot(ws, "p1", cmd)
			if result.Code != model.CodeOK || len(ws.LogisticsBots) != 0 || player.Inventory[model.ItemLogisticsBot] != 2 {
				t.Fatalf("idle robot recovery failed: %+v", result)
			}
		})
	}
}

func TestDistributorMissingHomeStrandsRobotWithoutLosingCargo(t *testing.T) {
	ws, home, _ := distributorTestWorld(t)
	distributorTestLoad(t, ws, home, model.ItemIronOre, 30)
	bot := distributorTestBot(t, ws, home, "bot")
	distributorTestTicks(t, ws, 2, true)
	delete(ws.Buildings, home.Distributor.HostBuildingID)
	distributorTestTicks(t, ws, 3, true)
	if bot.Status != model.LogisticsDroneStranded || bot.StateReason != "home_unavailable" || bot.Cargo[model.ItemIronOre] != 10 {
		t.Fatalf("lost orphaned flight cargo: %+v", bot)
	}
}

// Real warehouses continuously stage stock into their output buffers. That
// stock must count toward the distributor's retained amount and demand target.
func TestDistributorBufferedWarehouseAccountingThroughStorageTicks(t *testing.T) {
	for _, trip := range []string{"delivery", "pickup", "mecha"} {
		t.Run(trip, func(t *testing.T) {
			ws, source, sink := distributorTestWorld(t)
			for _, b := range []*model.Building{source, sink} {
				host := model.DistributorHost(ws, b)
				host.Storage = nil
				model.InitBuildingStorage(host)
				if host.Storage == nil || host.Storage.BufferCapacity == 0 {
					t.Fatal("fixture needs actual depot buffers")
				}
			}
			source.Distributor.LocalStorage = 10
			sink.Distributor.LocalStorage = 20
			distributorTestLoad(t, ws, source, model.ItemIronOre, 30)
			home := source
			if trip == "pickup" {
				home = sink
			}
			if trip == "mecha" {
				sink.Distributor.Mode = model.LogisticsStationModeNone
				source.Distributor.Mode = model.LogisticsStationModeNone
				source.Distributor.PlayerDeliveryEnabled = true
				unit := distributorTestMecha(ws, sink.Position)
				unit.Mecha.LogisticsRequests[model.ItemIronOre] = model.MechaLogisticsRequest{Min: 20, Max: 20}
			}
			for _, id := range []string{"a", "b", "c"} {
				distributorTestBot(t, ws, home, id)
			}
			for i := 0; i < 20; i++ {
				settleStorage(ws)
				distributorTestTicks(t, ws, 1, true)
			}
			total := func(b *model.Building) int {
				s := model.DistributorHost(ws, b).Storage
				return s.Inventory[model.ItemIronOre] + s.InputBuffer[model.ItemIronOre] + s.OutputBuffer[model.ItemIronOre]
			}
			if got := total(source); got != 10 {
				t.Fatalf("source retained %d instead of 10; storage=%+v", got, model.DistributorHost(ws, source).Storage)
			}
			got := total(sink)
			if trip == "mecha" {
				got = ws.Players["p1"].Inventory[model.ItemIronOre]
			}
			if got != 20 {
				t.Fatalf("receiver reached %d instead of 20", got)
			}
			for _, bot := range ws.LogisticsBots {
				if bot.Status != model.LogisticsDroneIdle || bot.CargoQty() != 0 {
					t.Fatalf("buffered warehouse never settled: %+v", bot)
				}
			}
		})
	}
}
