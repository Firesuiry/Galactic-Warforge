package gamecore

import (
	"reflect"
	"siliconworld/internal/model"
	"siliconworld/internal/snapshot"
	"testing"
)

func sprayCoaterFixture() (*model.WorldState, *model.Building, map[model.ConveyorDirection]*model.Building) {
	ws := model.NewWorldState("sprayer", 8)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true, Inventory: model.ItemInventory{}}
	b := surfaceTestBuilding(ws, "sprayer", model.BuildingTypeSprayCoater, model.Position{X: 3, Y: 3})
	model.InitBuildingStorage(b)
	model.InitBuildingSprayCoater(b)
	belts := map[model.ConveyorDirection]*model.Building{}
	for _, dir := range []model.ConveyorDirection{model.ConveyorWest, model.ConveyorEast, model.ConveyorNorth} {
		pos, forward := ws.SurfaceStep(b.Position, dir)
		if dir != model.ConveyorEast {
			forward = forward.Opposite()
		}
		belt := newConveyorBuilding(string(dir), pos, forward)
		belt.Conveyor.MaxStack = 100
		attachBuilding(ws, belt)
		belts[dir] = belt
	}
	return ws, b, belts
}

func TestSprayCoaterChargesExactRealDoseAndPassesUncoatedWhenEmpty(t *testing.T) {
	for _, tc := range []struct {
		item               string
		yield, level, uses int
	}{{model.ItemProliferatorMk1, 12, 1, 4}, {model.ItemProliferatorMk2, 24, 2, 6}, {model.ItemProliferatorMk3, 60, 3, 8}} {
		t.Run(tc.item, func(t *testing.T) {
			ws, b, belts := sprayCoaterFixture()
			belts[model.ConveyorNorth].Conveyor.Insert(tc.item, 1)
			belts[model.ConveyorWest].Conveyor.Insert(model.ItemHydrogen, tc.yield+3)
			for tick := 0; tick < 30; tick++ {
				ws.Tick = int64(tick)
				settleSprayCoaters(ws)
				settleStorage(ws)
			}
			s := b.SprayCoater
			if s.CoatedItems != int64(tc.yield) || s.ConsumedProliferator != 1 || s.SprayUnits != 0 || totalStorageItems(b.Storage) != 0 {
				t.Fatalf("dose not conserved: %+v", s)
			}
			coated, bare := 0, 0
			for _, stack := range belts[model.ConveyorEast].Conveyor.Buffer {
				if stack.Spray == nil {
					bare += stack.Quantity
				} else {
					coated += stack.Quantity
					if stack.Spray.Level != tc.level || stack.Spray.RemainingUses != tc.uses {
						t.Fatal("wrong coating")
					}
				}
			}
			if coated != tc.yield || bare != 3 {
				t.Fatalf("actual output coated=%d bare=%d", coated, bare)
			}
		})
	}
}

func TestSprayCoaterDoesNotRecoatActiveSprayOrRunWithoutPower(t *testing.T) {
	ws, b, belts := sprayCoaterFixture()
	b.Storage.Load(model.ItemProliferatorMk3, 1)
	belts[model.ConveyorWest].Conveyor.Buffer = []model.ItemStack{{ItemID: model.ItemHydrogen, Quantity: 2, Spray: &model.SprayState{Level: 1, RemainingUses: 2}}}
	settleSprayCoaters(ws)
	if b.SprayCoater.CoatedItems != 0 || totalStorageItems(b.Storage) != 1 || b.SprayCoater.OutputBuffer[0].Spray.RemainingUses != 2 {
		t.Fatal("recoated active input")
	}
	b.Runtime.State = model.BuildingWorkNoPower
	before := b.SprayCoater.Clone()
	settleSprayCoaters(ws)
	before.State = "no_power"
	if !reflect.DeepEqual(before, b.SprayCoater.Clone()) {
		t.Fatal("no-power sprayer transferred or consumed")
	}
}

