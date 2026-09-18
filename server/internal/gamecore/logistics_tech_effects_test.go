package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
)

func newPileSorterBuilding(id string, pos model.Position) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypePileSorter, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypePileSorter,
		OwnerID:     "p1",
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingSorter(b)
	b.Runtime.State = model.BuildingWorkRunning
	return b
}

func sorterTechFixture(t *testing.T, sorter *model.Building) (*model.WorldState, *model.Building, *model.Building) {
	t.Helper()
	ws := model.NewWorldState("planet-1", 5)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	input := newConveyorBuilding("in", model.Position{X: 0, Y: 0}, model.ConveyorEast)
	output := newConveyorBuilding("out", model.Position{X: 2, Y: 0}, model.ConveyorEast)
	sorter.Sorter.InputDirections = []model.ConveyorDirection{model.ConveyorWest}
	sorter.Sorter.OutputDirections = []model.ConveyorDirection{model.ConveyorEast}
	sorter.Sorter.Range = 1
	sorter.Sorter.Normalize()
	attachBuilding(ws, input)
	attachBuilding(ws, output)
	attachBuilding(ws, sorter)
	return ws, input, output
}

func TestPileSorterLiftsWholePilesPerGrab(t *testing.T) {
	ws, input, output := sorterTechFixture(t, newPileSorterBuilding("sorter", model.Position{X: 1, Y: 0}))
	ws.Buildings["sorter"].Sorter.Speed = 1
	input.Conveyor.AppendStacks([]model.ItemStack{{ItemID: model.ItemIronOre, Quantity: 4}})

	settleSorters(ws)

	if got := output.Conveyor.TotalItems(); got != 4 {
		t.Fatalf("pile sorter must lift the whole 4x pile in one grab, moved %d", got)
	}
	if got := input.Conveyor.TotalItems(); got != 0 {
		t.Fatalf("source retained %d items", got)
	}
	transfer := ws.Buildings["sorter"].Sorter.LastTransfer
	if transfer == nil || transfer.Quantity != 4 {
		t.Fatalf("transfer record must reflect the whole pile: %+v", transfer)
	}
}

func TestOrdinarySorterPeelsSingleItemsFromPile(t *testing.T) {
	sorter := newSorterBuilding("sorter", model.Position{X: 1, Y: 0})
	sorter.Sorter.Speed = 3
	ws, input, output := sorterTechFixture(t, sorter)
	input.Conveyor.AppendStacks([]model.ItemStack{{ItemID: model.ItemIronOre, Quantity: 4}})

	settleSorters(ws)

	if got := output.Conveyor.TotalItems(); got != 3 {
		t.Fatalf("ordinary sorter must peel one item per grab (speed 3), moved %d", got)
	}
	if got := input.Conveyor.TotalItems(); got != 1 {
		t.Fatalf("source retained %d items", got)
	}
}

func TestSorterCargoStackingRaisesStacksPerGrab(t *testing.T) {
	t.Run("ordinary_sorter_peels_more_per_grab", func(t *testing.T) {
		sorter := newSorterBuilding("sorter", model.Position{X: 1, Y: 0})
		sorter.Sorter.Speed = 2
		ws, input, output := sorterTechFixture(t, sorter)
		grantTechs(ws, "p1", "sorter_cargo_stacking")
		ws.Players["p1"].Tech.CompletedTechs["sorter_cargo_stacking"] = 2
		input.Conveyor.AppendStacks([]model.ItemStack{{ItemID: model.ItemIronOre, Quantity: 8}})

		settleSorters(ws)

		// 2 grabs x (1 + 2) stacks = 6 items.
		if got := output.Conveyor.TotalItems(); got != 6 {
			t.Fatalf("stacking level 2 must move 6 items with speed 2, moved %d", got)
		}
		if got := input.Conveyor.TotalItems(); got != 2 {
			t.Fatalf("source retained %d items", got)
		}
	})
	t.Run("pile_sorter_lifts_multiple_piles_per_grab", func(t *testing.T) {
		ws, input, output := sorterTechFixture(t, newPileSorterBuilding("sorter", model.Position{X: 1, Y: 0}))
		ws.Buildings["sorter"].Sorter.Speed = 1
		grantTechs(ws, "p1", "sorter_cargo_stacking")
		input.Conveyor.AppendStacks([]model.ItemStack{
			{ItemID: model.ItemIronOre, Quantity: 4},
			{ItemID: model.ItemCopperOre, Quantity: 4},
		})

		settleSorters(ws)

		// 1 grab x (1 + 1) piles = two whole 4x piles.
		if got := output.Conveyor.TotalItems(); got != 8 {
			t.Fatalf("stacking level 1 pile sorter must lift 2 piles in one grab, moved %d", got)
		}
	})
	t.Run("unresearched_stacking_keeps_single_stack_grabs", func(t *testing.T) {
		sorter := newSorterBuilding("sorter", model.Position{X: 1, Y: 0})
		sorter.Sorter.Speed = 2
		ws, input, output := sorterTechFixture(t, sorter)
		input.Conveyor.AppendStacks([]model.ItemStack{{ItemID: model.ItemIronOre, Quantity: 8}})

		settleSorters(ws)

		if got := output.Conveyor.TotalItems(); got != 2 {
			t.Fatalf("unresearched sorter must move speed(2) items, moved %d", got)
		}
		if got := input.Conveyor.TotalItems(); got != 6 {
			t.Fatalf("source retained %d items", got)
		}
	})
}

