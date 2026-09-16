package gamecore

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"

	"siliconworld/internal/gamedir"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

func productionPowerTick(ws *model.WorldState, generator *model.Building, supply int) {
	ws.Tick++
	ws.PowerSnapshot = nil
	ws.PowerInputs = []model.PowerInput{{BuildingID: generator.ID, OwnerID: "p1", Output: supply}}
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
	settleResources(ws)
	settleProduction(ws)
	settleStorage(ws)
}

func newProductionPowerFixture() (*model.WorldState, *model.Building, *model.Building) {
	ws := newPowerTestWorld()
	b := colliderForTest(ws, "antimatter")
	b.Storage.EnsureInventory()[model.ItemCriticalPhoton] = 2
	generator := addPowerTestBuilding(ws, "generator", model.BuildingTypeWindTurbine, model.Position{X: 2, Y: 3})
	return ws, b, generator
}

func TestProductionPowerRatioDeterminesActualCycleDuration(t *testing.T) {
	for _, tc := range []struct {
		name             string
		supply, duration int
	}{
		{"full", 24, 120}, {"half", 12, 240}, {"twenty_of_twenty_four", 20, 144}, {"one_of_twenty_four", 1, 2880},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ws, b, generator := newProductionPowerFixture()
			productionPowerTick(ws, generator, tc.supply)
			if b.Production.RemainingTicks != 120 || b.Production.ProgressFraction != 0 || availableStorageItem(b.Storage, model.ItemCriticalPhoton) != 0 {
				t.Fatalf("batch did not reserve inputs once: %+v %+v", b.Production, b.Storage)
			}
			for tick := 1; tick <= tc.duration; tick++ {
				productionPowerTick(ws, generator, tc.supply)
				if tick < tc.duration && b.ExportableItemQuantity(model.ItemAntimatter) != 0 {
					t.Fatalf("finished early at tick %d of %d", tick, tc.duration)
				}
				if err := b.Production.Validate(); err != nil {
					t.Fatalf("tick %d: %v", tick, err)
				}
			}
			if b.Production.RemainingTicks != 0 || b.Production.ProgressFraction != 0 || b.ExportableItemQuantity(model.ItemAntimatter) != 2 || b.ExportableItemQuantity(model.ItemHydrogen) != 2 {
				t.Fatalf("wrong completion at %d ticks: %+v %+v", tc.duration, b.Production, b.Storage)
			}
		})
	}
}

func TestProductionPowerZeroAndChangingAllocation(t *testing.T) {
	ws, b, generator := newProductionPowerFixture()
	productionPowerTick(ws, generator, 0)
	if availableStorageItem(b.Storage, model.ItemCriticalPhoton) != 2 || b.Production.RemainingTicks != 0 {
		t.Fatal("zero supply started production")
	}
	productionPowerTick(ws, generator, 12)
	productionPowerTick(ws, generator, 12)
	if b.Production.RemainingTicks != 120 || b.Production.ProgressFraction != .5 {
		t.Fatalf("half tick discarded: %+v", b.Production)
	}
	for i := 0; i < 10; i++ {
		productionPowerTick(ws, generator, 0)
	}
	if b.Production.RemainingTicks != 120 || b.Production.ProgressFraction != .5 {
		t.Fatal("outage changed fractional progress")
	}
	// Even a lagging running flag cannot manufacture work without allocation.
	b.Runtime.State = model.BuildingWorkRunning
	settleProduction(ws)
	if b.Production.ProgressFraction != .5 {
		t.Fatal("running flag bypassed zero allocation")
	}
	productionPowerTick(ws, generator, 6)
	if b.Production.ProgressFraction != .75 {
		t.Fatalf("quarter power not accumulated: %+v", b.Production)
	}
	productionPowerTick(ws, generator, 24)
	if b.Production.RemainingTicks != 119 || b.Production.ProgressFraction != .75 {
		t.Fatalf("changed power lost credit: %+v", b.Production)
	}
	productionPowerTick(ws, generator, 6)
	if b.Production.RemainingTicks != 118 || b.Production.ProgressFraction != 0 {
		t.Fatalf("fraction did not complete exactly: %+v", b.Production)
	}
}

