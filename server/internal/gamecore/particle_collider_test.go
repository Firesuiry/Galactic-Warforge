package gamecore

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"siliconworld/internal/gamedir"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

func colliderForTest(ws *model.WorldState, recipe string) *model.Building {
	b := newBuilding("collider", model.BuildingTypeMiniatureParticleCollider, "p1", model.Position{X: 3, Y: 3})
	b.Production.RecipeID = recipe
	b.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, b)
	return b
}

func TestParticleColliderRecipesThroughBelts(t *testing.T) {
	for _, tc := range []struct {
		recipe          string
		duration        int
		inputs, outputs model.ItemInventory
	}{
		{"deuterium_collision", 300, model.ItemInventory{model.ItemHydrogen: 10}, model.ItemInventory{model.ItemDeuterium: 5}},
		{"strange_matter", 480, model.ItemInventory{model.ItemParticleContainer: 2, model.ItemDeuterium: 10, model.ItemIronIngot: 2}, model.ItemInventory{model.ItemStrangeMatter: 1}},
		{"antimatter", 120, model.ItemInventory{model.ItemCriticalPhoton: 2}, model.ItemInventory{model.ItemAntimatter: 2, model.ItemHydrogen: 2}},
	} {
		t.Run(tc.recipe, func(t *testing.T) {
			ws := model.NewWorldState("planet", 12)
			b := colliderForTest(ws, tc.recipe)
			input := newConveyorBuilding("input", model.Position{X: 2, Y: 3}, model.ConveyorEast)
			output := newConveyorBuilding("output", model.Position{X: 4, Y: 3}, model.ConveyorEast)
			side := newConveyorBuilding("side", model.Position{X: 3, Y: 4}, model.ConveyorSouth)
			for _, belt := range []*model.Building{input, output, side} {
				attachBuilding(ws, belt)
			}
			for item, quantity := range tc.inputs {
				for quantity > 0 {
					accepted, remaining, err := input.Conveyor.Insert(item, quantity)
					if err != nil || accepted == 0 {
						t.Fatalf("feed %s: accepted=%d err=%v", item, accepted, err)
					}
					quantity = remaining
					for drain := 0; drain < 20 && input.Conveyor.TotalItems() > 0; drain++ {
						settleBuildingIO(ws)
						settleStorage(ws)
					}
				}
			}
			settleProduction(ws)
			if b.Production.RemainingTicks != tc.duration {
				t.Fatalf("duration=%d want %d", b.Production.RemainingTicks, tc.duration)
			}
			for item := range tc.inputs {
				if availableStorageItem(b.Storage, item) != 0 {
					t.Fatalf("unconsumed input %s: %+v", item, b.Storage)
				}
			}
			for i := 0; i < tc.duration+10; i++ {
				ws.Tick++
				settleProduction(ws)
				settleStorage(ws)
				settleBuildingIO(ws)
			}
			got := model.ItemInventory{}
			for _, belt := range []*model.Building{output, side} {
				for _, stack := range belt.Conveyor.Buffer {
					got[stack.ItemID] += stack.Quantity
				}
			}
			if !reflect.DeepEqual(got, tc.outputs) {
				t.Fatalf("belt output=%v want=%v; storage=%+v", got, tc.outputs, b.Storage)
			}
			if totalStorageItems(b.Storage) != 0 || len(b.Production.PendingOutputs) != 0 || len(b.Production.PendingByproducts) != 0 {
				t.Fatalf("unexpected leftover batch: %+v %+v", b.Storage, b.Production)
			}
		})
	}
}