func carrierTechFixture(t *testing.T, capacityLevel, engineLevel int) (*model.WorldState, map[string]*model.WorldState, *model.LogisticsShipState) {
	t.Helper()
	ws := model.NewWorldState("planet-1", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	grantTechs(ws, "p1", "logistics_carrier_capacity", "logistics_carrier_engine")
	ws.Players["p1"].Tech.CompletedTechs["logistics_carrier_capacity"] = capacityLevel
	ws.Players["p1"].Tech.CompletedTechs["logistics_carrier_engine"] = engineLevel
	station := newInterstellarLogisticsStationBuilding("home", model.Position{X: 1, Y: 1})
	attachBuilding(ws, station)
	ship := model.NewLogisticsShipState("ship", station.ID, station.Position)
	ship.OwnerID = "p1"
	if err := model.RegisterLogisticsShip(ws, ship); err != nil {
		t.Fatal(err)
	}
	worlds := map[string]*model.WorldState{ws.PlanetID: ws}
	return ws, worlds, ship
}

func TestLogisticsCarrierTechsRaiseShipCapacityAndSpeed(t *testing.T) {
	_, worlds, ship := carrierTechFixture(t, 2, 3)

	settleLogisticsShips(worlds)

	if ship.Capacity != model.DefaultLogisticsShipCapacity+2*100 {
		t.Fatalf("capacity tech not applied: %d", ship.Capacity)
	}
	if ship.Speed != model.DefaultLogisticsShipSpeed+3*1 {
		t.Fatalf("engine tech not applied: %d", ship.Speed)
	}
	// Settlement must be idempotent: recomputed from defaults, never accumulated.
	settleLogisticsShips(worlds)
	if ship.Capacity != 400 || ship.Speed != 5 {
		t.Fatalf("stats accumulated across ticks: capacity=%d speed=%d", ship.Capacity, ship.Speed)
	}

	// The raised capacity really fits more cargo.
	accepted, _, err := ship.Load(model.ItemIronOre, 350)
	if err != nil || accepted != 350 {
		t.Fatalf("expanded hold rejected cargo: accepted=%d err=%v", accepted, err)
	}

	// The raised speed really shortens trips.
	ship2 := model.NewLogisticsShipState("ship2", ship.StationID, ship.Position)
	ship2.OwnerID = "p1"
	ship2.RefreshTechStats(nil)
	if err := ship2.BeginTrip("planet-2", "target", model.Position{X: 9, Y: 9}, 10, false); err != nil {
		t.Fatal(err)
	}
	if ship2.TravelTicks != 5 {
		t.Fatalf("baseline ship travel ticks: got %d want 5", ship2.TravelTicks)
	}
	fastShip := model.NewLogisticsShipState("ship3", ship.StationID, ship.Position)
	fastShip.OwnerID = "p1"
	fastShip.Speed = ship.Speed
	if err := fastShip.BeginTrip("planet-2", "target", model.Position{X: 9, Y: 9}, 10, false); err != nil {
		t.Fatal(err)
	}
	if fastShip.TravelTicks != 2 {
		t.Fatalf("engine-boosted travel ticks: got %d want 2", fastShip.TravelTicks)
	}
}

func TestLogisticsShipTechStatsSurviveSnapshotRestore(t *testing.T) {
	ws, worlds, ship := carrierTechFixture(t, 4, 7)
	settleLogisticsShips(worlds)
	if ship.Capacity != 600 || ship.Speed != 9 {
		t.Fatalf("pre-restore stats: capacity=%d speed=%d", ship.Capacity, ship.Speed)
	}

	restored, err := snapshot.CaptureWorld(ws).Restore()
	if err != nil {
		t.Fatal(err)
	}
	restoredShip := restored.LogisticsShips[ship.ID]
	if restoredShip == nil {
		t.Fatal("ship lost in snapshot")
	}
	restoredShip.Capacity = 12345 // simulate a tampered/stale persisted value
	restoredShip.Speed = 1
	restoredWorlds := map[string]*model.WorldState{restored.PlanetID: restored}
	settleLogisticsShips(restoredWorlds)
	if restoredShip.Capacity != 600 || restoredShip.Speed != 9 {
		t.Fatalf("restore did not recompute tech stats: capacity=%d speed=%d", restoredShip.Capacity, restoredShip.Speed)
	}
}

func TestDistributionRangeTechExtendsDeliveryRange(t *testing.T) {
	ws, source, sink := distributorTestWorld(t)
	// Base range is 12; distance 16 needs distribution_range level 1 (+5).
	// The host depot must move with its distributor (hosts bind by position).
	sink.Position = model.Position{X: 24, Y: 8, Z: 1}
	ws.Buildings[sink.Distributor.HostBuildingID].Position = model.Position{X: 24, Y: 8}
	distributorTestLoad(t, ws, source, model.ItemIronOre, 30)
	bot := distributorTestBot(t, ws, source, "bot")

	distributorTestTicks(t, ws, 2, true)
	if bot.Status != model.LogisticsDroneIdle || bot.PickupQuantity != 0 {
		t.Fatalf("dispatched beyond base range without research: %+v", bot)
	}

	grantTechs(ws, "p1", "distribution_range")
	// Tick manually: the shared distributorTestTicks helper validates bots
	// against the base-range energy budget, which the extended flight exceeds.
	settleDistributors(ws, true)
	if bot.Status == model.LogisticsDroneIdle || bot.PickupQuantity <= 0 {
		t.Fatalf("distribution_range tech did not extend delivery range: %+v", bot)
	}
	if bot.TargetID != sink.ID || bot.TripKind != "delivery" {
		t.Fatalf("extended flight targets the far sink: %+v", bot)
	}
	if ws.SurfaceDistance(source.Position, sink.Position) != 16 {
		t.Fatalf("fixture distance changed: %d", ws.SurfaceDistance(source.Position, sink.Position))
	}
}

func TestInstallLogisticsVehicleRequiresUnitUnlockTech(t *testing.T) {
	ws := model.NewWorldState("planet-1", 12)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true, Inventory: model.ItemInventory{
		model.ItemLogisticsDrone:  2,
		model.ItemLogisticsVessel: 2,
	}}
	core := &GameCore{}
	station := newInterstellarLogisticsStationBuilding("station", model.Position{X: 5, Y: 5})
	attachBuilding(ws, station)
	install := func(itemID string) model.CommandResult {
		r, _ := core.execInstallLogisticsVehicle(ws, "p1", model.Command{
			Type:    model.CmdInstallLogisticsVehicle,
			Target:  model.CommandTarget{EntityID: station.ID},
			Payload: map[string]any{"item_id": itemID, "quantity": 1},
		})
		return r
	}

	for _, itemID := range []string{model.ItemLogisticsDrone, model.ItemLogisticsVessel} {
		r := install(itemID)
		if r.Status != model.StatusFailed || r.Code != model.CodeValidationFailed || !strings.Contains(r.Message, "research required") {
			t.Fatalf("%s install without unit unlock tech must be rejected: %+v", itemID, r)
		}
		if ws.Players["p1"].Inventory[itemID] != 2 {
			t.Fatalf("rejected install consumed %s", itemID)
		}
	}

	grantTechs(ws, "p1", "planetary_logistics")
	if r := install(model.ItemLogisticsDrone); r.Status != model.StatusExecuted {
		t.Fatalf("drone install with planetary_logistics must succeed: %+v", r)
	}
	if r := install(model.ItemLogisticsVessel); r.Status != model.StatusFailed || !strings.Contains(r.Message, "research required") {
		t.Fatalf("vessel install still requires interstellar_logistics: %+v", r)
	}

	grantTechs(ws, "p1", "interstellar_logistics")
	if r := install(model.ItemLogisticsVessel); r.Status != model.StatusExecuted {
		t.Fatalf("vessel install with interstellar_logistics must succeed: %+v", r)
	}
	if model.StationDroneCount(ws, station.ID) != 1 || model.StationShipCount(ws, station.ID) != 1 {
		t.Fatal("fleet counts wrong after gated installs")
	}
	for _, ship := range ws.LogisticsShips {
		if ship.Capacity != model.DefaultLogisticsShipCapacity {
			t.Fatalf("unexpected ship capacity without carrier tech: %d", ship.Capacity)
		}
	}
}