func TestProductionPowerSaveResumesFractionAndBlockedBatch(t *testing.T) {
	core := newSaveStateHarness(t)
	ws := core.World()
	// Keep this isolated grid off the starting colony's power network.
	b := newBuilding("brownout-collider", model.BuildingTypeMiniatureParticleCollider, "p1", model.Position{X: 40, Y: 25})
	b.Production.RecipeID = "antimatter"
	b.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, b)
	generator := addPowerTestBuilding(ws, "brownout-generator", model.BuildingTypeWindTurbine, model.Position{X: 39, Y: 25})
	b.Storage.EnsureInventory()[model.ItemCriticalPhoton] = 4
	productionPowerTick(ws, generator, 20)
	productionPowerTick(ws, generator, 20)
	if math.Abs(b.Production.ProgressFraction-5.0/6) > 1e-12 {
		t.Fatalf("missing fractional work: %+v", b.Production)
	}
	save, err := core.ExportSaveFile("fractional-production")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(save)
	if err != nil {
		t.Fatal(err)
	}
	var decoded gamedir.SaveFile
	if err = json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	restored, err := NewFromSave(core.cfg, core.maps, queue.New(), NewEventBus(), nil, &decoded)
	if err != nil {
		t.Fatal(err)
	}
	resumedWS := restored.World()
	resumed := resumedWS.Buildings[b.ID]
	resumedGenerator := resumedWS.Buildings[generator.ID]
	if !reflect.DeepEqual(resumed.Production, b.Production) {
		t.Fatalf("save lost fraction: %+v vs %+v", resumed.Production, b.Production)
	}
	// Block both possible products while leaving the next batch's photons intact.
	for _, building := range []*model.Building{b, resumed} {
		building.Storage.EnsureInventory()[model.ItemStoneOre] = building.Storage.Capacity - 2
		building.Storage.EnsureInputBuffer()[model.ItemStoneOre] = building.Storage.InputBufferCapacity() - 2
	}
	for tick := 0; tick < 180; tick++ {
		supply := []int{20, 12, 24, 0}[tick%4]
		productionPowerTick(ws, generator, supply)
		productionPowerTick(resumedWS, resumedGenerator, supply)
		if !reflect.DeepEqual(resumed.Production, b.Production) || !reflect.DeepEqual(resumed.Storage, b.Storage) {
			t.Fatalf("resumed simulation diverged at %d", tick)
		}
	}
	for i := 0; i < 120; i++ {
		productionPowerTick(resumedWS, resumedGenerator, 24)
	}
	if resumed.Production.RemainingTicks != 0 || resumed.Production.ProgressFraction != 0 || len(resumed.Production.PendingOutputs) != 1 || len(resumed.Production.PendingByproducts) != 1 || availableStorageItem(resumed.Storage, model.ItemCriticalPhoton) != 2 {
		t.Fatalf("blocked batch consumed future material/credit: %+v %+v", resumed.Production, resumed.Storage)
	}
	delete(resumed.Storage.Inventory, model.ItemStoneOre)
	delete(resumed.Storage.InputBuffer, model.ItemStoneOre)
	productionPowerTick(resumedWS, resumedGenerator, 0)
	if resumed.ExportableItemQuantity(model.ItemAntimatter) != 0 {
		t.Fatal("unpowered blocked batch committed")
	}
	productionPowerTick(resumedWS, resumedGenerator, 12)
	if resumed.ExportableItemQuantity(model.ItemAntimatter) != 2 || resumed.ExportableItemQuantity(model.ItemHydrogen) != 2 || availableStorageItem(resumed.Storage, model.ItemCriticalPhoton) != 2 {
		t.Fatalf("unblocked batch incorrect: %+v", resumed.Storage)
	}
	productionPowerTick(resumedWS, resumedGenerator, 12)
	if resumed.Production.RemainingTicks != 120 || resumed.Production.ProgressFraction != 0 || availableStorageItem(resumed.Storage, model.ItemCriticalPhoton) != 0 {
		t.Fatalf("next batch inherited blocked credit: %+v %+v", resumed.Production, resumed.Storage)
	}
}

// supplyProductionFixture drives the real grid allocator for tests which call
// individual production phases instead of the generation/settlement pipeline.
func supplyProductionFixture(t *testing.T, ws *model.WorldState, building *model.Building) {
	t.Helper()
	id := building.ID + "-test-power"
	generator := ws.Buildings[id]
	if generator == nil {
		for _, pos := range ws.SurfaceNeighbors(building.Position) {
			if ws.TileBuilding[model.TileKey(pos.X, pos.Y)] != "" {
				continue
			}
			generator = newBuilding(id, model.BuildingTypeWindTurbine, building.OwnerID, pos)
			attachBuilding(ws, generator)
			break
		}
	}
	if generator == nil {
		t.Fatal("no adjacent supply fixture location")
	}
	output := 0
	for _, b := range ws.Buildings {
		output += model.PowerDemandForBuilding(b)
	}
	found := false
	for i := range ws.PowerInputs {
		if ws.PowerInputs[i].BuildingID == id {
			ws.PowerInputs[i].Output = output
			found = true
		}
	}
	if !found {
		ws.PowerInputs = append(ws.PowerInputs, model.PowerInput{BuildingID: id, OwnerID: building.OwnerID, Output: output})
	}
	ws.PowerSnapshot = nil
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
}