func TestParticleColliderPowerGridStopsAndResumesBatch(t *testing.T) {
	ws := newPowerTestWorld()
	// A real power node connects to the collider; supply is controlled at the
	// generation/settlement boundary to exercise under-power and recovery.
	b := colliderForTest(ws, "deuterium_collision")
	generator := addPowerTestBuilding(ws, "generator", model.BuildingTypeWindTurbine, model.Position{X: 2, Y: 3})
	b.Storage.EnsureInventory()[model.ItemHydrogen] = 10
	if got := model.PowerDemandForBuilding(b); got != 24 {
		t.Fatalf("power demand=%d want24", got)
	}
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
	settleResources(ws)
	settleProduction(ws)
	if b.Runtime.State != model.BuildingWorkNoPower || b.Storage.Inventory[model.ItemHydrogen] != 10 || b.Production.RemainingTicks != 0 {
		t.Fatalf("unpowered start consumed inputs: %+v %+v", b.Runtime, b.Production)
	}
	ws.PowerInputs = []model.PowerInput{{BuildingID: generator.ID, OwnerID: "p1", Output: 24}}
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
	settleResources(ws)
	settleProduction(ws)
	if b.Runtime.State != model.BuildingWorkRunning || b.Production.RemainingTicks != 300 {
		t.Fatalf("no powered start: %+v %+v", b.Runtime, b.Production)
	}
	ws.PowerInputs = nil
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
	settleResources(ws)
	for i := 0; i < 10; i++ {
		settleProduction(ws)
	}
	if b.Runtime.State != model.BuildingWorkNoPower || b.Production.RemainingTicks != 300 {
		t.Fatal("power loss advanced batch")
	}
	ws.PowerInputs = []model.PowerInput{{BuildingID: generator.ID, OwnerID: "p1", Output: 24}}
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
	settleResources(ws)
	settleProduction(ws)
	if b.Production.RemainingTicks != 299 {
		t.Fatal("power restored did not resume batch")
	}
}

func TestParticleColliderFullOutputIsAtomicAndSurvivesSave(t *testing.T) {
	core := newSaveStateHarness(t)
	ws := core.World()
	b := colliderForTest(ws, "antimatter")
	b.Storage.EnsureInventory()[model.ItemCriticalPhoton] = 4
	settleProduction(ws)
	// Leave room for the main output alone, not its hydrogen byproduct. The
	// whole batch must remain pending; repeated attempts cannot duplicate it.
	b.Storage.EnsureInventory()[model.ItemStoneOre] = b.Storage.Capacity - 2
	b.Storage.EnsureInputBuffer()[model.ItemStoneOre] = b.Storage.InputBufferCapacity() - 2
	for i := 0; i < 125; i++ {
		settleProduction(ws)
	}
	if len(b.Production.PendingOutputs) != 1 || len(b.Production.PendingByproducts) != 1 || b.Production.RemainingTicks != 0 {
		t.Fatalf("blocked batch lost: %+v", b.Production)
	}
	if availableStorageItem(b.Storage, model.ItemCriticalPhoton) != 2 || b.ExportableItemQuantity(model.ItemAntimatter) != 0 || b.ExportableItemQuantity(model.ItemHydrogen) != 0 {
		t.Fatalf("blocked output was partially committed or new inputs consumed: %+v", b.Storage)
	}
	save, err := core.ExportSaveFile("collider-blocked")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(save)
	if err != nil {
		t.Fatal(err)
	}
	var decoded gamedir.SaveFile
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	restored, err := NewFromSave(core.cfg, core.maps, queue.New(), NewEventBus(), nil, &decoded)
	if err != nil {
		t.Fatal(err)
	}
	resumed := restored.World().Buildings[b.ID]
	if resumed == nil || !reflect.DeepEqual(resumed.Production, b.Production) || !reflect.DeepEqual(resumed.Storage, b.Storage) {
		t.Fatal("save/load changed pending batch or storage")
	}
	delete(resumed.Storage.Inventory, model.ItemStoneOre)
	delete(resumed.Storage.InputBuffer, model.ItemStoneOre)
	resumed.Runtime.State = model.BuildingWorkRunning
	settleProduction(restored.World())
	settleStorage(restored.World())
	if resumed.ExportableItemQuantity(model.ItemAntimatter) != 2 || resumed.ExportableItemQuantity(model.ItemHydrogen) != 2 || availableStorageItem(resumed.Storage, model.ItemCriticalPhoton) != 2 {
		t.Fatalf("restored batch release not conserved: %+v", resumed.Storage)
	}
	if len(resumed.Production.PendingOutputs) != 0 || len(resumed.Production.PendingByproducts) != 0 {
		t.Fatal("batch still pending after release")
	}
}