func TestSprayCoaterBlockedDoesNotConsumeAndPersistsCharges(t *testing.T) {
	ws, b, belts := sprayCoaterFixture()
	b.Storage.Load(model.ItemProliferatorMk2, 1)
	belts[model.ConveyorWest].Conveyor.Insert(model.ItemHydrogen, 6)
	settleSprayCoaters(ws)
	if b.SprayCoater.SprayUnits != 18 || b.SprayCoater.CoatedItems != 6 {
		t.Fatal("unused dose not retained")
	}
	saved := snapshot.CaptureWorld(ws)
	restored, err := saved.Restore()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(b.SprayCoater.Clone(), restored.Buildings[b.ID].SprayCoater) {
		t.Fatal("snapshot lost unused dose")
	}
	clone := b.Clone()
	clone.SprayCoater.SprayEffect.RemainingUses = 999
	clone.SprayCoater.OutputBuffer[0].Spray.RemainingUses = 999
	if b.SprayCoater.SprayEffect.RemainingUses == 999 || b.SprayCoater.OutputBuffer[0].Spray.RemainingUses == 999 {
		t.Fatal("clone aliases charged dose or cargo")
	}
	b.SprayCoater.OutputBuffer = []model.ItemStack{{ItemID: model.ItemHydrogen, Quantity: 24}}
	belts[model.ConveyorEast].Conveyor.Insert(model.ItemHydrogen, 100)
	belts[model.ConveyorWest].Conveyor.Insert(model.ItemHydrogen, 3)
	before := b.SprayCoater.Clone()
	settleSprayCoaters(ws)
	before.State = "blocked"
	if !reflect.DeepEqual(before, b.SprayCoater.Clone()) || belts[model.ConveyorWest].Conveyor.TotalItems() != 3 {
		t.Fatal("blocked sprayer consumed cargo or dose")
	}
}

func TestSprayCoaterRealTransferAndStorageIOIsolation(t *testing.T) {
	ws, b, belts := sprayCoaterFixture()
	ws.Players["p1"].Inventory[model.ItemProliferatorMk3] = 1
	ws.Players["p1"].Inventory[model.ItemHydrogen] = 1
	gc := &GameCore{}
	command := model.Command{Payload: map[string]any{"building_id": b.ID, "item_id": model.ItemHydrogen, "quantity": 1}}
	result, _ := gc.execTransferItem(ws, "p1", command)
	if result.Status != model.StatusFailed || ws.Players["p1"].Inventory[model.ItemHydrogen] != 1 {
		t.Fatal("count-only storage accepted cargo")
	}
	command.Payload["item_id"] = model.ItemProliferatorMk3
	result, _ = gc.execTransferItem(ws, "p1", command)
	if result.Status != model.StatusExecuted || totalStorageItems(b.Storage) != 1 || ws.Players["p1"].Inventory[model.ItemProliferatorMk3] != 0 {
		t.Fatalf("real reagent loading failed: %+v", result)
	}
	belts[model.ConveyorWest].Conveyor.Buffer = []model.ItemStack{{ItemID: model.ItemHydrogen, Quantity: 1, Spray: &model.SprayState{Level: 1, RemainingUses: 2}}}
	settleBuildingIO(ws)
	if belts[model.ConveyorWest].Conveyor.TotalItems() != 1 || belts[model.ConveyorEast].Conveyor.TotalItems() != 0 || totalStorageItems(b.Storage) != 1 {
		t.Fatal("ordinary IO stole sprayed cargo or exported reagent")
	}
}

func TestSprayCoaterFeedsRealSprayedFractionation(t *testing.T) {
	ws, coater, belts := sprayCoaterFixture()
	fractionator := surfaceTestBuilding(ws, "fractionator", model.BuildingTypeFractionator, model.Position{X: 5, Y: 3})
	model.InitBuildingFractionation(fractionator)
	returned := newConveyorBuilding("return", model.Position{X: 6, Y: 3}, model.ConveyorEast)
	returned.Conveyor.MaxStack = 100
	attachBuilding(ws, returned)
	product := newConveyorBuilding("product", model.Position{X: 5, Y: 4}, model.ConveyorSouth)
	product.Conveyor.MaxStack = 100
	attachBuilding(ws, product)
	belts[model.ConveyorNorth].Conveyor.Insert(model.ItemProliferatorMk3, 1)
	belts[model.ConveyorWest].Conveyor.Insert(model.ItemHydrogen, 12)
	for tick := 0; tick < 20; tick++ {
		ws.Tick = int64(tick)
		settleConveyors(ws)
		settleSprayCoaters(ws)
		settleFractionation(ws)
	}
	if coater.SprayCoater.CoatedItems != 12 || coater.SprayCoater.ConsumedProliferator != 1 || coater.SprayCoater.SprayUnits != 48 {
		t.Fatal("sprayer did not debit physical reagent")
	}
	if fractionator.Fractionation.Attempts != 12 || fractionator.Fractionation.LastProbability != 0.02 || fractionationTotal(ws) != 12 {
		t.Fatalf("sprayed line failed: %+v total=%d", fractionator.Fractionation, fractionationTotal(ws))
	}
	for _, stack := range returned.Conveyor.Buffer {
		if stack.Spray == nil || stack.Spray.RemainingUses != 7 {
			t.Fatal("failed hydrogen lost/deferred spray consumption")
		}
	}
}