func TestParticleColliderBuildResearchGates(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	pos, err := findOpenTile(ws, 2)
	if err != nil || pos == nil {
		t.Fatalf("find build tile: %v", err)
	}
	build := func(recipe string) model.CommandResult {
		result, _ := core.execBuild(ws, "p1", model.Command{Type: model.CmdBuild, Target: model.CommandTarget{Position: pos}, Payload: map[string]any{"building_type": string(model.BuildingTypeMiniatureParticleCollider), "recipe_id": recipe}})
		return result
	}
	if result := build("deuterium_collision"); result.Code != model.CodeValidationFailed || !strings.Contains(result.Message, "research") {
		t.Fatalf("locked collider accepted: %+v", result)
	}
	grantTechs(ws, "p1", "miniature_collider")
	for _, recipe := range []string{"antimatter", "strange_matter"} {
		if result := build(recipe); result.Code != model.CodeValidationFailed || !strings.Contains(result.Message, "research") {
			t.Fatalf("locked recipe %s accepted: %+v", recipe, result)
		}
	}
	if result := build("deuterium_collision"); result.Code != model.CodeOK {
		t.Fatalf("unlocked collider rejected: %+v", result)
	}
	for i := 0; i < 10; i++ {
		ws.Tick++
		core.settleConstructionQueue(ws)
	}
	building := ws.Buildings[ws.TileBuilding[model.TileKey(pos.X, pos.Y)]]
	if building == nil || building.Storage == nil || building.Production == nil || building.Production.RecipeID != "deuterium_collision" {
		t.Fatalf("constructed collider lacks runtime: %+v", building)
	}
	grantTechs(ws, "p1", "strange_matter", "dirac_inversion")
	if !CanUseRecipeTech(ws.Players["p1"], "strange_matter") || !CanUseRecipeTech(ws.Players["p1"], "antimatter") {
		t.Fatal("later recipes not unlocked by correct research")
	}
}

func TestParticleColliderConstructedLineImportsAndExports(t *testing.T) {
	core := newConstructionTestCore(t, 4, 4)
	ws := core.World()
	var center *model.Position
	for y := 2; y < ws.MapHeight-2 && center == nil; y++ {
		for x := 2; x < ws.MapWidth-2; x++ {
			clear := true
			for dx := -1; dx <= 1; dx++ {
				if !ws.Grid[y][x+dx].Terrain.Buildable() || ws.TileBuilding[model.TileKey(x+dx, y)] != "" {
					clear = false
				}
			}
			if clear {
				center = &model.Position{X: x, Y: y}
				break
			}
		}
	}
	if center == nil {
		t.Fatal("no buildable three-tile line")
	}
	for _, entry := range []struct {
		dx     int
		kind   model.BuildingType
		recipe string
	}{
		{-1, model.BuildingTypeConveyorBeltMk1, ""},
		{0, model.BuildingTypeMiniatureParticleCollider, "antimatter"},
		{1, model.BuildingTypeConveyorBeltMk1, ""},
	} {
		pos := model.Position{X: center.X + entry.dx, Y: center.Y}
		result, _ := core.execBuild(ws, "p1", model.Command{Type: model.CmdBuild, Target: model.CommandTarget{Position: &pos}, Payload: map[string]any{"building_type": string(entry.kind), "recipe_id": entry.recipe, "direction": "east"}})
		if result.Code != model.CodeOK {
			t.Fatalf("build %s: %+v", entry.kind, result)
		}
	}
	for i := 0; i < 15; i++ {
		ws.Tick++
		core.settleConstructionQueue(ws)
	}
	input := ws.Buildings[ws.TileBuilding[model.TileKey(center.X-1, center.Y)]]
	collider := ws.Buildings[ws.TileBuilding[model.TileKey(center.X, center.Y)]]
	output := ws.Buildings[ws.TileBuilding[model.TileKey(center.X+1, center.Y)]]
	if input == nil || collider == nil || output == nil {
		t.Fatal("line construction failed")
	}
	if accepted, _, err := input.Conveyor.Insert(model.ItemCriticalPhoton, 2); err != nil || accepted != 2 {
		t.Fatalf("feed photons: %d %v", accepted, err)
	}
	got := model.ItemInventory{}
	for i := 0; i < 135; i++ {
		ws.Tick++
		settleBuildingIO(ws)
		settleProduction(ws)
		settleStorage(ws)
		for _, stack := range output.Conveyor.Buffer {
			got[stack.ItemID] += stack.Quantity
		}
		output.Conveyor.Take(output.Conveyor.TotalItems())
	}
	if got[model.ItemAntimatter] != 2 || got[model.ItemHydrogen] != 2 || len(got) != 2 || input.Conveyor.TotalItems() != 0 || totalStorageItems(collider.Storage) != 0 {
		t.Fatalf("constructed line not conserved: input=%+v collider=%+v output=%+v", input.Conveyor, collider.Storage, got)
	}
}
